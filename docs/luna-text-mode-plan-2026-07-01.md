# Luna 文字模式(方案 B)· 前端 Live 版 · 2026-07-01

## 决策
语音 ASR 中英混说常听错 → 加打字。**方案 B**:Luna button 点击=语音不变;button 加小键盘图标开文字框(打字不开麦);文字框**只显示上一轮**(你说的+回复)。文字**必须和语音一样会做事**(飞地图/出卡片/测距)。

## 为什么走前端 Live(不走后端)
后端服务器(Hetzner 德国)调 Gemini 选工具**极不稳**(本地 12/12,线上~1/6,同 key/模型/prompt/SDK,穷尽排除=Google 按区域的行为差异,修不动)。而**语音走 Gemini Live、客户浏览器直连、区域可靠、工具调用一直好使**。所以文字也走前端 Live,复用语音那条已验证可靠的管线。安全上:文字复用语音**同一条临时 token 路径**(短时效、有 scope、真 key 只在服务器),不新增暴露面;护栏=token TTL + 按 visitor 限流(同语音)。**不加 Cloudflare Worker、不加部署点。** 弃用后端 `/api/voice/text`。

## 实现(前端 `VoiceAssistantContext.tsx` + 已建好的面板)
核心:**复用语音 Live 会话,但不开麦、不播音、把回复路由到文字面板。** 全部走 `textModeRef` 开关,`false` 时语音路径**必须一字不变**。

1. `textModeRef = useRef(false)`。
2. `activateRef = useRef<()=>Promise<void>>()`;在 activate 定义后用 effect 赋值(避免 sendText 引用 activate 的 TDZ)。
3. `activate()` 加守卫:
   - chime(~933):`if (!isReconnect && !textModeRef.current) playerRef.current?.chime?.()`。
   - onopen 自动录音(~987):`if (!textModeRef.current) startRecordingRef.current?.()`。
   - 其余(connect 配置/reconnect/resumption)不动。responseModalities 保持 AUDIO(native-audio 不支持 TEXT-only,实测空);text 模式靠"不播音+读 outputTranscription"拿文字。
4. `handleMessage`:
   - 音频播放分支(~658-667):`if (!textModeRef.current) { setPhase('speaking'); playerRef.current?.play(...) }`(text 模式不播、不置 speaking)。
   - `outputTranscription`(~631)照常累积(它已 `scheduleBubbleFlush`)。
   - `turnComplete`(~670):text 模式额外 `setTextPending(false)`。
5. `flushBubble`(~371):text 模式路由到面板而非语音气泡:
   `if (textModeRef.current) setLastExchange(prev => ({ user: prev?.user ?? '', bubble: { text, attachment: attachment||undefined, timestamp: Date.now() } })); else setLatestBubble({...})`。
   (attachment 仍用 pendingAttachmentRef/sticky 逻辑;`buildBubbleAttachment` 已在 executeTool 里填 pendingAttachmentRef,语音文字共用,零改。)
6. `sendText(text)` 重写(去掉 fetch `/api/voice/text`):
   - `setTextPending(true); setLastExchange({user:trimmed, bubble:null}); textModeRef.current = true`。
   - 若无会话(`!sessionRef.current?.sendClientContent`):`await activateRef.current?.()`,再轮询等 `sessionRef.current?.sendClientContent` 就绪(≤8s,50ms 间隔);超时→报友好错误、`setTextPending(false)`。
   - `sessionRef.current.sendClientContent({ turns:[{ role:'user', parts:[{ text: trimmed }] }], turnComplete:true })`。
   - 回复经 handleMessage→flushBubble 异步填进 lastExchange;textPending 在 turnComplete 清。(多轮上下文由 Live 会话自身保留,不用 textHistoryRef 喂;可留着不影响。)
   - `catch`→友好错误 + `setTextPending(false)`。
7. `openText`:`setTextOpen(true)`(不连接,懒连接放 sendText 首次)。
8. `closeText`:`setTextOpen(false)`;若 `textModeRef.current` 有会话→`deactivate()`(它已停录音/关会话/结束 debug 会话),然后 `textModeRef.current = false; setTextPending(false)`。
9. `deactivate()`(~1070):text 模式也走它没问题;确保它把 `textModeRef.current=false`。
10. `VoiceAssistantButton.tsx`:把 `TEXT_MODE_ENABLED` 翻成 `true`(重新露出键盘图标+面板),供用户真机测。

## 硬约束
- `textModeRef=false` 时语音行为**完全不变**(所有改动都是加守卫)。
- 打字**不启动麦克风**(不 startRecording)、**不播放音频**。
- 双端 `npx tsc --noEmit` 通过。
- 不动后端、不新增部署。

## 验证
type-check + 前端 build。真机(浏览器)测:点键盘图标→打"带我去 Dubai Marina"应飞地图、"朱美拉村有什么房"出卡片、Luna 不出声只显示文字;语音 tap 仍照常开麦说话。
