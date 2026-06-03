# Luna Tour — 进度与待办(下次 pick up 从这里开始)

> 🔵 **打磨清单**:`docs/luna-tour-polish-plan-2026-06-02.md` —— ✅ **四项全部完成(2026-06-02)**,见下「真机打磨第七轮」。下次只剩**真机肉眼复验手感**。

## 2026-06-02 真机打磨第九轮(POI 真名显示 — 证明配套真实)
- **用户疑问**:距离线("学校 0.42km / 医院 0.93km")连到看似空地,是瞎编还是真有?
- **核实(查 DB demo session.snapshot.distances)**:**全是真实 POI**,后端 `session-builder.fetchNearby` 用 PostGIS 查真实 `dubai_pois` 表取每类最近 POI(真名+真坐标+真距离)。如 🏫学校=Canadian University Dubai(0.42km)、🏥医院=Mediclinic(0.93km)、🚇地铁=Dubai Mall/Burj Khalifa、🛍️商场=Business Time Centre、🛒超市=Silver Life Mini Market。前端 `fetchAmenity` 同样走真实 `/api/dubai-pois/near`。
- **根因(为何像空地)**:渲染只显示 `${label} ${km}km`="学校 0.42km",**真名 `s.name` 数据里有却没渲染**;端点仅一个小橙点无名字。
- **修法**:
  - `MapViewMapLibre` amenityGeoJson 给 amenity 点加 `name` 属性;新增 `amenity-poi-label` symbol 层在每个端点显示真实 POI 名字(如 "Canadian University Dubai")。
  - **POI 图标加名字**(用户拍板「高 zoom 显示」):`poi-circles` 同 source 新增 `poi-labels` 层(`minzoom 14.5`,text-optional 防挤,color 按类),放大到一定级别 POI 旁显示真名。
  - 两个新文字层(`amenity-poi-label`、`poi-labels`)加入 `mapTourHandle` 的 `HOST_DISTANCE_LAYERS` 抬升列表 → 压过地铁线(承接第八轮 z 序)。
- 前端 tsc + vite build 全绿;暂停不变量 22/22。纯前端。
- **已有但未充分利用的基础设施**(供下次):`enabledPoiCategories`/`togglePoiCategory`/POI 面板(`showPoiPanel`)/`QUICK_BUTTONS`(医院/学校/超市)/`useDubaiPois({enabledCategories})`/MapPage line ~295 已有 voice mapAction 启用某类 POI。**「AI 选择性显示 POI」触发方式待用户定**(Live 工具 / 自动按 beat / 暂停手动面板),未擅自开发。

## 2026-06-02 真机打磨第八轮(地图图层 z 序系统化 + 隐藏占位站名)
- **症状(真机)**:地铁路线线(红/黄/蓝)盖住了 pin 的字和距离线;地铁站名显示 "New Stop 6/7/8/13/14/15" 占位噪音。期望栈(上→下)= **pin+字 > 距离线标识 > 路线 > area 字+色块**。
- **根因**:共享主地图时,距离线/便利度其实是**主地图 `measure-*`/`amenity-*` GL 图层**画的(tour 经 `sink` 驱动),不是 `lt-dist`;transit 路线是 `transport-*`。`life` beat 切 transit 时 **react-map-gl 按挂载时机把路线插到了 measure/pin 之上** → 盖住。
- **修法(系统化,权威排序函数)**:
  - `mapTourHandle.ts` 新增 `raiseNow()`:按 canonical 顺序(下→上 `HOST_DISTANCE_LAYERS`[measure/amenity 线+标签] → `lt-` 线 → `lt-focus-ring` → `lt-props-sym` 钉)对存在的图层逐个 `map.moveLayer(id)` 抬到顶 → 最终栈恰好 = 该顺序,**始终压过 transit/area/poi**。每次 tour 加图层(pin/焦点环/距离线)后调一次。
  - 新增 `raiseTourLayers()`(暴露给 overlay):`raiseNow()` + **短重试**(6×60ms),因 host transit/measure 图层是 react-map-gl 异步挂载(在触发它的同步 beat-enter 之后)。`TourOverlay` 的 sink(measure/amenities/transit/areaMetric)每次切换后调它 → 路线挂上来后被重新压到底。无事件回环(有界 timer)。
  - JSX 里 host 图层顺序本就是 area<labels<transit<poi<measure<amenity(已对),问题只在挂载时机 → 命令式排序确定性修复,且不与 react-map-gl 打架(measure/amenity 在 JSX 里本就在 transit 之上)。
