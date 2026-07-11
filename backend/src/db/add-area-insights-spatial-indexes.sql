-- area-insights: 手绘(spatial)区域的成交/租约聚合慢查询根治
--
-- 背景:dubai_areas 里 105/210 个区域没有官方 DLD area_id(同事手绘),
-- loadAreaInsightsData 对它们走 spatial 模式:先用 ST_Covers 从
-- dld_project_locations(4211 行)筛出落在多边形内的项目点,再回连成交/租约。
--
-- 回连的谓词是一个 COALESCE 表达式:
--   loc.project_name = COALESCE(NULLIF(dt.project_name,''), NULLIF(dt.building_name,''), '__AREA__')
-- 已有的 idx_tx_area_project(area_name, project_name) 是裸列索引,匹配不上这个
-- 表达式 → 每个项目点都要扫一大段 area_name 分区再逐行 filter
-- (EXPLAIN: Rows Removed by Filter: 35080),JLT 冷查询端到端 8.8s。
--
-- 表达式索引让 nested loop 的内层变成精确 Index Scan:
--   单条聚合 2347ms → 683ms;JLT 整个 area-insights 冷查询 8.83s → 0.43s。
--
-- CONCURRENTLY:不锁表,可对生产库在线执行(不能放在事务里,逐条跑)。
-- 已于 2026-07-11 在生产库执行。

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tx_area_projkey
  ON dld_transactions (
    area_name,
    (COALESCE(NULLIF(project_name, ''), NULLIF(building_name, ''), '__AREA__'))
  );

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rent_area_projkey
  ON dld_rent_contracts (
    area_name,
    (COALESCE(NULLIF(project_name, ''), '__AREA__'))
  );

-- ---------------------------------------------------------------------------
-- 同一类 bug 的第二处:GET /market/rent/projects?area=...
--
-- loadRentProjects(market-rent.ts) 按 UPPER(project_name) 聚合租约。
-- 只有 idx_rent_upper_area_name 一个索引能用,其余谓词(usage_type /
-- annual_amount / property_area)只能回表过滤 → bitmap 退化成 lossy:
--   Rows Removed by Index Recheck: 2,191,873    ← 回表重查 220 万行
--   Heap Blocks: exact=29889 lossy=65624
-- 大区(JABAL ALI FIRST,14.5 万条)实测 5391ms;真实匿名客户几乎每天撞到。
--
-- 部分索引把谓词写进 WHERE、把 mode() 要的 project_name 放进 INCLUDE:
--   5391ms → 362ms;生产端到端 0.2s。
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rent_area_projlist
  ON dld_rent_contracts (UPPER(area_name), UPPER(project_name), start_date)
  INCLUDE (project_name)
  WHERE usage_type = 'Residential'
    AND annual_amount > 0
    AND property_area > 0
    AND project_name IS NOT NULL
    AND project_name <> '';

ANALYZE dld_transactions;
ANALYZE dld_rent_contracts;
