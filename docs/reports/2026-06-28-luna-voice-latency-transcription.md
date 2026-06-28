# Luna 语音:延迟 + 转录不准 根因分析

日期:2026-06-28
症状(地图页 Luna):
1. 点开后一直说话没回应,有时说了 ~20 秒她才开口。
2. 说话时显示的字非常不正确,会漏掉客户说的话。

## 工作方式确认

- 字由 **Gemini 自己识别**:config 开了 `inputAudioTranscription: {}`(`frontend/src/contexts/VoiceAssistantContext.tsx:898`),用户语音经 `serverContent.inputTranscription` 分片返回,前端只拼接显示(`:580-594`)。前端不做识别。
- 链路:浏览器麦克风 → 16kHz PCM → `sendRealtimeInput` 直发 Gemini(`:813-826`)→ Gemini 边收边做 VAD + ASR → 返回音频 + 双向字幕。后端只跑工具(`/api/voice/tools/execute`)。
- 模型:`gemini-2.5-flash-native-audio-preview-12-2025`。

## 根因:麦克风采集仍用 ScriptProcessor 跑在主线程

`frontend/src/hooks/voice-assistant/audioUtils.ts:113`
```js
this.processor = this.audioContext.createScriptProcessor(4096, 1, 1)
```

`ScriptProcessorNode.onaudioprocess` 在**主线程**执行。地图页是全站主线程/GPU 负载最重处
(见记忆 `map-perf-dom-markers-gpu`、`luna-tour-perf-rules`)。

讽刺点:**播放器侧已踩过并修好同一个坑**,`audioUtils.ts:160-166` 注释明确写
"main-thread jank (map rendering, React) — that jank starving a main-thread ScriptProcessor
was the cause of the stutter." 播放器改成了音频线程 buffer 调度,**但录音器没改**。

### 一个根因解释两个症状
- **漏字/识别错**:主线程卡顿时 ScriptProcessor 丢帧/吐出断裂音频 → Gemini 收到带空洞的音频 → 识别乱码、漏词。
- **延迟 6~20s**:卡顿时音频块本地积压,恢复后一股脑补发;Gemini 要等积压音频流完 + `silenceDurationMs:800ms` 静音才判定 turn 结束 → 积压多久延迟多久。

## 证据(backend/voice-debug-logs/sessions-summary.log,36 会话)

- 有真实对话的会话响应延迟:6011 / 9109 / 9217 / 9907 / 11593 / 12796 ms。
- 首次问候最慢:21275 ms。
- 工具平均耗时:190~1031 ms(全 <1.3s)→ **延迟不是工具/后端造成**。
- 延迟定义(`debugLogger.ts:295-309`)= 最后一段用户识别文字 → Luna 第一段回复文字的间隔。

## 修复方案

**把 `AudioRecorder` 从 `ScriptProcessorNode` 改为 `AudioWorkletNode`**,麦克风采集移到音频线程,
免疫主线程 jank(与播放器同一修法)。

- 影响面:`audioUtils.ts` 的 `AudioRecorder`;`luna-tour/useTourLive.ts` 复用同一个类,一改两处都好。
- 顺手把采集帧从 4096(256ms)改小到 ~128/256 样本,降低延迟。

### 次要项(修完采集再微调)
- VAD:`endOfSpeechSensitivity: LOW` + `silenceDurationMs: 800` 偏保守,可降到 ~500ms。
- `prefixPaddingMs: 400` 同理。

## 已实施(2026-06-28)

`frontend/src/hooks/voice-assistant/audioUtils.ts` 的 `AudioRecorder` 重写为 AudioWorklet:
- 新增 `luna-recorder` worklet(源码内联,Blob URL 经 `audioWorklet.addModule` 加载),
  采集跑在音频线程,免疫主线程 jank。
- worklet 内累积 128-sample quanta → 1280 样本(~80ms)帧,float32→int16 在 worklet 完成,
  postMessage transferable buffer;主线程只做 base64 + `sendRealtimeInput`。
- 不写 outputs(默认静音),`node.connect(destination)` 仅为拉流、不漏麦到扬声器。
- API 不变(`start(onAudioData)` / `stop()`),`VoiceAssistantContext` 与 `luna-tour/useTourLive.ts`
  复用同一个类,一改两处都好。

## 验证
- ✅ `npx tsc --noEmit` 通过。
- ✅ 离线分帧测试(scratchpad `test-recorder-worklet.mjs`,抽取真实 worklet 源码驱动):
  10/10 帧、12800 样本零丢失、int16 正确。
- ⏳ 浏览器接线(addModule / getUserMedia 16k / 节点拉流 / 真机地图运镜中不丢帧):需真机验
  (自动化喂不了真实人声)。前端推送后经 Cloudflare Pages 自动部署,在地图页实测对话。
- VAD 参数(`silenceDurationMs:800` / `endOfSpeechSensitivity:LOW`)本次未动;采集修好后若仍觉开口慢,
  再降到 ~500ms。
