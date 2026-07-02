# 期房/现房口径分离方案（offplan metrics segmentation）

日期：2026-07-01
状态：✅ 已实施上线（2026-07-01，见文末实施记录）

## 背景与需求

当前增长率 / median price 全部是现房+期房混合计算。问题：

- 成分偏差：期房占比变化会把 median 拉动，看起来像涨跌，实际是结构变化
- 对期房销售不利：混合口径的"增值"数字可能低于期房实际表现，客户搞混 → 期房卖不出去，对经纪和开发商不精准
- 需求：散客端默认只看期房口径的增值；经纪 portal 保留完整全口径数据

## 现状（2026-07-01 代码探索结论）

### 数据层两套口径并存（要先统一）

| 口径 | 位置 | 使用方 |
|------|------|--------|
| `is_offplan BOOLEAN` | `dld_transactions`，由 `import-dld-opendata.ts:49-54` ALTER 加列，来源 CSV `IS_OFFPLAN_EN='Off-Plan'` | 仅 AI 分析链路（`/api/ai/analytics`、`dubai-analytics-v2.sql`） |
| `procedure_name = 'Sell - Pre registration'`（期房）/ `'Sell'`（现房） | `dld_transactions.procedure_name` | 市场/区域/项目页（`market.ts:262-266,424,551`、`projectInsights.ts:356`） |

两条导入管线（opendata vs Dubai Pulse `import-dubai-analytics.ts`）填的字段不同，`is_offplan` 在部分行可能为 NULL。

### 聚合完全不分期房/现房

- 预聚合：`calculate_area_metrics_by_usage()`（`backend/src/db/area-metrics-by-usage.sql:34-113`）→ `dubai_area_rolling_metrics` → `get_dubai_area_metrics(p_usage)`（`get-area-metrics-by-usage.sql`）。WHERE 只有 `trans_group='Sales' AND meter_sale_price>0`，按 usage 分桶，无 segment 维度。增长率 = 中位单价同比。
- 运行时：`loadAreaInsightsData()`（`backend/src/routes/market.ts:476-663`），同样只按 usage 过滤。近期成交明细有 `saleType` 标签（`:551`）但只用于展示。

### 各页面现状

- 区域块弹窗：`AreaDetailDialog.tsx` → `AreaInsightsPanel.tsx`（中位总价/均价/资本增长/收益率 tile + 近期成交列表，成交行有期房/现房徽标但不可筛选）
- 项目详情成交历史：`GET /api/residential-projects/:id/transactions` → `projectInsights.ts:324-383`，无筛选；前端 `ProjectDetailPage/TransactionsTab.tsx`
- `/transactions` 列表页：**已有** offplan/ready 筛选（`TransactionsPage.tsx:19,73,316-322`，后端 `buildTxFilter()` `market.ts:262-266`），默认 `all`
- 经纪 portal（`/agent`）：无自己的成交/区域分析视图，通过客户报告间接消费 DLD 数据，不受影响
- 租约无期房概念（只有 `registration_type` New/Renew），不涉及

## 设计原则（关键决策）

### 1. 按指标定口径，不按页面一刀切

| 指标 | 口径 | 原因 |
|------|------|------|
| 资本增长率、中位价走势 | **期房**（散客默认） | 需求核心：不让现房混淆期房增值 |
| 租金回报率、租金稳定性 | **现房/全部**（不动） | 租金全部来自已交付现房，分母用期房价没有意义 |
| 成交量 | 建议拆分展示（期房 N 笔 / 现房 M 笔） | 本身就是结构信息 |

### 2. 最小样本量护栏

期房口径自身有成分偏差（新盘开盘拉高区域期房中位价；小区域期房成交太少数字抖动）。规则：**某区域期房月度样本 < 10 笔（env 可调）→ 回退全部口径并标注"样本不足，显示全部成交口径"**。

### 3. 单点默认值配置（audience → segment）

前端一个 `marketSegment.ts` 模块：

```ts
type MarketSegment = 'offplan' | 'ready' | 'all'
getDefaultSegment(audience: 'consumer' | 'agent'): MarketSegment
// consumer → 'offplan'，agent → 'all'
```

