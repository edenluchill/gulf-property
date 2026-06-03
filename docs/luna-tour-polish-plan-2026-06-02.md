# Luna Tour 前端打磨任务清单(2026-06-02)

> ✅ **全部完成(2026-06-02)**——实现细节与不变量测试见 `luna-tour-progress.md`「真机打磨第七轮」。下方保留原始任务描述供参考;**剩余仅真机肉眼复验手感**。
> - 任务1 暂停/恢复同时钟 ✅(mp3 就地恢复 + backstop 改 beatElapsed 阈值 + 暂停期不推进 + TTS 重念归零;22/22 不变量过)
> - 任务2 字幕变小 ✅  · 任务3 CC 挪底部右角始终可点 ✅  · 任务4 mobile 紧凑 ✅

> 真机反馈后的一批前端体验问题。**逐个处理,不急**。每条含:症状 / 根因猜测 / 改哪里 / 思路。
> 全部是**前端**(`frontend/src/luna-tour/`),纯前端、push 自动 deploy(后端无需再动)。
> 处理前先 `npx tsc --noEmit` + `npx vite build` 基线,改完同样验证。

## 关键背景(给新 context)
- 客户观看页:`MapPage.tsx`(读 `?toursession=` / `/v/:code`)→ `TourOverlay.tsx` → `engine/TimelineEngine.ts`(单 rAF 时钟,采样 `engine/cameraTrack.ts` 相机轨 + `engine/audioTrack.ts` 旁白)→ `overlays/OverlayLayer.tsx` + `map/mapTourHandle.ts`(GL 相机/pin/焦点环)。
- 单时钟设计:相机 `jumpTo` 每帧由引擎时钟驱动(为了暂停同步)。`camScale` 把相机轨时长缩放到真实音频时长。
- 暂停态:`TourOverlay` `isPaused` → `setToolsRevealed(true)` → 主地图(`MapViewMapLibre`)恢复显示右上角工具(价格/卧室/状态/开发商 + 中位数/交通/医院/学校/超市 + 3D/卫星/测距)。**这批工具会和导览 UI(尤其右上 CC 按钮)打架。**
- 样式集中在 `luna-tour/luna-tour.css`。

---

## 任务 1(最高优先 / 最难)— 暂停/恢复必须万无一失,全部跟同一时钟
**症状**:① 镜头旋转时暂停→再开始,镜头不再继续旋转(动作停了);② 连续多次暂停问题很多;③ 暂停后跟 AI(Live Q&A)说话,恢复后体验被打扰。
**要求**:客户**无论怎么暂停、暂停期间有没有跟 AI 说话**,恢复后都**无缝继续**——语音、相机、overlay、所有动作都跟**同一个时钟**,不串台、不卡死、不丢帧。
**根因猜测**(需核实 `TimelineEngine.ts`):
- `pause()` 冻结 rAF 时钟 + `audio.stop()`;`play()` 恢复时 `beatClockStart = now - beatElapsed` 并「从头重念」当前 beat 旁白(`!narrationDone` 时 re-speak)。但**相机用的是 `camScale` + `beatElapsed/camScale` 采样**——恢复后 `camScale` 可能未重设(它在 `onMeta` 设,re-speak 触发新的 `onloadedmetadata` 会重设 camScale,但时序/`beatElapsed` 基准可能错位)→ 相机不动/跳。
- 连续暂停:`backstop`、`narrationDone`、`minTimeDone`、`camScale`、`beatClockStart` 多个状态在反复 pause/resume 下可能不一致。
- Live Q&A(`useTourLive.ts`)接管音频/麦克风;`enterAsking()` 暂停;恢复(`handleResume`)`live.disconnect()` + `engine.play()`——要确保 Live 结束后引擎状态干净。
**思路**:把「当前 beat 的播放进度」做成**单一权威时钟**(一个 elapsed 累加器,pause 冻结、resume 继续),相机/音频/overlay/backstop 全部从它派生;resume 时:重设 camScale(已知音频时长则直接用)、从暂停的 elapsed 继续采样相机(不要从 0、也不要跳到末尾)、旁白可从头重念但相机不重置。写几个 pause/resume + 反复横跳的不变量测试(tsx 跑 engine mock,类似之前 `_camtest`)。

