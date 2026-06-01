# Luna Tour — 性能铁律(任何新 feature 必须遵守)

> 2026-06-01 · 反复出现「tour 一卡一卡」后立的硬规矩。
> 北极星 KPI:运镜 60fps,永不卡顿。**任何新功能合并前,自检这份清单。**

## 为什么会卡(根因模型)

tour 的电影运镜靠地图自己的 rAF **每帧移动相机**。卡顿 = 主线程在「相机要重绘的那一帧」被别的工作抢占。三大元凶:

1. **每帧 React 重渲染** —— 相机动 → 触发 state 变化 → React reconcile 整棵地图组件树。
2. **大量 DOM marker** —— maplibre 对**每个** DOM `<Marker>` 在每帧重算屏幕坐标。几百个搜索 pin = 几百次/帧。
3. **相机移动回调反噬** —— `onMove`/`onBoundsChange` 在相机动时 setState → 回到第 1 条,形成「动→渲染→更动」的反馈。

## 已修(2026-06-01)

| 根因 | 修法 |
|---|---|
| 几百个搜索 pin DOM marker | tour 时 landmark/cluster DOM marker 用 `{!tourActive && ...}` 隐藏;**project pin 仍渲染但 `projects` 只传 tour 的 2-3 个楼盘**(TourOverlay 经 `onPins` 上报给 MapPage)→ 既只剩几个 marker(不卡)、又是**原生可点 pin**(点击走现有 details)。⚠️ 早期试过 `setBasePins` 自画 DOM marker——不可点、看不到 details,已废弃。 |
| 相机动 → bounds setState → 重渲染 | tour 时 `onBoundsChange={undefined}`,且 `projects={EMPTY_PINS}`(稳定引用)。 |
| 引擎每帧 `setSnap` → 重渲染 overlay | `maybeEmit()` 节流:仅状态/段/overlay/mute 变化时推,否则 ≤ ~12fps。 |
| 受控 viewState 与命令式相机打架(抖动) | tour 时 `tourActive` 让地图**非受控**(`initialViewState`,onMove 不回写)。 |

## 硬规则(写新功能时照做)

### R1 — 相机移动期间,零 React 重渲染
- 任何"每帧"的东西(进度、计时、相机插值)**绝不能**走 `setState`。用 rAF + 直接 DOM/地图 API,或节流到 ≤12fps 再 setState。
- 引擎→React 的推送一律走 `maybeEmit()`(有签名去重 + 时间节流)。新增 snapshot 字段时,记得纳入签名,别让它每帧变化。

### R2 — tour 期间不要 DOM marker 海
- 不要在 tour 模式渲染「按数据条数 map 出来的 `<Marker>`」。用:
  - **GeoJSON symbol layer**(GPU 渲染,几千个也不卡)——首选;或
  - `mapTourHandle` 的少量命令式 marker(基 pin/高亮/距离标签,个位数)。
- 新功能若要在 tour 地图上加点位,**先问:会有多少个 DOM 节点?** >十几个就必须用 symbol layer。

### R3 — 不要监听相机移动来驱动状态
- tour 时禁用 `onMove`/`onBoundsChange`/`onMoveEnd` 里的 setState/网络请求。相机一直在动,这些会持续触发。
- 需要"当前看哪"时,从引擎的 beat 状态拿(它知道),不要从地图 bounds 反推。

### R4 — 地图在 tour 时保持非受控
- 命令式相机(flyTo/orbit/setBearing)与受控 `viewState` 会每帧打架 → 抖动。tour 必须走 `tourActive` 的非受控分支。新增地图交互别重新引入 onMove→viewState 回写。

### R5 — 重活放 rAF 外 / 预取
- 配套分析、POI 查询、音频解码等**重活预取**(beat 开始前),别在运镜帧里同步算。tour 已对 amenity 预取——照此模式。

### R6 — 自检手段
- Chrome DevTools → Performance 录一段运镜,看有没有掉帧的长任务(>16ms)。长任务点开看是 React commit 还是 marker repaint。
- 简单验证:tour 播放时 `Performance.now` 打点相邻两帧间隔,稳定 ≈16ms 即 60fps。

## 一句话给未来的自己
**运镜帧是神圣的。** 那 16ms 里只允许地图自己画。任何你加的东西——状态、marker、回调、网络——都要么挪出运镜帧,要么节流,要么用 GPU 图层。卡了就回这份清单逐条查 R1–R5。
