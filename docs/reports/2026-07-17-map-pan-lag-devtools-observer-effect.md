# 地图平移「巨卡」排查 —— 结论：观察者效应，不是代码问题

日期：2026-07-17
触发：Eden 报「移动地图时巨卡」，附 DevTools 截图（rAF handler took 991ms）

## 结论

**生产地图不卡。卡的是那个 DevTools 会话本身。**

两次真 GPU（headed）剖析打生产 `www.pinzos.com`，复现截图里的图层状态
（vector 底图 + medianUnitPrice 热力图 + 现房 segment + 交通/学校 POI）：

| 场景 | ≥50ms 长任务 | 最长任务 | (program) 自耗 |
|---|---|---|---|
| 桌面 1440×850，鼠标拖 6 次 + 滚轮缩放 2 轮 | 0 | 0 ms | 1492 ms |
| 手机 367×762 / DPR3 / hasTouch，触摸拖 6 次 | 0 | 0 ms | 488 ms |

**同一个 bundle hash**：剖析跑出来的是 `index-af_1FI4O.js`，与截图控制台 violation
报的是同一个 hash → 同代码、同环境、同图层，本地一帧不丢。

## 991ms rAF 的真实归属

截图报 `'requestAnimationFrame' handler took 991ms` @ `index-af_1FI4O.js:1692`。

对照 CPU 采样，`index-af_1FI4O.js:1691` 那一段的函数是
`upload` / `setTransform` / `addLayer` / `hasTransition` —— **全是 MapLibre 自己的
渲染循环**，不是项目代码。

即：不是「谁在 rAF 里干重活」，而是 **MapLibre 画一帧本身被拖到 991ms**
（正常 5–16ms）。能拖成这样的只有 GPU/合成器被饿死。

## 饿死它的三个环境因素（均可见于截图）

1. **Preserve log 开着 + 10,195 个请求全留在内存**
   - `25,899 kB / 103,710 kB transferred`
   - `123,639 kB / 387,887 kB resources`
   - DevTools 把这 387MB 全部常驻不放。
2. **Tab 开了 ~50 小时**（时间轴拉到 ~180,000,000 ms）。
3. **Responsive 设备模拟 367×762 @ 50% zoom** —— WebGL 在设备模拟下多走一层合成。

## 排掉的两个嫌疑（红鲱鱼）

### `active` 请求刷屏（4774 条）
- 来源：`frontend/src/pages/AdminAnalytics.tsx:144` → `setInterval(load, 30_000)`
  轮询 `/perf/alerts/active`（`backend/src/routes/admin-analytics.ts:172`）。
- 30s × 50h ≈ 6000 次，与截图的 4774 条量级吻合。
- 全是 304 / 1.0kB / ~175ms，不碰地图渲染。
- useEffect 有 `clearInterval` 清理，**无泄漏**。

### `[POI] Loaded 8229 POIs`
- `frontend/src/hooks/useDubaiPois.ts:214`，是**一次性灌进内存的全量缓存**
  （`globalPois.length`），不是渲染数量。
- 实际渲染走 `bounds` + `enabledCategories` 过滤后的子集，
  且是 **GL symbol 层**（`poiGeoJson` → `poi-circles`），不是 DOM marker。

## 地图代码现状：已优化到位，不需要动

复核了 `MapViewMapLibre.tsx`，既有优化都在生效，与 memory 里的铁律一致：
- bounds / recomputeCards / prefetch 全部收在**同一个 150ms debounce**里
  （`boundsTimeoutRef`），手势中不跑。
- 项目真值层 = GL circle layer（零 DOM 零 React）。
- DOM marker（landmark / ProjectCardMarker）在 `mapMoving` 时隐藏。
- hover 走 feature-state / setFilter，不进 React state。
- 相机深链走 `history.replaceState`，零重渲染。

## 给 Eden 的验证 + 处置

**30 秒验证**（我无法在 Playwright 里复刻「开了两天 + 攒了 10k 请求」的 DevTools 状态，
故上述为推断，需实测确认）：
> 新开 tab → `pinzos.com/map` → 不开 DevTools、不开设备模拟 → 拖动。丝滑即实锤。

要留着 DevTools：取消勾选 **Preserve log** + 点 🚫 清空网络记录。

**测手机性能别用设备模拟**（数字不作数）：
- 真机 USB 调试，或
- `node frontend/scripts/_profile-pan-mobile.mjs`（本次新增，触摸拖动路径，
  输出格式与既有 `frontend/scripts/_profile-pan2.mjs` 一致）

## 新增文件

- `frontend/scripts/_profile-pan-mobile.mjs` —— 手机视口 + 真触摸事件
  (`Input.dispatchTouchEvent`) 的平移剖析器，输出 longtask 列表 + CPU self-time top20。

## 元教训

**「卡」的报告先跑探针再改代码**（同 memory 的 `live-tour-latency-truth`：
当时「实时带看卡」的真凶也不是 WS 同步）。这次如果照着截图里的
`active` 请求和 `8229 POIs` 去「优化」，会在一份本来就零长任务的代码上白干一轮，
而真正的原因（DevTools 会话状态）一行代码都改不到。

**DevTools 本身会成为被测对象的性能瓶颈** —— Preserve log + 长时间 tab +
设备模拟三者叠加，足以把 MapLibre 的一帧从 16ms 拖到 991ms。
