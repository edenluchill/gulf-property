# Luna Tour — 进度与待办(下次 pick up 从这里开始)

> 更新:2026-05-30(Phase 0 心脏切片代码全部完成,前后端 tsc/build 通过、endpoint 真实 200)
> **下次 pick up**:① 真机开 `/v/demo` 做 go/no-go(`backend: npm run dev` + `frontend: npm run dev`);② 通过后进 Phase 1(切 Live + 公开链路鉴权)。
> 用户核心要求:**全部做、做到完成**;**数据库用现有 Postgres(backend/.env 的 DB_*),不用 Supabase 存储**;
> **代码要 reusable、易解耦、易删除**——方便阅读,出问题能简单移除。

## 隔离/可删除约定(务必遵守)
- 后端所有新代码放 `backend/src/luna-tour/`,删整个目录即可移除逻辑。
- 所有 DB 表用 `lt_` 前缀;拆除脚本 `backend/src/db/luna-tour-teardown.sql`(一键 DROP 所有 lt_*)。
- 尽量不改现有文件;必须挂路由时,在 index.ts 只加一行 `app.use('/api/luna', lunaRouter)`(集中一个入口,便于摘除)。
- 不复制现有逻辑,只 import 复用(pool、investment-calculator、voice-token/voice-tools、MapViewMapLibre 等)。
- 前端新代码集中放 `frontend/src/luna-tour/`(页面/组件/context),路由在 App.tsx 集中加。

## 已完成 ✅
1. **设计文档齐全**(docs/):
   - `luna-tour-experience-spec.md`(v2 主 spec,逐秒分镜 + §4 技术契约 + §4.1 TourScript v2 + §4.2 AI 生成契约)
   - `agent-demo-saas-spec.md`(v1 数据/架构基线)
   - `reports/2026-05-30-tour-ux-config-audio-tradeoffs.md`(音频/配置取舍)
   - `reports/2026-05-30-implementation-readiness.md`(就绪度 + 可复用资产核实)
   - `reports/2026-05-30-build-difficulty.md`(难度评估)
2. **产品心脏验证 = GO**:`backend/src/luna-tour/` 已实现并**真实跑通**:
   - `tour-script.types.ts`(zod TourScript v2 + TourInput)
   - `tour-generator.ts`(`generateTourScript()`:Gemini gemini-3-flash 主 / gemini-2.5-flash fallback;结构化 JSON;数据只引用不编造;banned_phrases/guardrails;zod+程序化校验+自动重试一次;另导出 `validateTourScript`)
   - `test-tour-generator.ts`(取 2 个真盘 + investment-calculator 算 ROI;`npx ts-node src/luna-tour/test-tour-generator.ts` 跑通,首次生成即过全部校验,0 warnings,旁白自然、数据零编造)
   - `npx tsc --noEmit` 全仓 0 错误。
   - 已知小问题(留待优化,非阻塞):①总时长偏满(命中 ±20% 边界,spec 原文 ±15%,可把 `tour-generator.ts` 顶部 `TOTAL_DURATION_TOLERANCE` 改 0.15);②arrival 的 flyover from==to(无"上一处"坐标,语义无害)。
3. **DB schema 已应用成功** ✅(2026-05-30):
   - `backend/src/db/luna-tour-schema.sql`(全部 lt_ 表 + 物化视图 + 订阅种子;lt_agents 同时支持 auth_user_id 复用 Supabase 登录 或 本地 password_hash)
   - `backend/src/db/luna-tour-teardown.sql`(一键拆除)
   - **已建成:14 张 lt_ 表 + 1 物化视图 `lt_session_lead_scores` + 3 订阅计划种子(free/pro/team)。** db-runner 不交互,直接 `npx ts-node scripts/db-runner.ts src/db/luna-tour-schema.sql` 即可。