- **附带修复**:`MapViewMapLibre` 的 `transport-stations-labels`(站名文字)在 `chromeless`(导览播放态)时 **react 条件隐藏** → 播放时不显示 "New Stop X" 噪音(站点圆点+路线保留),暂停态恢复显示。react 驱动、无命令式状态泄漏到普通地图。
- 前端 `npx tsc --noEmit` 0 错 + `vite build` 通过。**纯前端,push 自动 deploy。**
- **仍需真机确认**:transit 开启的 `life` beat 时,路线确实在距离线/pin 之下、area 名在最底;"New Stop X" 播放时消失。

## 2026-06-02 真机打磨第七轮(暂停同时钟 + CC/字幕/mobile,已验证 tsc+build+不变量)
- **任务1(命脉)暂停/恢复全部跟同一时钟 ✅**:
  - 根因:① resume 时旁白从头重念但相机时钟从中点继续 → 相机先跑完轨道 `sampleAt` 返回静止终态 → **镜头冻结**;② `armBackstop` 用 `window.setTimeout`,**暂停时不清除** → 长暂停/跟 AI 对话期间 backstop 触发 → beat 在暂停期间自己往前推(「连续多次暂停问题」「跟 AI 说完被打扰」);③ `pause()` 无幂等 → 重复调用用过期 `beatClockStart` 算坏 `beatElapsed`。
  - 修法(`TimelineEngine.ts` + `audioTrack.ts`):
    - **backstop 改为 `beatElapsed` 阈值**(在 rAF tick 里判定,不再用 setTimeout)→ 暂停时随时钟一起冻结,永不在暂停期间推进。
    - **mp3/WAV 就地暂停/恢复**:`audioTrack.pausePlayback()`(暂停元素、保留 `onended`)/`resumePlayback()`(继续播放,返回是否就地恢复)。引擎 resume 时若 mp3 可就地恢复 → `beatClockStart = now - beatElapsed` 继续同一时钟,相机/旁白/overlay 完美锁步、镜头不冻结、台词自然念完。
    - **TTS 兜底**(无 mp3)才重念,且 `restartBeatClock()` 把 beat 时钟归零(相机+overlay+旁白同步重跑,不冻结)。
    - **不变量保护**:`pause()` 幂等;`checkBeatDone()` 开头 `if (paused) return` → **暂停期间任何门都不推进 beat**(跟 AI 聊多久都不丢拍)。
  - **headless 不变量测试**:`frontend/luna-tour-pause.invariant.mts`(`npx tsx` 跑,stub performance/rAF/Audio/speechSynthesis)→ **22/22 全过**:mp3 就地恢复不新建元素、长暂停(70s>backstop)不推进、camera 恢复后继续动、反复横跳 6 次时钟不串、backstop 仍能兜住真卡死(>60s)、TTS 重念后镜头不冻。
- **任务3 CC 可点 ✅**:暂停时主地图工具占据**上方左右两角**(filter pills 左上 / metric+POI 右上),CC/mute 原在右上被挡。**挪到底部右角**(`bottom:18px; right:16px/62px`,z-index 9 + pointer-events auto)→ 所有状态都不冲突、始终可点、不随状态跳位。ended 态隐藏(replay 屏干净)。
- **任务2 字幕变小 ✅**:`.lt-subtitle` 字号 `clamp(15,2.4vw,20)`→`clamp(12,1.6vw,15)`、底色 0.62→0.42、padding 收窄、位置降到 `bottom:64px`、字重 600→500;保留阴影(卫星可读)。
- **任务4 mobile ✅**:`@media(max-width:640px)` 加:章节条 `94vw`/gap6,**仅当前章节显示名字**(其余只剩进度条)不挤屏;CC/mute 缩到 34px 更靠角;字幕 `bottom:56px`/90% 宽。
- 前端 `npx tsc --noEmit` 0 错 + `vite build` 通过(2557 模块)。**纯前端,push 自动 deploy,后端无需动。**
- **仍需真机肉眼复验**:暂停→恢复镜头是否真的无缝续转、跟 Luna 说完恢复是否无缝、底部右角 CC/mute 不被任何工具挡、手机章节条/字幕观感。手感旋钮见 polish-plan §旋钮速查。



