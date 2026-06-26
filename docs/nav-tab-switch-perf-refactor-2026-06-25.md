# 导航切 tab 卡顿 —— 根因诊断与「地图常驻」改造

日期:2026-06-25
状态:已实现 + 本地验证通过,待部署(前端 git push → Cloudflare Pages)

## 现象

生产环境下,从导航栏切换 tab(切到「地图」、切到「定价 Pricing」等)**巨卡**。

## 根因

代码层面确认三点,其中第 1 点是 per-switch(每次切换都卡)的真正元凶:

1. **MapLibre 地图随路由整个销毁/重建** ⭐ 主因
   - 地图用 `react-map-gl` 的声明式 `<Map>`(`MapViewMapLibre.tsx` 1546 行 + `MapPage.tsx` 2113 行)。
   - 在 react-router 里 `/map` 与 `/pricing` 是兄弟路由,切走时 `<MapPage>` 整个 unmount → `react-map-gl` 调 `map.destroy()` 销毁 WebGL context、tile、source/layer、几百个 marker;切回时 `new maplibregl.Map()` 从零重建。两个方向都是**主线程长时间同步阻塞**。
   - 用户总是从首页(地图)出发,所以每次切换都在为地图买单 —— pricing 页面本身只有 147 行,无辜躺枪。

2. **零代码分割** —— 单个 3.6MB JS chunk(gzip ~1MB)
   - `App.tsx` 30+ 页面全是静态 import,无 `React.lazy`/`Suspense`。构建产物 `index-*.js` = 3.6MB 一个巨包。主线程一启动就忙,放大所有卡顿。(本次未改,见「后续优化」。)

3. **VoiceAssistantContext(1060 行)包最外层,零 memo**
   - context value 每次 render 重建,路由变化连带所有 consumer 重渲染。次要。(本次未改,见「后续优化」。)

## 本次改造:地图常驻(Persistent Map)

最优雅、客户体验最好的做法 —— **MapPage 全程只挂载一次,永不卸载**;切到非地图路由时只是 `display:none` 隐藏(地图实例、WebGL context、用户的 pan/zoom 全部原样保留),切回瞬间显示。

### 改动文件

- **`src/lib/isMapPath.ts`(新增)** —— 单一事实来源:哪些路由渲染全屏地图(`/`、`/map`、`/v/:code`、`/t/:code`、`?toursession=`)。Layout 与 MapPage 共用,避免两处判定漂移。

- **`src/components/Layout.tsx`** —— 把 `<MapPage>` 提到 Layout 里常驻:
  - 用 `mapMounted` 闩锁懒挂载(用户首次进地图路由才挂,直达 `/pricing` 的用户不付地图初始化成本)。
  - `onMap ? 'flex-1 flex flex-col min-h-0' : 'hidden'` 切换可见性;非地图路由渲染 `{children}`。
  - 合并原来的「正常 / tour・collab 全屏」两套返回结构为一套,用 `chromeless` 控制 Header/Nav/Drawer/Voice 的显隐,确保 tour/collab 行为不变。

- **`src/App.tsx`** —— 从 `<Routes>` 移除 4 条地图路由(`/`、`/map`、`/v/:code`、`/t/:code`),改由 Layout 常驻渲染;删掉 App 里不再使用的 `MapPage` import。

- **`src/pages/MapPage.tsx`** —— MapPage 脱离 `:code` 路由后 `useParams()` 拿不到 `:code`,改为从 `location.pathname` 解析(`/^\/[vt]\/(.+)$/`);给 `<MapViewMapLibre>` 传 `visible`(用于切回时触发 resize)。

- **`src/components/MapViewMapLibre.tsx`** —— 新增 `visible?: boolean`(默认 true,不影响其它调用方);`visible` 转真时 `requestAnimationFrame(() => mapRef.current?.resize())`,修复 display:none → 显示后 maplibre 仍以为自己 0×0 导致的空白/拉伸。

### 为什么不用 `react-map-gl` 的 `reuseMaps`

`reuseMaps` 会把 GL 实例放进池子复用,但**复用时强制套用 `initialViewState`** —— 用户切回地图会被重置到初始位置/缩放,丢失浏览状态。常驻方案严格更优:地图原样保留,体验最好。

## 验证(本地 Playwright 冒烟)

- `/` → `/pricing` → `/`:maplibre canvas 是**同一个 DOM 节点**(证明从未销毁重建)。✅
- 在 `/pricing`:地图 canvas 为 `hidden(mounted)`(隐藏但挂载)。✅
- 切回后地图尺寸 1500×801 正确填充(resize 生效)。✅
- `/v/:code`、`/t/:code` 均正常渲染地图 canvas(code 解析未破坏 tour/collab)。✅
- 类型检查 `tsc -b` 通过;`npm run build` 成功。

(测试中的 CORS/fetch 报错是本地未起后端导致,与本改动无关。)

## 后续优化(未做,按需)

- **代码分割**:对重而少用的路由(`developer/upload`、`langgraph/test`、`admin/*`、`AdminAnalytics` 图表、`DubaiEditor`)用 `React.lazy` + `Suspense`,把 3.6MB 主包拆小,首屏与整体更轻。
- **VoiceAssistantContext** value 用 `useMemo`、handler 用 `useCallback`,减少全局重渲染。

## 部署

前端走 Cloudflare Pages 接 Git,push 到 main 自动部署。本改动为前端 only,不涉及后端/DB。
