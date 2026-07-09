# 实时带看 · 地图标记工具规划（2026-06-30）

站在经纪带海外买家做在线导览的角度，好的标记要帮他讲清三件事：**这在哪、值不值、比别的好在哪**。护城河是 DLD 成交 + 区域指标数据 —— 所以最强的标记不是"能画箭头"（Zoom 白板也能），而是**把标记和数据绑起来**。

## 已实现（commit 906aed8，2026-06-30 上线）

把 `useCollabDraw` 从"只有笔迹"升级为通用标记引擎：`Mark` 判别联合（pen/arrow/text/pin/circle），一个 GeoJSON source + 5 层（fill / line / arrowhead symbol / pin symbol / label symbol）按 `mt` 属性过滤渲染。全部走 `__collab_draw` 可靠通道广播 + ring 补发，收到只更新本地不回传（loop-safe）。

### 快赢（纯沟通标记）
| 工具 | 说明 |
|---|---|
| **箭头** | 拖出 a→b，带旋转箭头头（canvas 三角 addImage + icon-rotate=bearing）。指向性标注。 |
| **文字标签** | 点→ inline input → Enter/✓ 提交，地理锚定多语言文字。 |
| **图钉** | 点落 emoji（⭐🏫🚇🏖️🏥🛒🍽️⚠️），canvas addImage 稳定渲染。 |
| **撤销** | 只撤自己加的标记；橡皮跨所有标记类型。 |

### 差异化（标记绑数据）
| 工具 | 说明 |
|---|---|
| **圈选即出数据（draw-to-query）** ⭐ | 圈一片区域 → 圈心点在多边形内判定（`pointInGeometry` 射线法遍历已加载 `dubaiAreas`）→ 立刻出该区**中位价 / 租金回报 / 成交笔数**。纯客户端零后端。别人抄不走（没 DLD）。 |

### 关键坑（踩过并修复）
- **文字 input 一挂载就消失**：原 `onBlur` 自动提交，mousedown 开 input、trailing mouseup 让 canvas 抢焦点 → input blur → 提交空串 → 自卸载。修：去掉 blur 提交，改显式 ✓/✕（Enter 仍可）+ 容器 stopPropagation + setTimeout(focus,30)。
- **emoji 渲染**：必须 canvas `getImageData` + `map.addImage`，不能用 symbol text-field（SDF glyph 不含 emoji → 豆腐块）。
- **label 字体**：必须 `['Open Sans Bold']`（与区域名层一致，样式 glyph server 里且含 CJK），Noto/Arial Unicode 会 tofu。

### 验证
- 类型检查 + 生产构建通过。
- Playwright 在 `/t/<code>` 真画（`scripts/_draw-verify.mjs`）：pen/arrow/circle/pin/text 全渲染正确，emoji 图钉 + 文字标签 halo 正常，圈选本地无后端时回退"半径 X km"（生产有 areas → 出真数据）。

## 待做（第三批：需引入路由 API，wow 最强）

买家第一关心的是通勤 —— 直线测距跨海跨高速是骗人的，真实路线/时间更打动人。

1. **真实通勤圈（isochrone）** 🚗：楼盘"开车 15 分钟能到哪"画成一个范围面。
2. **真实路线 + 时间** 🛣️：楼盘 → 机场 / 公司 / 学校 的真实开车路线 + 用时。

技术：接 OpenRouteService（免费档含 isochrone + directions）或同类。isochrone 返回 GeoJSON polygon，直接进现有 draw source 渲染；路线返回 LineString + duration。留到验证过前两批 ROI 之后再花这个工。

## 其它候选（暂缓）
- 矩形/多段线高亮、聚光灯遮罩（dim 非重点区）、A/B 楼盘对比连线。优先级低于上面。
