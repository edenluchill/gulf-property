# Luna Tour 语音系统（现状）

> 更新：2026-06-02
> 一句话：**一条导览 = 很多段台词（beat）。每段台词在创建时用 Gemini TTS（voice=Aoede）预先合成一个 WAV 音频文件，存到 Cloudflare R2。客户观看时按段从 R2 拉取播放，「说完」才进行下一个动作/转场。客户提问时切 Gemini Live，用的是同一个 Aoede 声音。**

---

## 1. 核心概念：一条导览 → 多段台词 → 多个音频文件

一条导览脚本（TourScript）由顺序排列的 **beat（台词段）** 组成：开场 → 每个房子的 arrival/life/numbers → 结尾。**每个 beat 一段旁白，对应 R2 上的一个 WAV 文件。**

```mermaid
graph LR
  Tour["一条导览 TourScript"] --> Intro["intro 开场白"]
  Tour --> Act1["房子1 (act)"]
  Tour --> Act2["房子2 (act)"]
  Tour --> Outro["outro 结尾"]

  Act1 --> A1a["beat: arrival"]
  Act1 --> A1b["beat: life"]
  Act1 --> A1c["beat: numbers"]
  Act2 --> A2a["beat: arrival"]
  Act2 --> A2b["beat: life"]
  Act2 --> A2c["beat: numbers"]

  Intro -.每段一个.-> W0["☁️ intro.wav"]
  A1a -.-> W1["☁️ ..._arrival.wav"]
  A1b -.-> W2["☁️ ..._life.wav"]
  A1c -.-> W3["☁️ ..._numbers.wav"]
  Outro -.-> W9["☁️ outro.wav"]

  W0 & W1 & W2 & W3 & W9 --> R2[("Cloudflare R2<br/>每段一个 WAV")]
```

> demo 实例：3 个房子 → intro + 9 个 act beats + outro = **11 段台词 = R2 上 11 个 WAV 文件**。

---

## 2. 生成阶段（经纪创建导览时，一次性预录）

发生在经纪点「生成导览」时（`createSession`）。AI 先写出多段台词，再**逐段**合成语音并上传 Cloudflare。

```mermaid
flowchart TD
  Start["经纪：选房 + 一句话<br/>POST /api/luna/agent/sessions/create"] --> Gen["tour-generator.ts<br/>Gemini 生成 TourScript<br/>(N 段 beat 台词)"]
  Gen --> Save["存 lt_tour_scripts (脚本 JSON)"]
  Save --> Pipe["audio-pipeline.ts<br/>generateSessionAudio()"]

  Pipe --> Loop{"遍历每个 beat<br/>(并发 2 + 失败重试 3 次)"}
  Loop --> TTS["tts.ts: Gemini TTS<br/>model=gemini-3.1-flash-tts-preview<br/>voice=Aoede"]
  TTS --> PCM["拿到 raw PCM<br/>24kHz / 16-bit / mono"]
  PCM --> WAV["pcmToWav(): 包 44 字节 WAV 头<br/>→ 浏览器可播的 .wav"]
  WAV --> Up["uploadBufferToR2()<br/>key: luna-tour/audio/{sessionId}/{beatId}-{lang}.wav"]
  Up --> R2[("☁️ Cloudflare R2")]
  Up --> Write["把 audio_url 写回脚本里的该 beat<br/>+ 记 lt_audio_assets (ready/failed)"]
  Write --> Loop

  Loop -->|全部完成| Done["脚本每段 beat 都带 audio_url<br/>(失败的段留空 → 播放时该段回退系统 TTS)"]
```

**要点：**
- 语音是**预先生成**的（不是播放时实时生成），所以客户打开就能秒播、可暂停/快退、合规可控。
- 某段网络失败不阻塞建库；缺音频的单段在播放时回退浏览器 TTS（其余段仍是 Aoede）。

---

## 3. 播放阶段（客户观看，从 Cloudflare 拉取）

客户打开分享链接 → 公开端点返回脚本（每段带 `audio_url`）→ 引擎按段播放，**每段从 R2 拉 WAV**。

