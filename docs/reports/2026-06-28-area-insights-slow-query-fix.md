# area-insights 慢查询修复报告

日期:2026-06-28　作者:Claude(cx-guardian 触发)

## 症状
性能看板「性能负载」红条反复告警:**慢查询 >500ms,近 3 分钟 95 条**(阈值 60),p95 延迟每分钟图峰值 **7710ms**。DB 查询数 875 / 总请求 38 ≈ 每请求 23 次查询。用户反馈「经常出现速度问题」。

## 排查路径
1. **先排除自己**:刚部署的 leadEngine 在每次 `/api/sync` 多打几条库。但 `app_events` 仅 2013 行 / 1.3MB,`computeIntent` 扫描亚毫秒级 → **不是慢查询来源**。
2. `pg_stat_statements` 未装;perfSink 只数慢查询不记文本。改从 `api_calls` + 逐查询计时定位。
3. 给 dashboard 全部分析查询计时:除 getOverview(1324ms,实为 3 条串行 + 笔记本网络往返,服务端不慢)外都在网络底噪 ~162ms。**dashboard 的 app_events 查询都不是元凶**。
4. 大表排查:`dld_rent_contracts` **550万行/4.4GB**、`dld_transactions` 96万行/464MB。area-insights 聚合这俩。
5. **EXPLAIN ANALYZE 锁定**:稠密区域(94.5万租约)的租金中位数聚合 **1851ms**:
   - planner 选了 `start_date` 范围索引,先扫出 **210 万行**再回表按 `dubai_area_id` 过滤(`Rows Removed by Index Recheck: 2,125,980`)。
   - 外部归并排序溢出磁盘(Disk 3640kB),读 ~587MB。
   - **任何区域**(哪怕稀疏)都付这笔 210 万行扫描——因为索引按 start_date 而非区域。
6. 成因:area-insights 每 5 小时**预热全部可见区域**(`warmAreaInsights`),逐个跑这条 → 慢查询成片出现。客户多是 6h 缓存命中,真正卡的是预热 + 冷启动 miss。

## 根因
`dld_rent_contracts` / `dld_transactions` 缺 **`(区域, 日期)` 复合索引**。区域过滤 + 按日期排序的查询被迫走全表日期索引再回表过滤。

## 修复(已直接生效在生产库,无需部署)
CONCURRENTLY 在线建两个索引(不锁表读写),迁移文件 `backend/src/db/area-insights-composite-indexes.sql`:
```sql
CREATE INDEX CONCURRENTLY idx_rent_area_date_resid
  ON dld_rent_contracts (dubai_area_id, start_date DESC) WHERE usage_type = 'Residential';
CREATE INDEX CONCURRENTLY idx_tx_area_date_sales
  ON dld_transactions (area_id, instance_date DESC) WHERE trans_group = 'Sales';
```
随后 `ANALYZE` 两表刷新 planner 统计。索引大小 31MB + 6.6MB(相对 4.4GB 微不足道)。

## 效果(EXPLAIN ANALYZE 实测)
| 查询 | 修复前 | 修复后 |
|---|---|---|
| 典型区域(1.2万行)rent median | ~1851ms* | **118ms** |
| 超大区(12万行)rent median | 1851ms | 1935ms(数据量本身,索引救不了) |
| 超大区 sales median | 370ms | 346ms(ANALYZE 后) |

\* 旧计划对任何区域都扫 210 万行,所以稀疏/典型区域同样慢。

区域分档(按住宅租约量):**普通 <1.2万:57 个**(全部数量级提速)、中区 1.2–5万:38 个(显著提速)、**超大 >5万:22 个**(仍 ~1–2s)。

慢查询从 ~95 条降到只剩这 22 个超大区;预热 250ms 间隔铺开后,任意 3 分钟窗口的慢查询 <60 阈值 → **告警清除**,且所有非超大区的冷启动/未缓存请求恢复到 ~100ms。

## 待办(超大区彻底治理)
22 个超大区的中位数聚合受**数据量**限制,索引无效。结构性解法:**月度中位数预聚合**(物化/rollup 表,在 DLD 周同步后刷新),area-insights 改读 rollup → 所有区域恒定毫秒级。属较大改动(新表 + 刷新钩子 + 改写 loadAreaInsightsData),按 cx-guardian 原则未在本轮擅自实施,列为后续方案。

## 备注
此修复纯 DB 层(创建索引 + ANALYZE),不涉及后端代码部署。leadEngine(C5)经核实与本问题无关。