所有组件从这里取默认值，不散落 if-else。将来市场变化只改一行。

### 4. 透明标注

散客看到的期房口径数字必须带"期房口径 ⓘ"标签（符合既有 area-metric-conventions：指标必须带ⓘ如何计算）。否则客户和 Property Finder 等对不上数字会损失信任。

## 实施步骤

### Phase 1 — 数据层统一（免部署，纯 DB + 导入脚本）

1. 回填：`UPDATE dld_transactions SET is_offplan = (procedure_name = 'Sell - Pre registration') WHERE is_offplan IS NULL`（分批跑，210 万行）
2. 两条导入管线（`import-dld-opendata.ts`、`import-dubai-analytics.ts`）都写 `is_offplan`，映射规则统一
3. 补部分索引：`(dubai_area_id/area_id, instance_date) WHERE is_offplan AND trans_group='Sales'`，CONCURRENTLY + ANALYZE（参照 2026-06-28 慢查询修复的教训，期房中位数聚合不加索引会重蹈覆辙）
4. 之后所有查询统一走 `is_offplan`，`procedure_name` 判定逐步退役

### Phase 2 — 聚合层加 segment 维度

1. `dubai_area_rolling_metrics` 加 `segment TEXT NOT NULL DEFAULT 'all'`（'all'|'offplan'|'ready'），主键/唯一约束加上 segment
2. `calculate_area_metrics_by_usage()` 一次算三个口径（usage × segment 矩阵）；期房 segment 应用样本量护栏（不足回退标记 `fallback_all=true`）
3. `get_dubai_area_metrics(p_usage, p_segment DEFAULT 'all')` 加参数，旧调用方不传 = 行为不变（向后兼容）
4. `loadAreaInsightsData()` / `GET /api/market/area-insights` 加 `segment` query 参数，月度序列 WHERE 加 `is_offplan` 条件；注意 microCache 的 cache key 要含 segment

### Phase 3 — 后端端点

1. `GET /api/residential-projects/:id/transactions` 加 `type=offplan|ready|all` 参数（复用 buildTxFilter 逻辑）
2. `/api/market/transactions/*` 已支持，无改动

### Phase 4 — 前端

1. `lib/marketSegment.ts` 单点默认值模块
2. `AreaInsightsPanel.tsx`：
   - 增值/中位价/均价 tile 切期房口径 + "期房口径"标签 + ⓘ 解释 + 样本不足回退提示
   - 收益率 tile 不动（口径标注"全部成交"）
   - 近期成交列表加期房/现房筛选 chip，默认期房
3. `TransactionsPage.tsx`：默认 saleType `'all'` → 从 `marketSegment` 取（散客 = offplan）
4. `ProjectDetailPage/TransactionsTab.tsx`：加筛选 chip，默认期房
5. 经纪 portal / 经纪报告：全口径不动；如经纪打开地图区域块，audience='agent' → 默认 'all'（判定复用现有身份层 req.ctx / 前端登录态的 agent 角色）

### Phase 5 — 验证

- 抽 3 个典型区域（期房多如 JVC、期房少的老区、混合区）对比三口径数字是否合理
- 检查样本量护栏触发的区域数量（如超过一半区域都回退，阈值要调）
- i18n：期房/现房标签中英双语（复用 map:areaDialog.offplan/ready 词条）

## Flexibility 保证（2026-07-01 补充：为什么不会丢功能）

- **加维度不删数据**：三口径全算全存，现房数据永远在预聚合表里，将来做"期房 vs 现房对比"等新功能零回填
- **默认值一键翻转**：市场转向现房主导时改 `marketSegment.ts` 一行即可切回，不动数据和聚合
- **API 向后兼容**：segment 参数默认 `'all'`，未改造的调用方（经纪报告/Luna/分享报告页）行为不变
- **散客未锁死**：默认期房 + 保留筛选 chip，客户可自行切换
- **segment 用 TEXT 不用布尔（有意）**：将来可扩展 `offplan_resale`（期房转售）等细分口径——期房转售价才是真"市场增值"信号，开发商一手价是定价行为；扩展只是多算一个 segment 值，schema 不动
- **历史连续性**：旧混合口径行保留为 `segment='all'`，不覆盖不重算
- 唯一不可逆动作 = Phase 1 的 `is_offplan` 回填统一，属于修数据债而非功能取舍

