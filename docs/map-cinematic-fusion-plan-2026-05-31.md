# 主地图 × Luna Tour 电影皮肤 — 融合方案

> 2026-05-31
> 目标:让 homepage 主地图(`MapViewMapLibre`)同时拥有 ——
> ① Luna Tour demo 的炫酷表现(夜景皮肤 / 3D 倾斜 / 运镜 / 发光)
> ② 卫星地图(已有)
> ③ 它原本的全部功能(市场价值热力 / POI / 区域 / 测距 / 语音放射图 / 交通)
> 三者**自由切换、互不丢失功能**。

## 为什么可行(不用重写)

1. **同一个引擎**:demo 的 `TourMap` 和主图 `MapViewMapLibre` 都是 maplibre-gl + CartoCDN 免费矢量瓦片。炫酷皮肤/运镜本质是**参数**,不是另一套技术。
2. **底图切换机制已现成**:主图已有 `BaseMap = 'vector' | 'satellite'`(localStorage 持久化 + 右上角按钮)。卫星图就是这么挂的 —— 加一档 `'dark'` 夜景是同样套路,零新风险。
3. **数据图层与底图解耦**:热力(area-fills)/POI(poi-circles)/区域/交通都是叠加在底图上的 `<Source>/<Layer>`,换底图不影响它们的存在;切到卫星已证明换 style 后图层会自动恢复。

## 最终形态(按用户 2026-05-31 反馈修正)

**关键修正**:用户对夜景皮肤兴趣一般;**真正要的是「倾斜(3D)」,且与底图解耦——尤其卫星图也要能倾斜**。运镜用「电影 flyTo 俯冲」,不要 orbit。

- 底图三档:**地图 / 卫星 / 夜景**,循环切换(夜景作为可选项保留,非重点)。
- **3D 倾斜 = 独立开关**,任意底图(地图/卫星/夜景)都能开。
- 导航(搜索/点击)在 3D 开启时走**电影 flyTo 俯冲**(带 pitch + ease)。

## 实施步骤(增量、可回滚,不碰 luna-tour 隔离代码)

| # | 步骤 | 改动 | 难度/风险 | 状态 |
|---|---|---|---|---|
| 1 | 加夜景底图档(可选项) | `MAP_STYLE_DARK`(dark-matter) + `BaseMap` 扩 `'dark'` + mapStyle 选择加档 + 切换按钮三态循环 | 🟢 低 | ✅ 已完成 |
| 2 | **独立 3D 倾斜按钮** | viewState 补 pitch/bearing;`toggle3D` 用 `map.easeTo({pitch})` 平滑切换;右上角「3D」按钮;**任何底图通用** | 🟡 中 | ✅ 已完成 |
| 3 | **电影 flyTo 俯冲** | `flyToLocation` effect:3D 开启时带 `pitch:60` + `curve:2.0` + 更长时长俯冲;平视时维持原行为 | 🟡 中 | ✅ 已完成 |
| 4 | 卫星倾斜优化(sky/雾) | 卫星(raster)高 pitch 时远处是背景色、无天空 → 加 sky 层 / 雾化远景,更真实 | 🟢 低 | ⬜ 可选 |
| 5 | 夜景配色 + 发光特效 | 深色底下热力/POI 霓虹高对比 + pin 发光(纯 CSS,仅 dark 档) | 🟢 低 | ⬜ 可选(用户对夜景兴趣一般,降优先级) |

## 风险与纪律

- **主图是搜索 app 核心、耦合重**(语音助手 / 点击 / bounds 同步都挂它上)→ 比改隔离 demo 风险高。每步 `npx tsc --noEmit` + **不破坏亮色/卫星模式** + 手测。
- **换 style 时自定义图层重挂**:现有卫星切换已证明 OK;dark 是 vector 样式,切到 dark 再切回也走同一条 react-map-gl 路径,需手测确认 POI/area 恢复。
- **开放 pitch/旋转后地图可能被转歪** → 步骤 3 要配「复位正北/俯视」按钮或限制 pitch 范围。
- **dark 底色下现有热力配色对比度**:现有色映射是为亮底设计的,深色底要重调(步骤 4),否则看不清。
- **真 3D 楼**(楼一栋栋立起来)需付费瓦片(MapTiler/Mapbox,要 key/计费)—— 单列,本方案不含,后续单独评估。

## 决策(已定,2026-05-31)

1. **3D 倾斜**:✅ **独立「3D」按钮**,不绑底图。
2. **运镜程度**:✅ **电影 flyTo 俯冲**(不要 orbit)。
3. **作用范围**:✅ **夜景 + 卫星(及地图)都生效**——倾斜与底图完全解耦。

## 已完成(步骤 1–3)