> 更新:2026-06-01(经纪台多页重构 + AI 选房报告/匹配;前后端 tsc + vite build 全绿、端点真实 200)
>
> ## 2026-06-01 本次 pick up(经纪台 hub 重构,已验证)
> - **路由重构**:旧单页 `AgentDashboard`/`AgentPortalPage` 删除,改为 `/agent` hub(`AgentLayout` 左侧栏 + 嵌套路由):`index=AgentOverview` 概览、`tour=AgentTours` 生成导览、`report=AgentReport` 选房报告。新增 `/agent/join`(`AgentJoin` onboarding,翻转 localStorage `profile.agent`)。旧 `/luna/agent[/*]` → `Navigate /agent`。
> - **网关**:`AgentLayout` 读 `profile.agent`,非经纪 → `/agent/join`。Header/MobileNav 入口按是否经纪切「经纪台 agentHub / 成为经纪 becomeAgent」(en+zh-CN nav.json 已加词条)。
> - **后端新端点**(`agent-router.ts`):`GET /projects/search`(选房 picker)、`POST /match`(`auto-match.ts` AI 选房+理由)、`POST /report`(`auto-report.ts` AI 选房+5年ROI+场景)、`GET /sessions/:id/script` + `PATCH /sessions/:id`(故事板逐段编辑)、`sessions/create` 的 share_code/title 改为可省略(自动生成唯一码 + 按客户名生成标题)。
> - **本次修复**:① `TourOverlay.tsx` 删未用 `progress`/`total`(build 报错 TS6133,进度条已改分段式);② `AgentOverview` 两处 `Link` 旧路径 `/luna/agent/tour` → `/agent/tour`(否则被 `/luna/agent/*` 重定向吃掉 subpath 跳错到概览)。
> - **冒烟实测(backend dev :3000)**:`/public/v/demo` 200;`/agent/sessions` 返真实数据(含新格式标题「为 卢先生 精选的 2 个家」);`/projects/search` 正常(注意本库 area 多为空、无 "marina" 命中属数据非 bug);`/report` 端到端跑通真 AI + 真 ROI 投影 + 中文 summary 自然,UTF-8 输入回显正确(`陈先生`/`香港投资客重回报`)。
> - **待真机**:`/match` `/report` 麦克风无关但 `/match` 未单测(逻辑同 report);切 Live 问答仍需真机麦克风+计费验证(见 Phase 1)。
>
> ---
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

### ✅ 相机与音频同步(2026-06-02,真机反馈后修)
- **真机报的 4 个问题**:① 不围着 property 转、镜头经常停;② 话说完镜头还在 zoom 几秒;③ 介绍跟动作没配齐时间;④ 切下一个房子是「闪现」没 flyto。
- **根因**(看 demo 真实脚本数据坐实):相机轨时长用脚本写死的 `at_ms/duration_ms`,与真实 WAV 时长无关 → 相机短于音频则跑完静止、长于音频则话说完还在动;`sampleAt` 在段间/末尾 hold 静止 → 冻结;转场 flyover 与 beat 自带 in-place flyover 都 `at_ms=0` 撞车被遮蔽 → 飞行从不被采样 → 闪现;life/numbers 是单静态 keyframe → 不转。
- **修法**:
  - `cameraTrack.ts` 重写为 **顺序无缝**(忽略 `at_ms` 布局,cues 背靠背)→ 消除间隙冻结 + 撞车遮蔽(flyto 不再被吃);**静态 keyframe 注入 ambient orbit(24°)** → 永不冻结;**丢弃 no-op flyover**(目标≈当前位置,按运行中 cur 判定,非脚本 from)。
  - `TimelineEngine.ts` 加 `camScale` **时间缩放**:拿到真实音频时长后 `camScale = audioMs / track.duration`,采样 `sampleAt(beatElapsed/camScale)`,`cameraDone` 在 `beatElapsed >= track.duration*camScale`(=音频时长)→ **相机运动正好铺满整段旁白,说完同步到位转场**。
  - 兜底同理音频感知(见上)。前端 tsc + vite build 全绿。