## 风险与注意

- `dubai_area_rolling_metrics` 行数 ×3，检查依赖该表的其他查询（get_dubai_area_metrics 的所有调用方）是否会因缺 segment 过滤而重复计数
- area-insights 是高频接口且刚做过慢查询优化（idx_rent_area_date_resid / idx_tx_area_date_sales），新增期房过滤后必须 EXPLAIN ANALYZE 验证走新部分索引
- Luna 语音的 AI 分析链路已支持 is_offplan 维度，提示词层面可顺带告知 Luna"散客默认讲期房口径"（另行小改）
- 22 个超大区的月度预聚合收尾（docs/area-insights-preaggregation-spec.md）与本方案的 Phase 2 有重叠，建议合并实施避免两次改聚合函数

## 实施记录（2026-07-01）

与原方案的差异/决策：

- **Phase 1 跳过回填**：`is_offplan` 列生产库 0 NULL 且与 procedure_name 完全一致（来源 DLD 官方 IS_OFFPLAN_EN），直接统一用它。比 procedure_name 文本匹配更准（`Delayed Sell` 等 9.6 万笔官方归现房，旧 `='Sell'` 判定会漏）。
- **不加新索引**：area-insights 改为**单次扫描三口径**（`FILTER (WHERE is_offplan)` 聚合），不改 WHERE，不需要期房部分索引；缓存里三口径齐全，切口径零成本。
- **样本护栏两级实现**：get_dubai_area_metrics/area_investment_report 在 SQL 内回退；area-insights/investment_analysis 在路由层回退。全部通过 `segment_used`/`priceSegment` 如实标注。
- **AI 链路全接**：ai-analytics /investment /report /compare /project-value /rent-vs-buy 默认期房（marketSegment.DEFAULT_SEGMENT）；Luna 提示词加口径说明；luna-tour evidence 期房优先+样本回退。
- **recommend_for_budget /affordability 保留全口径**（v1 例外）：走 mv_area_invest_apt 预计算 MV，改口径需重建 MV 且找房计算器全局受影响，收益低风险高。榜单是相对排序，混口径影响小。后续要做见"下一步"。
- **落地文件**：DB `backend/src/db/offplan-segment-metrics.sql` + `dubai-analytics-v2-report.sql`；后端 `lib/marketSegment.ts`、`routes/market.ts`、`routes/dubai-areas-landmarks.ts`、`routes/ai-analytics.ts`、`routes/voice-token.ts`、`services/projectInsights.ts`、`services/voice-assistant-tools.ts`、`luna-tour/evidence.ts`、`scripts/market-precompute.ts`（已 scp 到迪拜盒子 /opt/dubai-sync）；前端 `lib/marketSegment.ts`、`lib/api.ts`、`components/AreaInsightsPanel.tsx`、`pages/TransactionsPage.tsx`、`pages/ProjectDetailPage/TransactionsTab.tsx`、`types/index.ts`。

回滚开关（按层，任选）：
1. 后端 env：服务器 compose 加 `MARKET_DEFAULT_SEGMENT=all` → AI/地图/区域弹窗默认恢复混合口径（注意：新 env 要手动加进服务器 /opt/pinzos/docker-compose.yml）
2. 前端一行：`frontend/src/lib/marketSegment.ts` 的 `CONSUMER_SEGMENT` 改 'all'
3. 数据层无需回滚：三口径全存，'all' 行为与旧版逐字节一致

下一步（未做）：
- recommend_for_budget/mv_area_invest_apt 口径化（需 MV 加 segment 列）
- 期房转售（offplan resale）细分口径
- 22 个超大区月度预聚合收尾（docs/area-insights-preaggregation-spec.md）