## 关键事实(环境)
- DB 直连 pg:`import pool from '../db/pool'`;.env 变量 `DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD`(现有库非 Supabase 存储)。
- 既有认证:`middleware/auth.ts` 走 Supabase JWT(`supabaseAdmin.auth.getUser`),Supabase 未配置时 requireAuth 直接放行(开发模式)。
- 既有表真实列名见 `backend/src/db/residential-projects-schema.sql`(residential_projects: id/project_name/area/latitude/longitude/min_price/max_price/status;project_unit_types)。
- Gemini:`@google/genai` 1.30.0;API key 在 backend/.env(具体变量名见 property-analyzer.ts / voice-token.ts)。
- 后端入口 `backend/src/index.ts`,路由模式 `app.use('/api/xxx', router)`;route 文件有两种:`export default router` 和 `createXxxRouter(pool)`。
- 前端:React Router 在 `frontend/src/App.tsx`;API 封装 `frontend/src/lib/api.ts`;地图 `frontend/src/components/MapViewMapLibre.tsx`(目前 props 响应式,**无 ref**);context 模式见 `contexts/VoiceAssistantContext.tsx`。
- 现有可复用 voice 资产:`services/voice-assistant-tools.ts`(11+ tools)、`routes/voice-token.ts`、`routes/voice-tools.ts`、`routes/voice-chat.ts`、`services/r2-storage.ts`(R2 已有!预生成音频上传可复用)。

## 待办路线图(按依赖顺序)

### Phase 0 — 心脏切片(✅ 代码全部完成,2026-05-30;待真机 go/no-go)
- [x] AI 生成 TourScript(已 GO)
- [x] **应用 DB schema**(14 表 + 1 物化视图 + 3 计划种子)
- [x] 地图命令式接口:`frontend/src/luna-tour/map/TourMap.tsx`——**独立 maplibre-gl 实例**(没动现有 MapViewMapLibre,零耦合),`useImperativeHandle` 暴露 `MapTourHandle`:flyTo/orbit(rAF bearing 插值)/flyover/executeCamera/jumpTo/drift/drawDistanceLine(激光描绘)/showAmenitySpokes(辐射+分数 chip)/highlightPins/setHeatmap(Phase 0 故意 no-op,留接口)/clearOverlays/setStyle/resize。dark-matter 夜景底图。
- [x] 回放引擎 TimelineEngine(`frontend/src/luna-tour/engine/TimelineEngine.ts`):单 rAF 时钟,把 script 拍平成绝对时间 segments+cues;三轨(AudioTrack/Camera/Overlay)+ 状态机(loading→reveal→playing→paused→asking→outro→ended)+ seekTo/seekToSegment/pause/replay。时间以「脚本 beat 时长」为准(确定性,音频只叠加不阻塞)。`audioTrack.ts` = 浏览器 speechSynthesis 兜底(+mp3 路径预留)。
- [x] overlay 组件:`overlays/OverlayLayer.tsx`——title/progress_dots/property_card(底升)/roi_card(count-up+进度条+脉冲)/favorite_picker(❤️)/cta(WhatsApp 预填)。距离线/辐射/highlight 由 map ref 画。`luna-tour.css` 全套电影样式+动画。
- [x] 客户观看页 `/v/:code`:`pages/WatchPage.tsx`(fetch + loading/error/passcode 态)→ `TourPlayer.tsx`(map+engine+overlays+chrome:顶进度线/经纪 badge/静音/可点 act 圆点跳房/Luna pill 暂停/大开始-重播按钮/haptic)。App.tsx 只加 1 行 import + 1 行 `<Route path="/v/:code">`。
- [x] **端到端验证**:前端 `npx tsc --noEmit` 0 错 + `vite build` 通过(2546 模块含 luna-tour);后端 0 错;`GET /api/luna/public/v/demo` 真实返回 200 完整 payload(session/agent/3 房 snapshot/166s 脚本),未知 code 404。
- [ ] **真机 go/no-go**(唯一剩项,需人):`cd frontend && npm run dev` → 手机/浏览器开 `/v/demo`,点「开始」,看 spec §1 的震撼 3 分钟。后端需先 `cd backend && npm run dev`。