## 任务 2 — 字幕变小、别太显眼
**症状**:字幕太大太抢眼。
**改哪里**:`luna-tour.css` `.lt-subtitle`(现 `font-size: clamp(15px,2.4vw,20px)`,黑底卡片)。
**思路**:字号调小(如 `clamp(12px,1.6vw,16px)`)、底色更淡/更窄、位置可略降,低调但仍可读(satellite 上保留阴影)。

## 任务 3 — 点屏幕弹出的 filter / 工具挡住 CC,CC 点不到
**症状**:点击屏幕(暂停)后,主地图右上角工具(中位数/交通/3D/卫星/测距…)弹出,和右上角 `CC` 按钮重叠 → CC 按不到(见截图圈出区域)。
**根因**:暂停 `setToolsRevealed(true)` 让 `MapViewMapLibre` 工具显示在右上;`TourOverlay` 的 `.lt-cc`/`.lt-mute` 也在右上(`top:20px; right:64px/18px`)→ 撞车。
**改哪里**:`TourOverlay.tsx`(CC/mute 渲染)+ `luna-tour.css`(`.lt-cc`/`.lt-mute`)。
**思路**:把 CC(和静音)挪到**不与主地图工具冲突**且**始终可点**的位置(如左下、或字幕旁、或底部控制区);确保 `z-index` + `pointer-events` 正确,暂停态也能点。考虑暂停时工具栏出现就把 CC 让位。

## 任务 4 — Mobile view 要好看,新 feature 别挡太多屏幕
**症状**:章节条/字幕/explore strip/CC/mute/继续观看 等在手机上占太多、挡视野。
**改哪里**:`luna-tour.css` 各 `.lt-*` 加移动端断点;`TourOverlay.tsx` 必要时按视口精简。
**思路**:小屏下章节条更紧凑(或只显示当前章节名+左右箭头)、字幕更小、explore strip 高度收敛、按钮缩小并避免遮挡地图与 pin。整体「沉浸式、少遮挡」。

---

## 处理顺序
1. **任务 1**(暂停/恢复同时钟)— 体验命脉,先做,务必加不变量测试。
2. **任务 3**(CC 可点 / 不被工具挡)— 影响可用性。
3. **任务 2**(字幕变小)— 快。
4. **任务 4**(mobile 适配)— 收尾整体打磨。

## 旋钮速查(改手感用)
- 相机/暂停:`TimelineEngine.ts`(`camScale`、`MIN_BEAT_MS`、`MAX_BEAT_MS`、`AUDIO_BACKSTOP_PAD_MS`、`pause/play/startClock`)
- 相机轨:`cameraTrack.ts`(`AMBIENT_ORBIT_DEG`、`ARRIVAL_ZOOM`、flyover arc `pull`)
- pin:`mapTourHandle.ts` `setPropertyPins`(`icon-size` interpolate、卡片 60px)
- 字幕/CC/章节条/resume/greeting:`luna-tour.css`(`.lt-subtitle` `.lt-cc` `.lt-chapters` `.lt-resume` `.lt-greet`)

## 备忘(非本批,待定)
- 主地图 transit "New Stop X" 占位命名,导览时偏乱(是否隐藏/改真实站名)。
- 仓库未提交垃圾:`nul` `backend/nul` `deploy-log.txt` `backend/.env.backup`(密钥!勿提交)`voice-debug-logs/`。
- 部署脚本 `hetzner-deploy.ps1` 小 bug:`PORT=(\d+)` 误匹配 `DB_PORT` → 应锚定 `^PORT=`(无害)。
