-- area-insights 慢查询修复(2026-06-28)
-- ---------------------------------------------------------------------------
-- 症状:性能看板「慢查询 >500ms」反复告警(近3分钟 95 条),p95 峰值 7710ms。
-- 定位:loadAreaInsightsData(routes/market.ts)对每个区域跑租金/成交中位数聚合。
--   稠密区域的租金中位数聚合实测 ~1851ms:planner 选了 start_date 范围索引,
--   先扫出 ~210 万行再回表按 dubai_area_id 过滤(Rows Removed by Index Recheck:
--   2,125,980),还外部归并排序溢出磁盘、读 ~587MB。缺 (dubai_area_id, start_date)
--   复合索引。area-insights 每 5 小时预热全部可见区域 → 慢查询成片出现。
--
-- 修复:两个复合索引,让查询按"区域 + 时间倒序"走索引,只读该区域的行。
--   • 租金(dld_rent_contracts,550万行/4.4GB):服务中位数聚合 + 近期租约 LIMIT 8。
--   • 成交(dld_transactions,96万行):同理服务 Sales 聚合 + 近期成交。
--
-- 用 CONCURRENTLY 在线建,不锁表读写(生产大表必须)。注意:CONCURRENTLY 不能在
-- 事务块内执行,所以用 db-query.ts 逐条跑,不要用 db-runner(可能包事务)。

-- 租金:区域 + 起租日倒序,限定住宅(area-insights 的租金查询都带 usage_type='Residential')
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rent_area_date_resid
  ON dld_rent_contracts (dubai_area_id, start_date DESC)
  WHERE usage_type = 'Residential';

-- 成交:区域 + 成交日倒序,限定 Sales(area-insights 的成交查询都带 trans_group='Sales')
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tx_area_date_sales
  ON dld_transactions (area_id, instance_date DESC)
  WHERE trans_group = 'Sales';