```mermaid
flowchart TD
  Open["客户打开 /v/:code 或 /?toursession=code"] --> API["GET /api/luna/public/v/:code"]
  API --> Script["返回 TourScript JSON<br/>(每个 beat 带 audio_url → 指向 R2)"]
  Script --> Engine["TimelineEngine<br/>顺序 await 播放每个 beat"]

  Engine --> Beat["播放一个 beat"]
  Beat --> Audio["audioTrack: new Audio(audio_url)"]
  Audio --> Fetch["从 ☁️ Cloudflare R2 拉该段 WAV"]
  Fetch --> Play["播放旁白 (Aoede) + 同步运镜/overlay"]
  Play --> Ended{"音频 ended?<br/>(台词说完)"}
  Ended -->|是| Next["→ 转场 → 下一个 beat"]
  Ended -->|否| Play
  Next --> Beat

  Beat -. 客户提问 .-> Live["暂停 → 切 Gemini Live<br/>同 voice=Aoede 实时问答"]
  Live -. 答完 .-> Beat
```

**「说完才转场」的保证**（结构性，非时间猜测）：

```mermaid
sequenceDiagram
  participant E as TimelineEngine
  participant A as audioTrack (R2 WAV)
  participant M as 地图/运镜+overlay

  E->>A: play(narration, audio_url)
  E->>M: 启动运镜 + overlay（按各自时钟，独立触发）
  Note over E: 必须同时满足才推进：<br/>narrationDone && cameraDone && minTime
  A-->>E: onended（台词真说完）→ narrationDone=true
  M-->>E: 运镜跑完 → cameraDone=true
  E->>E: checkBeatDone() 通过 → resolve
  E->>E: 转场 → 下一个 beat（房子）
  Note over E,A: 兜底：max(60s, 该段音频时长+5s)<br/>只延长不缩短 → 永不在说完前切断
```

---

## 4. 关键事实表

| 项目 | 现状 |
|------|------|
| 主旁白声音 | **Gemini TTS，voice=Aoede**（与 Live 问答统一一种声音） |
| TTS 模型 | `gemini-3.1-flash-tts-preview`（可用 `LUNA_TTS_MODEL` 覆盖，有 fallback 链） |
| 音频格式 | 合成为 raw PCM 24kHz/16-bit/mono → 包成 **WAV** 供浏览器 `<audio>` 播放 |
| 一条导览的音频 | **每段台词（beat）一个 WAV 文件**；demo = 11 段 = 11 个文件 |
| 存哪 | **Cloudflare R2**，key=`luna-tour/audio/{sessionId}/{beatId}-{lang}.wav`，公网 `audio/wav` 可达 |
| 何时生成 | 经纪创建 session 时**一次性预录**（非播放时实时） |
| 状态跟踪 | `lt_audio_assets` 表（ready / failed），脚本里 `beat.audio_url` |
| 单段失败 | 该段回退浏览器系统 TTS，其余段仍 Aoede（不影响整体播放） |
| 转场时机 | 台词 `ended`（真说完）+ 运镜完成 + 最短停留 → 才进下一拍 |
| Live 问答 | 客户提问时暂停切 Gemini Live，同 voice=Aoede 无缝衔接 |

---

## 5. 相关代码（全部隔离在 `luna-tour/`，删目录即移除）

| 文件 | 职责 |
|------|------|
| `backend/src/luna-tour/tts.ts` | Gemini TTS → WAV Buffer（PCM 包头、模型 fallback） |
| `backend/src/luna-tour/audio-pipeline.ts` | 遍历 beats → 合成+上传 R2（重试/并发）→ 写回 audio_url + lt_audio_assets |
| `backend/src/luna-tour/regen-audio.ts` | CLI：给已有 session 补/重建音频 |
| `backend/src/services/r2-storage.ts` | `uploadBufferToR2()` 通用上传（复用现有 R2 客户端） |
| `backend/src/luna-tour/session-builder.ts` | createSession 后自动调用音频生成（失败不阻塞） |
| `backend/src/luna-tour/public-router.ts` | `GET /v/:code` 返回脚本（含 audio_url）+ live-token |
| `frontend/src/luna-tour/engine/audioTrack.ts` | 按段播放 audio_url（WAV），回传真实时长 |
| `frontend/src/luna-tour/engine/TimelineEngine.ts` | 顺序播放、事件驱动转场、音频感知兜底 |

> 给已有 session 补音频：`cd backend && npx ts-node src/luna-tour/regen-audio.ts <shareCode> [--force]`
