# area-insights 月度预聚合 — 待办 spec(慢查询收尾)

状态:**未实现,待 pickup**　创建:2026-06-28
前置:2026-06-28 已补复合索引把 95→22 个超大区(见 `docs/reports/2026-06-28-area-insights-slow-query-fix.md`)。**这份是把剩下 22 个超大区也干掉的收尾方案。**

> 📌 用户指示:下次说「把剩下的活干完」时,这份必须包含在内。

## 还剩什么没做
补索引后,`loadAreaInsightsData`(`backend/src/routes/market.ts`)的**月度中位数聚合**对 **22 个超大区**(住宅租约 >5 万行,如 Dubai Marina/Business Bay 级)仍需 **~1–2s**。这是**数据量本身**的锅——算一个月度中位数要读该区 12 万行 + `percentile_cont` 排序,索引改不了访问量。

分档(按住宅租约量,共 117 区):普通 <1.2万 57 个(已 ~100ms)、中 1.2–5万 38 个(已提速)、**超大 >5万 22 个(仍 1–2s,本 spec 目标)**。

慢查询源头是 area-insights **每 5h 预热全部可见区域**(`warmAreaInsights`);超大区每次预热都触发慢查询。客户多是 6h `txCache` 命中,但预热 + 缓存未命中/TTL 空档仍慢。

## 解法:月度中位数预聚合(rollup 表)
把"按月中位数"从**每次请求实时算**改成**数据同步后算一次、落表**,area-insights 改读 rollup(每区几十行)→ 所有区域恒定毫秒级,与区域数据量无关。

DLD 数据是**周级快照**(见 [[dubai-data-rebuild-box-sync]]),预聚合天然适合:每次同步后刷新一次即可,读侧永远命中。

### 1. rollup 表
```sql
CREATE TABLE area_insights_monthly (
  dubai_area_id uuid NOT NULL,
  usage        text NOT NULL,          -- 'all' | 'residential' | ...(与请求 usage 一致)
  month        date NOT NULL,          -- date_trunc('month')
  sales_count       int,               -- 当月成交笔数
  median_pps        numeric,           -- 成交:每平米中位价(meter_sale_price)
  median_rent_sqm   numeric,           -- 租金:每平米年租中位(annual_amount/property_area,仅 residential)
  median_unit_price numeric,           -- 该月成交总价中位(actual_worth)——用于 12 月中位总价
  refreshed_at timestamptz DEFAULT now(),
  PRIMARY KEY (dubai_area_id, usage, month)
);
```
覆盖 `loadAreaInsightsData` 现在实时算的 5 条里的 3 条聚合(salesRes 月度量+pps、rentRes 月度 rent、medianRes 12月总价)。近期成交/租约(recentRes / recentRentRes,`LIMIT 8`)**保持实时**——已被新复合索引打到毫秒级,不必预聚合。

### 2. 刷新
- 一个 `refreshAreaInsightsMonthly()`:对每个 visible 区域 × 每个 usage,跑现有那几条聚合 SQL(近 37 个月窗口),`INSERT ... ON CONFLICT DO UPDATE` 落表。
- **触发点**:接到 DLD 周同步完成后调用(优先);找不到干净钩子就先挂 cron/`setInterval`(每 24h),因为源数据周级、日刷绰绰有余。
- 复用现有 official/spatial 两种区域-成交归属逻辑(别退化匹配口径,见 [[dld-matching-accuracy]])。

### 3. 改读
`loadAreaInsightsData` 的 salesRes/rentRes/medianRes 三条 → 改成 `SELECT ... FROM area_insights_monthly WHERE dubai_area_id=$1 AND usage=$2 AND month >= ...`。后续 JS 拼月份轴/同比/收益率的逻辑不变(输入还是"月→中位数"的 map)。
- 兜底:某区某 usage rollup 缺行(新区/刚同步)→ 回落实时算一次(现有代码路径),别 500。
- `txCache` 保留(挡住重复读 rollup 的开销),但 miss 也快了。

### 4. 验收
- 全部 117 区(含 22 超大)area-insights 未缓存路径 `EXPLAIN ANALYZE` / 端点计时 **<100ms**。
- 性能看板「慢查询 >500ms」预热期间**恒为 0 越阈**,告警永久清除。
- 抽查超大区(如 Dubai Marina)图表数值与实时算**一致**(预聚合不能改口径)。
- type-check 0 error;部署走 `quick-deploy.ps1 -SkipWorker`;`area_insights_monthly` 建表用 `db-runner`。

## 顺带可一起收的(同属性能/收尾)
- [[api-load-capacity]] 里列的:Node cluster 多进程、加实例、`api_calls` 保留清理([[behavior-to-lead-engine]] 之外的 B3)。**非本 spec 必需,但"剩下的活"若指性能整体,一并评估。**
- 超大区若 rollup 后仍想更快:物化视图 + `REFRESH CONCURRENTLY` 亦可,但手写 rollup 表 upsert 更好控增量。

## 相关
- 已完成前置:`docs/reports/2026-06-28-area-insights-slow-query-fix.md`(复合索引)。
- 记忆:[[area-insights-slow-query-indexes]]。
