# Luna 文字模式(方案 B)+ 语音准确率快赢 · 2026-07-01

## 目标 / 用户决策
- 语音 ASR 对中文+夹英文项目名经常听错;加**打字**作为精确输入 + 方便 debug。
- **方案 B(用户拍板)**:Luna button 的**点击=语音,完全不变**;button 上加一个**很小的键盘图标**,点它才开文字框。**打字时不开麦**(纯文字,不启动音频 Live)。
- 文字框**只显示上一轮**(你说的 + Luna 回复 2 条)+ 输入框。模型内部仍保留完整多轮上下文,屏幕只显示 2 条。
- **文字必须和语音一样"会做事"**:同一套工具引擎 → 打字也会飞地图、开项目、测距、出项目卡/投资图。一个能力都不能少。
- 语音体验 100% 不动(独立路径)。

## 关键架构
文字走**后端文字 agent 端点**(key 留服务端),复用后端已有的 `voiceAssistantTools`(声明)+ `executeTool`(执行,返回 `{result, summary, mapAction}`)+ 系统提示词。前端把"工具结果→bubble attachment"的映射抽成**共享纯函数**,语音和文字都用 → 零漂移、卡片一致。

### 后端
1. `backend/src/routes/voice-token.ts`:把 `getSystemInstruction(language)` **导出**(供文字端点复用同一提示词)。
2. **领域词表(语音+文字都受益)**:在 `getSystemInstruction` 里加一段"实体词表",把模糊音映射到真实实体,并要求"名字没把握先确认别乱猜"。至少覆盖 top 开发商 + top 区域的中文口音写法,例:
   - 开发商:伊曼/艾玛=Emaar、达马克/达马/迪马克=DAMAC、朱美拉=Nakheel/Jumeirah、索巴=Sobha、迪拜地产=Dubai Properties、美丹=Meydan…
   - 区域:马瑞纳/码头=Dubai Marina、市中心=Downtown、朱美拉村=JVC、商业湾=Business Bay、迪拜山庄=Dubai Hills…
   - (coder 可 `cd backend && npx ts-node scripts/db-query.ts` 拉真实 top developer/area 名字校准这份表。)
3. 新路由 `POST /api/voice/text`(放 `voice-tools.ts` 或新建 `voice-text.ts`,挂 `/api/voice`):
   - 入参 `{ messages: [{role:'user'|'model', text}], text, language }`。
   - 用 `@google/genai` `ai.models.generateContent`(model `gemini-3-flash`),`config.tools = voiceAssistantTools`、`systemInstruction = getSystemInstruction(language)`、`toolConfig` 允许函数调用。
   - **agent 循环**:模型返回 functionCalls → 逐个 `executeTool(name, args)` → 把 `{result}` 作为 functionResponse 回灌 → 再 generateContent,直到无 functionCall 出最终文本。收集每步 `{ name, result, mapAction }`。上限如 6 步防失控。
   - 返回 `{ reply: string, steps: [{ name, result, mapAction }] }`。best-effort,错误返回友好中文。
   - **计费**:文字比语音便宜;先不接 quota(和用户确认过语音是主),留 TODO。

### 前端
4. **抽共享映射**:把 `VoiceAssistantContext.tsx` `executeTool` 里 `data.result` → `pendingAttachmentRef` 的那段(search_projects/navigate_to_project/get_area_info/compare_areas/... 全部)抽成纯函数 `buildBubbleAttachment(toolName, result)`(新文件 `frontend/src/hooks/voice-assistant/buildAttachment.ts`)。语音路径改成调用它(行为不变),文字复用。
5. `VoiceAssistantContext.tsx` 加:
   - `lastExchange: { user: string; bubble: BubbleContent | null } | null` 状态(文字框显示用)。
   - `textHistory` ref:`[{role,text}]` 完整多轮(喂后端),但只 `lastExchange` 上屏。
   - `sendText(text)`:setPhase('processing'/toolStatus)、POST `/api/voice/text`(带 textHistory + text + language)、对每个 step 调 `handleMapAction(step.mapAction)` + `buildBubbleAttachment(step.name, step.result)`(取最后一个有附件的);组 `BubbleContent{ text: reply, attachment }`;push 进 textHistory;setLastExchange;setPhase('idle')。
   - `textOpen` 状态 + `openText()/closeText()`。**打开文字时:不 activate 语音;若语音在跑,可留着或提示——默认二者独立。**
   - context 暴露:`textOpen, openText, closeText, sendText, lastExchange`。
6. `VoiceAssistantButton.tsx`:
   - button 上加一个**很小的键盘图标**(如左上角小圆点按钮,`lucide-react` 的 `Keyboard`),`onClick={openText}`,`stopPropagation` 别触发语音。
   - 新增 `LunaTextPanel`(可同文件或新组件):贴着 button(`bottom-… right-[56px]`),glass 小框:
     - 顶部:`Luna` + ✕(closeText)。
     - 中间:`lastExchange` —— 用户气泡(右/teal)+ Luna 气泡(左),Luna 气泡复用现有 `CompactProjectCard/CompactAreaCard/InvestmentChart` 渲染 attachment。只 2 条。
     - 底部:自动长高 `textarea`(回车发送、shift+回车换行)+ 发送键;发送中显示 processing。
   - 干净、最小;移动端底部小抽屉。

## 验证
- `cd frontend && npx tsc --noEmit` + `cd backend && npx tsc --noEmit` 双绿。
- 本地起 dev,打字「带我去 Dubai Marina」应飞地图;「Emaar 有什么房」应出项目卡(注:Emaar 匹配 bug 另修)。语音路径回归:开麦说话仍正常(共享函数没改行为)。

## 不在本期(单列)
- **升级 native-audio 模型**到稳定版 `gemini-live-2.5-flash-native-audio`:风险动到线上语音,单独小心测。
- **Emaar→0 匹配 bug**:属 DLD 开发商名匹配,单独修。
- 文字模式 quota 计费。
- 跨设备历史(落库)。