#### Phase 0 已知小问题 / 后续优化(非阻塞)
- 音频是浏览器 TTS(声音质量一般、各浏览器 voice 不一);Phase 3 接 Gemini TTS + R2 预生成(voice=Aoede 与 Live 统一)。
- 距离线 `to` 端点是按楼盘坐标偏移生成的占位(非真实 POI),snapshot 里 `placeholder:true`;真实 POI join 放 Phase 2 数据层。
- `setHeatmap` 是 no-op 占位(tour map 还没接 area-metric 源);Phase 2 数据层补。
- seed 第三个楼盘 area 为空字符串(d3),展示无害。
- 「提问切 Live」UI 已留位(tap→asking 态 + Luna pill 放大 + 提示语),但实际 Live 连接是 Phase 1。

### Phase 1 — 切 Live + 数据层
- [ ] 经纪账户:优先复用 Supabase 登录(lt_agents.auth_user_id);或本地 bcrypt(password_hash)。`requireAgent` middleware(放 luna-tour 内,别改全局 auth.ts)。
- [ ] 公开只读链路:`GET /api/luna/public/v/:code`(校验 share_code/过期/passcode,只返回快照+TourScript+音频URL,不暴露内部表)。
- [ ] 切 Live:system instruction 参数化(经纪身份+当前房源+已讲内容,同 voice=Aoede),复用 voice-token/voice-tools;回放暂停→提问→Live→回放 衔接。

### Phase 2 — 经纪创作闭环
- [ ] 后端 CRUD:clients、demo_configs、sessions(create/generate/script-edit/publish);AI 代配(一句话+客户档案→effective_config 三层合并)。
- [ ] 经纪 Dashboard(`frontend/src/luna-tour/`):客户 CRM、选房建 session、一键生成、故事板预览编辑、发布+WhatsApp 分享。
- [ ] 动态 OG 卡 + 首帧地图截图烘焙。

### Phase 3 — 预生成音频 + 遥测 + 跟进
- [ ] 预生成音频:Gemini TTS 合成各 beat mp3(voice=Aoede)+ R2 上传(复用 `services/r2-storage.ts`)+ lt_audio_assets 状态跟踪 + 兜底切换。
- [ ] 遥测:lt_engagement_events 写入、lt_session_lead_scores 刷新、"正在看"提醒(SSE)、❤️ 反馈回流。

### Phase 4 — 放大
- [ ] 订阅 Stripe + 配额门(lt_usage_counters 计量,plan limits)。
- [ ] 多语言(EN/ZH/RU/AR)+ 经纪行模板库/白标。

## 📌 待跟进 Backlog

### ✅ 已完成(2026-05-31 第二批快赢)
- **音频「说得完」(缓解版)**:`TimelineEngine.speakMs()` 按旁白字数(CJK ~4.2字/s + latin ~2.6词/s + 700ms 尾)估算念完时长,`build()` 里把 beat 时长**扩展到 ≥ 念完时长**(只增不减,cue 相对 at_ms 不受影响)→ 旁白不再被下一段打断。**根治仍是 Phase 3 预生成音频**(真实时长回填 + ended 驱动)。
- **区域名描边**:`area-label-text` 在 satellite/dark 底图上改 白字 + 黑 halo(width 2),夜景/卫星上清晰可读。
- **暂停时点楼盘 explore**:`TourOverlay` 暂停态显示房源缩略图 strip → 点一套 → 飞过去 + pin 高亮 + 弹信息卡(图/价/便利度/地铁)→ 记 `property_view` 遥测。「返回」回 strip,继续观看自动清。
- **参数化生成入口**:`session-builder.ts`(`createSession()`/`ensureAgent()` 复用真实POI/距离/ROI/AI脚本+持久化)+ `create-session.ts` CLI:
  ```
  npx ts-node src/luna-tour/create-session.ts <shareCode> <id1,id2,...> ["Title"]
  ```
  → 为**任意房源**生成 `/?toursession=<shareCode>`。`seed-demo-session.ts` 也重构为调它(消除重复逻辑)。

