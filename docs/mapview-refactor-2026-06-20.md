# MapViewMapLibre 重构 + 非受控 — 2026-06-20

为后续叠加"很复杂的地图功能"打基础:把 2031 行 god-component 拆成独立模块/hook,并消掉每帧重渲染。

## 现状(实测)
- 单文件 **2031 行**,主组件 **41 个 hook**,~18 个 Source/Layer/Marker/Popup,混了 ~10 个关注点。
- **受控地图反模式**:普通模式 `onMove→setViewState` 每帧重渲染整个组件(项目自己的 perf 铁律就禁这个;tour 已用非受控)。`viewState` 只回喂地图、无别处读 → 可安全改非受控。

## 目标
1. 主组件瘦身,只当编排器(orchestrator)。
2. 各关注点 = 独立 hook / 子组件 / lib,新功能作为独立模块插入。
3. 非受控地图,消除每帧重渲染。
4. 行为零变化,全程 type-check + HEADED 实测帧率验证。

## 拆分计划(按风险从低到高、逐步提交)

**P0 非受控(perf)**:`<Map>` 始终用 `initialViewState` 常量;删 `onMove→setViewState`。imperative flyTo / 各处 `map.getZoom()` 不受影响。

**P1 纯移动(零行为变化)**:
- `lib/map/icons.tsx` ← `generatePoiIcon`/`generateDirhamIcon`/`transparentIcon` + `CATEGORY_CONFIG`/`TRANSPORT_LINE_CONFIG`/`ROUTE_TYPE_CONFIG` + `addCustomIcons`。
- `lib/map/metrics.ts` ← `getMetricRawValue`/`getHeatmapColor`/`calculatePercentiles`/`formatMetricValue`/`getMinZoomForRank`/`getPolygonSpan`/`getCentroid` + `AreaMetric` 类型。
- `lib/map/tiles.ts` ← `lat2tileY`、`haversineKm`。
- `components/map/markers/` ← `ProjectPinMarker`、`ClusterBubble`、`LandmarkMarker`。

**P2 抽 hook(线程化 mapRef/state)**:
- `useSatellitePrefetch(mapRef, baseMap, tourActive)` → `schedulePrefetch`。
- `useProjectClustering(mapRef, projects, mapLoaded)` → `{ clusterFeatures, zoomToCluster, recompute }`。
- (可选后续)`useMeasureTool`、`useAreaLayers`、`usePoiLayer`、`useVoiceOverlays`。

## 验证
每步:`npx tsc --noEmit` + `HEADED=1 node scripts/zoomout-frames.mjs`(帧率不退化)+ 关键 screenshot(地图/marker/badge 正常)。