- **headless 验证**(tsx 跑 cameraTrack 不变量,6/6 通过):flyTo 中途在 A↔B 之间(不闪现)、按时到 B、orbit 期间 bearing 旋转、每 100ms 位移 0.008°(平滑无跳变)、静态 keyframe bearing 0→24°(持续动)。**仍需真机肉眼确认手感**(camScale 与音频同步只在浏览器真音频下完整体现)。

### ✅ Pin 抖动 + 字幕 + 转场(2026-06-02 第二轮真机反馈)
- **Pin 抖动/zoom 后超小**:根因=导览房源 pin 是主地图 DOM `<Marker>`(`ProjectPinMarker`)+ 焦点环 `pulseAt` 也是 DOM marker → 每帧 `jumpTo` 运镜下 DOM 重投影有亚帧延迟 → 抖;CSS 固定尺寸 → 不随 zoom 放大。**修法**:`mapTourHandle` 新增 `setPropertyPins()` 用 **GL 图层**(glow+dot circle,`circle-radius` 按 zoom interpolate)画房源 pin;`pulseAt` 重写为 GL `lt-focus-ring`(rAF 脉冲);`highlightPins` 改 no-op(GL 层已显示全部)。`TourOverlay` 导览时 `onPins([])` 不再发 DOM pin,改 `setPropertyPins`(explore 用缩略图 strip,不依赖地图 pin 点击)。GL 同帧渲染 → **零抖动 + 随 zoom 缩放**。
- **字幕(可开关)**:`EngineSnapshot` 加 `narration`;`TourOverlay` 加 `.lt-subtitle` 字幕条(播放时显示当前旁白,satellite 上黑底+阴影可读)+ 右上 `CC` 开关(localStorage `lt-subtitles` 持久化,默认开)。
- **转场跳**:主因即上面的 DOM pin/pulse 抖动(GL 化后大幅改善);相机本身顺序无缝+时间缩放已保证连续(camEntry 链式 finalState 衔接)。
- 前端 tsc + vite build 全绿。**纯前端,无需重生成音频**。**仍需真机确认手感**(GL pin 大小/脉冲速度、字幕位置可再微调:pin radius interpolate 在 `mapTourHandle.setPropertyPins`,字幕样式 `.lt-subtitle`)。

### ✅ Pin 找回 + 控制条重做(2026-06-02 第三轮真机反馈)
- **Pin 不见了**(上一轮 GL 化的 regression):`setPropertyPins` 只在 `[data]` effect 调一次,此时 `mapRef` 可能未就绪 → 没画。**修**:在 `startEngine`(mapRef 保证非空)补调 `setPropertyPins`;并把 pin 调大调亮(accent 实心点+白描边,glow zoom9→14/zoom16→50,dot zoom9→6/zoom16→16),satellite 上醒目、随 zoom 放大、GL 同帧零抖动。
- **控制条重做**(用户拍板):① 发现顶部 `lt-segbar` **根本无 CSS=隐形死代码**,用户看到的「3 点」其实是底部 `lt-ov-dots`。② 顶部换成**章节条 `.lt-chapters`**:每个房子一段,带序号+房子名,done/active 高亮,点击 `seekToAct` 飞过去回看(直观知道在第几个家、可跳)。③ **删底部 3 点**(`lt-ov-dots` 不再渲染)。④ **删 Luna 暂停按钮**(`lt-luna`),改:点屏幕任意处暂停(stage-tap 已有)+ 暂停态显示 `.lt-resume`「继续观看」按钮(暂停态地图可自由平移探索,故 resume 用按钮不用全屏 tap,避免冲突)。
- 前端 tsc + vite build 全绿。纯前端。
- **遗留/可选**:地图上 "New Stop X" 橙色 marker 是主地图 transit 图层的占位命名(life beat `onTransit` 打开的),命名像 debug,导览时偏乱——是否导览时隐藏/改名待定。