`frontend/src/components/MapViewMapLibre.tsx`(全仓 `npx tsc --noEmit` 0 错误):
- **步骤 1**:`MAP_STYLE_DARK`(dark-matter) + `BaseMap` 加 `'dark'` + mapStyle 选择加档 + 右上角底图按钮三态循环「地图/卫星/夜景」(夜景态按钮变深色)。
- **步骤 2**:`viewState` 补 `pitch/bearing`;`CINEMATIC_PITCH=60`;`pitched` state + `pitchedRef`;`toggle3D()` 用 `map.easeTo({pitch})` 700ms 平滑切换;右上角新增「3D」按钮(`top-28 right-24`,开启时翠绿高亮),**任何底图通用**。
- **步骤 3**:`flyToLocation` effect 读 `pitchedRef.current`,3D 开启时 `flyTo` 带 `pitch:60 + curve:2.0 + 2400ms` 俯冲;平视维持原 `curve:1.8/2000ms`。用 ref 而非 deps,避免切 3D 触发重复飞行。

**验证(需手测)**:`npm run dev` → homepage:
- 右上角「3D」按钮 → 地图平滑倾斜成俯角;再点切回平视。任意底图(尤其切到「卫星」)都能斜。
- 开 3D 后搜索/点楼盘 → 相机带俯冲电影感飞过去。

## 第二批:homepage 变成 demo/tour 容器(已完成,2026-05-31)

用户决策:① demo 模式由 **URL `/v/:code`** 驱动;② tour 运镜跑在**统一主地图**上。

- **去 padding 全屏**:`MapPage.tsx` 地图容器去掉 `md:p-6 / md:rounded-xl / md:shadow-2xl / md:border`,边到边铺满。
- **共享运镜工厂** `luna-tour/map/mapTourHandle.ts`:`createMapTourHandle({getMap,accent,...})` 把任意 maplibre 实例变成 tour 引擎可驱动的 `MapTourHandle`(flyTo/orbit/flyover/executeCamera/drift/drawDistanceLine/showAmenitySpokes/highlightPins/clearOverlays…)。只加 `lt-` 前缀图层,不撞主图。
- **主地图暴露 ref**:`MapViewMapLibre` 改 `forwardRef` + `useImperativeHandle(createMapTourHandle(...))`;`export default memo(forwardRef(...))`。现有调用不传 ref 不受影响。
- **TourModeContext**(`luna-tour/TourModeContext.tsx`):`{active,code,enter,exit}`。`App` 挂 `TourModeProvider`;`Layout` 读 `active` → demo 时**只渲染全屏 main,隐藏 Header/MobileNav/收藏抽屉/语音按钮**。
- **`/v/:code` → MapPage**:路由从独立 WatchPage 改到 MapPage。`MapPage` 用 `useParams` 读 `:code`,给主图传 `ref={tourMapRef}` + `chromeless`,渲染 `<TourOverlay code mapRef>`,并把自己的搜索 UI(filter pills + 指标条 + POI 控件)在 tour 时 `{!tourCode && …}` 隐藏。
- **`MapViewMapLibre` chromeless prop**:tour 时隐藏自身的底图/3D/测距按钮 + 面板(地图画布与 pin 保留)。
- **TourOverlay**(`luna-tour/TourOverlay.tsx`):透明浮层,fetch session → 建 `TimelineEngine` 驱动主图 handle → 叠加 `OverlayLayer` + chrome(开始/进度/经纪 badge/静音/跳房圆点/Luna pill/CTA/退出✕)。退出 → `navigate('/')` → 恢复 header。
- 全仓 `tsc --noEmit` 0 错 + `vite build` 通过(2546 模块)。
- **退役(保留文件,不再挂路由)**:`WatchPage.tsx` / `TourPlayer.tsx` / `TourMap.tsx`(独立全屏版)。tour 现在统一跑主图。

**验证(需手测)**:`backend: npm run dev` + `frontend: npm run dev` → 开 `/v/demo`:
- header 消失、全屏、搜索 UI 隐藏;点「开始」→ tour 在**真实主地图**上跑运镜 + 卡片/ROI/距离线/CTA。
- 左上 ✕ 退出 → 回 homepage,header 恢复。

## 第三批:用户反馈修正(2026-05-31)

1. **URL 改 query param**:支持 `/?toursession=xxx`(homepage 形式,用户偏好);`/v/:code` 仍作别名。`MapPage` 读 `useParams().code || searchParams.get('toursession')`。
2. **暂停时显示真实地图工具**:`TourModeContext` 加 `toolsRevealed`;`TourOverlay` 在 `paused/asking` 时置 true → `MapViewMapLibre chromeless={tourCode && !toolsRevealed}` + MapPage 搜索 UI `{(!tourCode || toolsRevealed) && …}`。暂停即露出底图/3D/测距/指标/POI,客户可亲自操作。
3. **区域价格块**:数据没丢(本地 210 区域全有 color+boundary,opacity 0.30)。原 `fill-opacity = opacity*0.4 ≈ 0.12` 在卫星底图上太淡看不见 → 改成 `min(1, opacity*1.5)`(hover *2.2),任何底图都清晰。**根因:首图默认卫星档**,production 多在「地图」档故看得见。
4. **导览距离线改用真实测距工具**(核心理念落地:地图功能客户能用、AI 也用):
   - `TimelineEngine` 加 `TourMapFeatureSink.measure(points|null)`;进入有 `distance_line` 的 beat 时,把 `[楼盘坐标, ...各目标]` 交给**真实测距工具**(`voiceMeasure`)画线 + 真实 km 标签,不再用自绘 lt- 线(sink 在场时跳过)。
   - `voiceMeasure` 加 `noFit`:导览用 `noFit:true`,**不触发 fitBounds**(否则抢电影运镜镜头);并修复 `voiceMeasure=null` 时未退出测距模式的残留 bug(现在会清空连线+退出测距)。
   - `MapPage` 把 `setVoiceMeasure` 经 `onMeasure` 注入 `TourOverlay`。
   - 全仓 `tsc` 0 错 + `vite build` 通过。

