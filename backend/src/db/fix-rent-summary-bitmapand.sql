-- 租金摘要/趋势(/api/market/rent/summary、/list)按区筛选时慢 1.7s 的根因修复。
--
-- 2026-07-27 生产 EXPLAIN(BUSINESS BAY):
--   Aggregate 1776ms
--     └ BitmapAnd 1314ms
--         ├ idx_rent_upper_area_name        192,587 行   31ms   ← 真正的选择性在这
--         └ idx_rent_annual_amount        3,829,554 行 1275ms   ← 扫了 68% 的表,纯浪费
--
-- planner 为了 `usage_type='Residential' AND annual_amount>0 AND property_area>0`
-- 这三条**几乎不筛任何东西**的谓词,去扫了整个 idx_rent_annual_amount 建 bitmap,
-- 只为和区域索引取交集。1.78s 里 1.27s 花在这上面。
--
-- 修法:把那三条谓词写进**区域索引自己的 partial WHERE**,于是一次索引扫描就够,
-- 不再需要 BitmapAnd。start_date 作第二列供趋势查询的 24 个月区间用;
-- INCLUDE 带上聚合要的两列,让堆访问尽量少(可能走 index-only)。
--
-- ⚠️ 已有的 idx_rent_area_projlist 看着像但用不了:它带 `project_name IS NOT NULL
--    AND project_name <> ''` —— 只按区筛时会漏掉没有项目名的合约,口径都变了。
--
-- CONCURRENTLY:5.6M 行 / 5.5GB 的生产表,不能锁写。

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rent_upper_area_resid
  ON dld_rent_contracts (upper(area_name::text), start_date)
  INCLUDE (annual_amount, property_area)
  WHERE usage_type = 'Residential'
    AND annual_amount > 0
    AND property_area > 0;

-- 同理:按项目筛(UPPER(project_name) = ANY(...))也走同一条坏路。
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rent_upper_project_resid
  ON dld_rent_contracts (upper(project_name::text), start_date)
  INCLUDE (annual_amount, property_area)
  WHERE usage_type = 'Residential'
    AND annual_amount > 0
    AND property_area > 0;

ANALYZE dld_rent_contracts;