### ✅ 缩略图 pin(2026-06-02 第四轮)
- **GL 圆点 pin 用户还是看不清**(淹没在主地图 POI 圆圈里),且要带缩略图。**R2 缩略图无 CORS 头** → 没法画进 WebGL canvas 图标。
- **改用原生 `maplibregl.Marker`**(关键:之前抖的是 **react-map-gl `<Marker>`**,走 React 重渲染跟不上 60fps 运镜;**原生 maplibre marker 由地图 render 循环同步定位,不经 React → 不抖**,`<img>` 显示缩略图也不需要 CORS)。`mapTourHandle.setPropertyPins` 重写为原生 marker:**缩略图卡片(58px,accent 描边)+ 可选名字 pill + 小箭头 stem**,anchor=bottom 指向坐标。persist across beats,`setPropertyPins([])` 清除。GL 焦点环(pulseAt)保留作当前房源强调。
- 前端 tsc + vite build 全绿。demo 三房源均有缩略图。

### ✅ 3 点/开场/转场(2026-06-02 第五轮)
- **3 个点还在**:不是 `lt-ov-dots`(已删),是 `progress_dots` **overlay**(`OverlayLayer.tsx`)。章节条已替代 → 该 case 直接 `return null`。
- **开场绕迪拜旋转 + 浅 blur**:`TourOverlay` 加 effect——未开始(`!snap`)时 rAF 让镜头绕房源中心慢转(zoom 10.2/pitch 55/bearing+0.05),开始即停。`lt-greet` 遮罩从 `0.72→0.94`+blur6 减淡到 `0.42→0.66`+blur3(浅 blur,旋转的迪拜透出来),标题加 text-shadow 保可读。
- **转场突兀/flicking**:① `cameraTrack` flyover 改**拉远弧线**(sin 曲线 mid-flight zoom 拉到 `min(zoom)-pull`,pull 随距离;远距离不再低空快速平移=减少卫星瓦片闪烁+不突兀)+ **距离自适应时长**(远的更长不赶)。② 修 bug:之前"原地 flyover"被当 no-op 丢弃 → arrival 不 zoom-in 停在远景;改为「移动 OR 变焦」才保留,纯推近(in-place zoom)也保留 → arrival 正确推近。
- 前端 tsc + vite build 全绿。纯前端。

### ✅ Pin 彻底不抖(2026-06-02 第六轮,GL symbol)
- **原生 maplibre marker 仍抖**:确认任何 DOM 标记在每帧 jumpTo 运镜下都有亚帧延迟 → 唯一不抖=画进 WebGL。卡点是 R2 缩略图无 CORS。
- **解法**:后端 `public-router` 加 **CORS 图片代理** `GET /api/luna/public/img?u=<R2 url>`(校验只代理 `pub-*.r2.dev`,加 `Access-Control-Allow-Origin:*` + cache)。前端 `mapTourHandle.setPropertyPins` 重写为 **GL symbol 图层**:把「缩略图卡片+名字+stem」用 canvas 合成 → `map.addImage` → symbol layer(`icon-anchor:bottom`,`icon-size` 随 zoom 插值)。图片经代理加载(canvas 不被污染)。**GL 同帧渲染 = 绝对不抖**,且随 zoom 缩放、带缩略图+名字。已实测代理 200 + ACAO。
- 前后端 tsc + 前端 build 全绿。**注意:后端新端点(img 代理等)需手动 `hetzner-deploy.ps1` 部署;前端 push 自动 deploy。**

### 🟡 Phase 2 创作闭环(剩余)
- **故事板编辑器**:幕/beat 预览、改旁白/重排/重生成某段、发布。需 `lt_tour_scripts` script-edit 接口 + 编辑 UI(MVP Dashboard 已能「整体生成」,缺「逐段编辑」)。
- **经纪真登录/CRM**:现 Dashboard 无 auth(demo agent);需 `requireAgent` + 客户 CRM。

