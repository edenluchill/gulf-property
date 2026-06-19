# 项目 Pin 聚合 + 点击预览卡片 — 设计说明

日期：2026-06-19

> **更新 (2026-06-19)**：点击预览卡片（desktop popup / mobile sheet / `ProjectPreviewCard`）
> 已**按用户反馈撤销** —— 点击 pin 恢复为直接进详情页（不加中间步骤）。
> **保留**：pin 聚合（数字气泡）、hover 名字药丸简化。下文「2 预览卡片」「3 双端容器」
> 「4 状态流」相关内容为历史记录，已不在代码中。

状态：聚合已实现并实拍验证；点击卡片已撤销。

## 背景 / 问题

地图上的房源 pin（深色水滴 + 项目缩略图）此前：

1. **互相重叠点不到后面的** —— DOM `<Marker>`，无聚合/碰撞，`zIndex` 都是 2，密集处只有最前面那个能点。
2. **点击直接 `navigate('/project/:id')`** —— 一点就跳走；hover 才显示一个简陋小卡片（名字 + 户型），信息少、不现代。

用户要：点击 pin 弹一个好看的现代卡片（基础信息 + 介绍 + View More 按钮），点 View More 才进详情；desktop 和 mobile 都要；并修复 pin 重叠。

## 决策

- **卡片位置（desktop）**：贴着 pin 弹出的 Popup（Google Maps 式，带尾巴指向 pin）。mobile 用底部 sheet。
- **pin 防叠**：聚合成数字气泡（Zillow/Airbnb 式），点击放大展开。

## 实现

### 1. 聚合（supercluster）— `MapViewMapLibre.tsx`

- 新依赖 `supercluster`（+ `@types/supercluster`）。
- `superclusterIndex = useMemo(...)`：从 `projects` 建索引（radius 56, maxZoom 16）。
- `clusterFeatures` state：只在 `handleMoveEnd`（地图停下）和 `mapLoaded`/`projects` 变化时重算 —— **不逐帧**，marker 本身按经纬度锚定会随地图平移，无需重算。符合 Luna Tour 性能规矩。
- 渲染：cluster → `<ClusterBubble>`（深色圆形数字气泡，大小随 count）；single → `<ProjectPinMarker>`。
- `zoomToCluster`：`getClusterExpansionZoom` → `flyTo`，展开该簇。
- **tour 模式跳过聚合**（只 2-3 个 tour pin，直接渲染）。

### 2. 预览卡片 — 新组件 `ProjectPreviewCard.tsx`

- Props：`project: MapPinProject`、`variant: 'popup' | 'sheet'`、`onViewMore`、`onClose`。
- 即时信息来自 `MapPinProject`（封面图、名字、开发商、区域、价格、户型、交房、状态徽章）。
- **简介**：`MapPinProject` 没有 description，点击时 `fetchResidentialProjectById(id)` 拉全量，加载时显示骨架屏。
- `View More` 按钮 → 父组件 `navigate('/project/:id')`。点 pin 不再直接跳转。
- 状态徽章配色：即将发售/在建/已建成/已交付/已售罄。

### 3. 双端容器

- **Desktop**：`MapViewMapLibre` 内 react-map-gl `<Popup>`（仅 `!isMobile && !tourActive && selectedProject`）。
  - 不写死 anchor → MapLibre 自动翻转保证在屏内；按 anchor 给不同 offset（卡在 pin 上方时 offset 大以避开 ~58px 的 pin 身）。
  - `closeOnClick`（点空白地图关）、自定义关闭按钮。
  - CSS 覆盖 maplibre 默认白盒/内边距（`.project-preview-popup`，在 `index.css`），卡片自带圆角阴影，尾巴白色。
- **Mobile**：`MapPage` 内图片在顶的底部 sheet（backdrop + `translate-y` 滑入），复用 `ProjectPreviewCard variant="sheet"`。

### 4. 状态流 — `MapPage.tsx`

- `selectedProject` state；`handleProjectClick` 改为 `setSelectedProject`（不再 navigate）。
- `handleProjectViewMore(id)` → navigate。
- 传给 `MapViewMapLibre`：`selectedProject` / `onCloseProjectCard` / `onProjectViewMore` / `isMobile`。
- 选中的 pin 青色高亮 + 置顶（`selected` prop）。

### 5. 顺手简化

- 原 hover 富卡片（名字+价格+户型）瘦身成一个干净的名字药丸 —— 富信息都进了点击大卡，去重。
- 移除遗留死代码：`ClusterMarker`、`formatPriceShort`、未用的 `clusters`/`onClusterClick` 入参。

## 验证

- `scripts/click-pin.mjs`（配套 playwright 工具，类似 `screenshot.mjs`）：定位最近房源 pin 的 marker 元素并 `el.click()`（绕开坐标命中测试），截图卡片。支持 `MOBILE=1`。
- 实拍确认：desktop 贴 pin 卡片（自动翻转不截断）、mobile 底部 sheet、聚合数字气泡。`tsc --noEmit` 通过。

## 文件

- 新增：`frontend/src/components/ProjectPreviewCard.tsx`、`frontend/scripts/click-pin.mjs`
- 改：`frontend/src/components/MapViewMapLibre.tsx`、`frontend/src/pages/MapPage.tsx`、`frontend/src/index.css`、`frontend/package.json`
- 依赖：`supercluster`、`@types/supercluster`

## 后续可做（未实现）

- 卡片可加更多字段（amenities chips、付款计划、单价/sqft）—— 全量数据里已有。
- 聚合气泡可显示价格区间（旧 ClusterMarker 有 `count | price`，新气泡只显示 count）。
