# 地图口径筛选器（期房/现房/全部 filter 联动全图）

日期：2026-07-02
状态：**已上线**(2026-07-13 核实 —— `marketSegment.ts` + 三档开关都在)
前置：docs/offplan-metrics-segmentation-plan-2026-07-01.md（segment 维度已上线）

## 需求（用户 2026-07-02 拍板，替代"散客默认期房"方案）

- 默认显示**全部综合数据**（不再默认期房）
- 前端加口径 filter：全部 | 期房 | 现房
- filter 联动**整张地图**（区域标签数字+着色）和**区域块弹窗**（指标+走势+成交列表）
- 切换要快，"改变 filter 整个区域和数据都会更新"

## 可行性结论

- **DB 零改动**：三口径预聚合（rolling metrics segment 列）、get_dubai_area_metrics(usage, segment)、area-insights 单扫描三口径缓存全部已在生产。
- **性能无忧**：/dubai/areas 按 (usage, segment) 缓存预渲染+预gzip payload，切换=服务端 memcpy + 前端首拉一次(~127KB gz)后客户端缓存；/area-insights 三口径同缓存组装 <5ms。
- 唯一补的数据面：近期**现房** 30 条列表（上轮只专取了期房 30 条）。

## 交互设计

- 位置：地图右上角指标组（中位数房价/中位数sqft/增长/成交量旁）加三段切换「全部 | 期房 | 现房」，默认全部。
  - 语义与左侧项目筛选（价格/卧室/交房/开发商=筛项目 pin）分开：这个切的是 DLD 数据口径。
- 联动（一个 segment state 贯穿）：
  1. 地图区域标签四种指标模式的数值 + 着色
  2. 区域弹窗中位总价/均价/增长数值与走势线
  3. 弹窗成交列表（期房→期房30条 / 现房→现房30条 / 全部→混合带标签）
  4. 口径徽章：期房→「仅统计期房成交」、现房→「仅统计现房成交」、全部→不显示
- 口径无关项（保持）：
  - 租金收益率/租赁稳定性永远全市场租金口径
  - 成交量 tile 永远全口径 + 「期房 N」拆分 chip（2026-07-02 修的，保留）
- 护栏变更：**显式选择口径时不再静默回退**（尊重用户选择），样本 <10 显示「样本少，仅 N 笔」警示；'all' 默认无护栏问题。

## 改动清单

### 后端（小）
1. `loadAreaInsightsData` 补 recentTransactionsReady（对称 LIMIT 30 查询，`AND NOT dt.is_offplan`）；compose 按 segment 挑列表（offplan/ready/all）。
2. compose 加 `strict` 语义：请求显式带 segment 时不回退（保留 priceSegment/样本数给前端出警示）。实现可用 query 参数 `strict=1` 或直接改成永不回退+前端凭 segmentCounts12m 出警示（更简单，推荐后者：回退逻辑整个删掉，前端负责警示展示）。
   - 注意 Luna 走同一端点：Luna 默认期房口径的回退依赖 compose——若删除回退，Luna 端 investment_analysis/area_investment_report 的护栏仍在（SQL/路由层），不受影响；area-insights 给 Luna 的 present_place 数据薄区会出小样本数字，提示词已有「如实转述」原则，可接受。
3. （可选）/dubai/areas 启动预热三口径 cachedRender。

### 前端（主体）
1. `lib/marketSegment.ts`：CONSUMER_SEGMENT 改 'all'（transactions 页/项目详情 chips 默认自动回到全部）；新增 UI filter 状态的持久化（localStorage，跨会话记住用户偏好，可选）。
2. `lib/api.ts`：fetchDubaiAreas 加 segment 参数；客户端 areas 缓存 key 加 segment（现有 data-version 缓存机制上扩 key）。
3. `MapPage.tsx`：segment state + 右上角三段切换 UI；传给 MapViewMapLibre（区域标签/着色数据源）与 AreaDetailDialog/移动端 sheet。
4. `AreaInsightsPanel.tsx`：useAreaInsights 接 segment 实参（不再固定 CONSUMER_SEGMENT）；徽章文案三态；小样本警示（segmentCounts12m[seg] < 10 时）。
5. 成交列表：按 segment 显示对应列表；「加载更多」type 参数跟随。
6. 项目详情 TransactionsTab / TransactionsPage：默认已随 CONSUMER_SEGMENT='all' 回到全部，chips 保留。

### Luna/AI 链路
- 保持现状：默认期房口径 + segment_used 如实标注 + SQL/路由层样本护栏（对经纪讲增值故事有利）。
- 想让 AI 全跟综合口径：服务器 compose 加 env `MARKET_DEFAULT_SEGMENT=all` 一行（记得加 docker-compose 映射）。

## 性能预算

| 动作 | 成本 |
|---|---|
| 切 filter（服务端） | /dubai/areas 命中 cachedRender per-segment key，memcpy；冷 miss 一次 get_dubai_area_metrics(~几百ms) 后 5min TTL |
| 切 filter（前端） | 首次每口径拉一份 areas payload(~127KB gz)，客户端按 (data-version, segment) 缓存，再切 0ms |
| 弹窗刷新 | /area-insights 同一 raw 缓存换组装，<5ms |
| DB | 无新查询模式、无新索引 |

## 回滚

- filter UI 隐藏 = 一行；默认口径 = CONSUMER_SEGMENT 一行；数据层无涉。