### 第 4 点(已全部完成,2026-05-31 · 用户定:真实配套分析 + 自动地铁线)
- **配套放射图用真实分析**:`luna-tour/amenities.ts` 把后端 `analyze_area_amenities` 评分逻辑搬到前端,复用现有公开端点 `/api/dubai-pois/near` —— 给楼盘坐标 → 查最近 医院/学校/商场/地铁/超市 → 真实距离 + 0-100 便利分。`TourOverlay` 在 session 加载时**预取每个楼盘的真实配套**,「生活」beat 直接喂给真实 `voiceAmenities` 放射图(零延迟、零占位)。这同时干掉了「占位距离」问题。
- **「生活」beat 自动开地铁线**:engine sink 加 `transit(on)`;`kind==='life'` 的 beat → `onTransit(true)` → `setShowTransit(true)`(触发现有交通数据按需加载),离开 beat / 退出自动收起。
- engine 选择逻辑:beat 有 amenity_spokes 且预取到真实数据 → 用真实放射图(并清测距);否则有 distance_line → 用真实测距;都没有 → 清空。退出/dispose 清掉 measure+amenity+transit。
- 全仓 `tsc` 0 错 + `vite build` 通过。

**至此用户理念落地**:导览(以及语音 AI)用的全是地图自带的真实功能——测距、配套放射、交通层,真实数据,不再有自绘占位。

## 第四批:真实距离 + 卡片/图表/手机(2026-05-31)

1. **距离证据用真实数据(根因修复)**:之前 seed 用占位距离,旁白按占位生成(「2公里大学」),真实却是 0.42km,对不上。改 `seed-demo-session.ts`:用 PostGIS 查每个楼盘最近的 metro/school/mall/hospital/supermarket(真实坐标+km+便利分),重新生成脚本 → **旁白现在说真实距离**(「步行约0.4公里到地铁站,0.15公里有超市」),画出的真实放射图/测距线与旁白吻合。`tour-script.types.ts` 的 `property_card.fields` 放宽为 `z.any()`(模型偶发输出对象,且前端不读它)。
2. **引擎容错**:life beat 只有 amenity_spokes → 优先真实放射图(前端预取);预取没就绪则**回退到楼盘 snapshot 的真实距离**走测距工具,保证旁白永远有证据画出来。
3. **房源卡片移左侧 + 更丰富**(`OverlayLayer` property_card):左侧竖卡(手机自适应为底部卡),展示 区域/楼盘名/开发商/价格/便利度分+档/最近地铁/状态。
4. **房源 pin 高亮**:`MapTourHandle.pulseAt(coord)` —— 进入某楼盘的幕时,该 pin 呼吸高亮(intro/outro 清除)。
5. **增长趋势 chart**(`overlays/GrowthChart.tsx`):numbers beat 的 ROI 卡加一个 SVG 折线图(0→5 年复利上升、描线动画、渐变面积、终点脉冲)+「5 年后预测」。
6. **手机版**:`luna-tour.css` 加 `@media (max-width:640px)` —— 左卡变底卡、字号/图表/badge 自适应。
7. **代码隔离**:tour 逻辑全在 `frontend/src/luna-tour/`(新增 `amenities.ts` / `overlays/GrowthChart.tsx`),`MapPage` 仅注入回调,未塞业务逻辑。全仓 `tsc` 0 错 + `vite build` 通过。

## 已知小问题 / 后续

- **区域价格块**:不是 bug。主图 `areaMetric` 默认 `none`;点顶部「Median Price」等任意指标即出现彩色区域块(与 2D/3D、我的改动均无关)。
- TourOverlay 的 `highlightPins`(结尾三盘同时呼吸)在主图上拿不到 session 坐标(主图 handle 未注入 `getCoordById`)→ 暂跳过,不影响主流程;后续可注入解析器。
- 卫星(raster)在高 pitch 下远处是深背景色、无天空 → 加 sky/雾化优化更真实(可选)。
- 矢量样式(地图/夜景)倾斜后**无真 3D 楼**(CartoCDN 免费瓦片无建筑高度);真 3D 楼需付费瓦片,单列评估。
- 3D 开启后用户可手动拖拽旋转(react-map-gl 默认 dragRotate);如需「复位正北」可后补按钮。
- tour 播放期间主图被透明 stage-tap 层覆盖(点按=暂停),用户无法误拖地图;音频仍是浏览器 TTS;Live 问答未接(Phase 1)。
