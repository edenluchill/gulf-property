# 2026-07-05 地图拖动卡顿(rAF 长帧)根因分析与修复

**症状**:拖动地图「一卡一卡」,console 出现 `[Violation] 'requestAnimationFrame' handler took 172–589ms`。

## 根因

区域 hover 高亮的实现是:`hoveredAreaId`(React state)→ 内插进 `area-fills` 图层的 `fill-opacity` **data-driven paint 表达式**。拖动时地图在光标下滑动,光标下的区域连续变化,每次变化触发:

1. 整个 ~1300 行 `MapViewMapLibre` 组件重渲染 + 全部 GL Layer props diff;
2. `fill-opacity` 表达式全量重估 → **所有区域 × 所有瓦片重传 paint buffer**(maplibre data-driven paint 更新的代价)。

在性能一般的笔记本上,每次就是一个 100–600ms 的 rAF 长帧 → 节奏性卡顿。

## 修复(commit `5c87086`)

- hover 改为**独立 `area-fill-hover` 图层 + 命令式 `setFilter`**:只重算这一层的一个 feature,零 React state、零重渲染;
- 拖动/缩放中(`map.isMoving()`)直接跳过 hover 处理;
- 空命中不清除高亮(hit-test 在重绘瞬间偶发 miss + 区域间隙会闪),高亮保持到 hover 下一区域或移出地图;
- area feature id 改为**数字**(uuid 保留在 properties.id)。

**压测结果**(headed 真 GPU,横扫 hover + 连续拖动):修复后零 ≥50ms 长任务;hover 高亮验证正常。

## 三条防再犯铁律(已进 memory)

1. **高频变化的值(hover/鼠标/相机)禁止走 React state → GL paint 表达式**,一律独立图层 + setFilter / feature-state 命令式更新;
2. **feature-state / `['id']` filter 只认数字 feature id** —— uuid 字符串时 `getFeatureState` 查得到但渲染永不命中、**静默失效**;
3. 本地/headed 测试会**耗尽 mapMeter 匿名额度**(连本地后端也是生产库)→ `/api/dubai/areas` 429 → 区域层整个消失,一切修复看似无效。地图诡异失效先 curl 看 429;重置 `DELETE FROM anon_map_usage WHERE day=(now() at time zone 'utc+4')::date`。

## 遗留观察项

- `dubai_pois` 已从 ~700 涨到 **8229**(餐厅 3071 / 超市 1302 / 咖啡 804,另一会话导入)。用户开启餐饮/购物类 POI 时,symbol 碰撞排布(主线程)开销会显著上升;若再报卡顿优先怀疑这里,方案是给密集类目加 minzoom 门控。
- 排查工具:`frontend/scripts/_profile-pan.mjs`(headed + CDP CPU profile)、DEV-only `window.__map` 调试句柄。