### ✅ Phase 3 根治音频(2026-06-01 完成,主旁白改用 Gemini 语音)
- **目标**:主导览旁白从「浏览器系统 TTS 兜底」改成 **Gemini TTS 预生成(voice=Aoede)**,与切 Live 问答**统一一种声音**。
- **新文件**(全隔离在 `backend/src/luna-tour/`):
  - `tts.ts`:`synthesizeSpeech(text,{voice})` → Gemini TTS(模型 fallback,默认 `gemini-3.1-flash-tts-preview`,可 `LUNA_TTS_MODEL` 覆盖)→ 返回 **WAV Buffer**(`pcmToWav` 给 raw PCM 24k/16bit/mono 包 44 字节头,浏览器 `<audio>` 可放)。
  - `audio-pipeline.ts`:`generateSessionAudio(sessionId,{force,concurrency})` → 遍历 intro/各 act beats/outro → **合成+上传 R2 整体重试**(`withRetry` 3 次退避)→ 写回 `beat.audio_url` 到存储 script + upsert `lt_audio_assets`(ready/failed)。并发默认 2(本地连 R2/Gemini 抖动,降并发+重试治 ECONNRESET/超时)。失败不抛(缺音频的 beat 前端按段回退系统 TTS)。
  - `regen-audio.ts` CLI:`npx ts-node src/luna-tour/regen-audio.ts <shareCode|sessionId> [--force]` 给已有 session 补/重建音频。
- **改现有文件(最小)**:
  - `services/r2-storage.ts`:加导出 `uploadBufferToR2(key,buffer,contentType)`(通用公共上传,可复用)。
  - `session-builder.ts`:createSession 持久化 script 后调 `generateSessionAudio`(COMMIT 之后,try/catch 不阻塞建库)。
  - 前端 `engine/audioTrack.ts`:`play()` 加 `onMeta(durationMs)`(`loadedmetadata` 回传真实时长)。
  - 前端 `engine/TimelineEngine.ts`:**音频感知兜底**——`armBackstop()`,拿到真实音频时长后把 backstop 设为 `max(60s, clipLen+5s)`,**只延长不缩短**,从结构上保证「兜底永不在台词说完前触发」(消除超长台词被切的理论缺口)。
- **「说完才转场」保证(用户命脉关切)**:`playFrom` 是顺序 `await playBeat()`;`playBeat` 只在 `checkBeatDone()`(`narrationDone && minTimeDone && cameraDone`)resolve;`narrationDone`(非静音、有音频)只在 WAV `ended`(真说完)置位。运镜/overlay 按各自 beat 时钟独立触发,不依赖音频。**结构性保证 + 实测**:demo 最长台词 30.2s «« 60s 兜底。
- **实测(demo session)**:11/11 beat 全部 ready,公开端点 script 每个 beat 带 `audio_url`;WAV 公网 200 `audio/wav`(单段 0.6–1.4MB,13–30s)。前后端 tsc + vite build 全绿。
- **遗留**:① WAV 体积偏大(整段 tour ~8MB),后续可换 mp3(需编码依赖);② 本地→R2 网络抖动需重试,生产(Hetzner)网络更稳;③ 预加载下一段音频可减少切拍瞬间的网络延迟(非阻塞,体验优化)。
- 遥测真实分钟数计入 `usage_counters` 仍待补(Live 用量目前用 `ask` 事件计数)。

### 🟢 其他小优化
- 「展示区域价值」现在绑定「数字」beat 自动触发(`medianUnitPrice`)。若要 AI 逐 beat 精确指定(哪一刻/哪指标),需给 TourScript 加 overlay 类型 + 重新生成。
- 经纪行为分析面板(遥测数据已在流入):单 session 时间线 + lead_score 排序 + 「正在看」SSE 提醒。

## 全程纪律
- 每阶段:前后端 `npx tsc --noEmit` + 本地跑通 + 关键路径手测。
- 保持隔离:新代码进 `luna-tour/` 目录;改现有文件仅限"加一行挂载",并在本文件记录改了哪里,方便回滚。