### ✅ 已完成(2026-05-31/06-01 第三批)
- **事件驱动引擎(根治台词被切)**:`TimelineEngine` 重写为序列器,beat 只在「旁白真念完(onend)+ 相机真飞完(Promise)+ 最短停留」全满足才切。语言/TTS/语速无关。已 mock 测核心不变量。
- **经纪行为分析面板**:`agent-router.ts` `GET /sessions`(session+engagement rollup+lead_score)、`GET /sessions/:id/events`(行为时间线)。前端 `pages/AgentDashboard.tsx`(路由 `/luna/agent`):导览列表+打开/完看/联系/❤️/停留/热度 + 单 session 行为流。已实测通。
- **最小经纪 Dashboard + 一键生成**:Dashboard 顶部表单(分享码+楼盘ID+标题+一句话)→ `POST /sessions/create` → 包 `createSession` → 返回 `watch_url`。**已端到端实测**:create→读取→公开端点可播。无登录(用 demo agent),真 auth 待 Phase 1。
- **AI 代配(一句话→config)**:`auto-config.ts` `draftConfig()`——客户档案+一句话 → Gemini 结构化输出(language/narrative_focus/target_seconds/tone),**护栏+禁词强制覆盖**(合规底线不被绕过)。已实测:「香港投资客重回报」→ investment/zh/165s。
- **切 Live 问答(代码完成,待真机测)**:
  - 后端 `POST /api/luna/public/v/:code/live-token`:参数化 system instruction(经纪身份+当前房源+已讲内容),复用现有 ephemeral token 机制,同 voice=Aoede。
  - 前端 `useTourLive.ts` hook:复用 `AudioRecorder/AudioPlayer` + `/api/voice/tools/execute`,mapAction 路由到 **tour map handle**(画在导览地图上)。`TourOverlay` 暂停态加「🎙问问 Luna」按钮 + Live 状态 + 字幕。
  - ⚠️ **需真机(麦克风+Gemini Live 计费)验证**:无头环境测不了实际语音连接。tsc+build 通过。Live 用量目前用 `ask` 遥测事件计数,真正分钟数计入 `usage_counters` 待补。

### 🟡 Phase 2 创作闭环(剩余)
- **故事板编辑器**:幕/beat 预览、改旁白/重排/重生成某段、发布。需 `lt_tour_scripts` script-edit 接口 + 编辑 UI(MVP Dashboard 已能「整体生成」,缺「逐段编辑」)。
- **经纪真登录/CRM**:现 Dashboard 无 auth(demo agent);需 `requireAgent` + 客户 CRM。

### 🔵 Phase 3 根治音频
- Gemini TTS 预生成每 beat mp3(voice=Aoede)+ R2 上传 + `lt_audio_assets` 状态 + 用真实时长回填 beat / ended 事件驱动推进。

### 🟢 其他小优化
- 「展示区域价值」现在绑定「数字」beat 自动触发(`medianUnitPrice`)。若要 AI 逐 beat 精确指定(哪一刻/哪指标),需给 TourScript 加 overlay 类型 + 重新生成。
- 经纪行为分析面板(遥测数据已在流入):单 session 时间线 + lead_score 排序 + 「正在看」SSE 提醒。

## 全程纪律
- 每阶段:前后端 `npx tsc --noEmit` + 本地跑通 + 关键路径手测。
- 保持隔离:新代码进 `luna-tour/` 目录;改现有文件仅限"加一行挂载",并在本文件记录改了哪里,方便回滚。
