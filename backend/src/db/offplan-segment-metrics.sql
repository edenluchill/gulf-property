-- ===========================================================================
-- 期房/现房口径分离（segment 维度）—— 见 docs/offplan-metrics-segmentation-plan-2026-07-01.md
--
-- dubai_area_rolling_metrics 加 segment 列（'all' | 'offplan' | 'ready'），
-- 两个 calc 函数按 (usage × segment) GROUPING SETS 一次算全，历史行保留为 'all'。
-- 口径规则（按指标，不按页面）：
--   • 价格/增长/成交量 → 可按 segment 取（散客默认 offplan）
--   • 租金/收益率/稳定性 → 只挂在 segment='all' 行（租金全来自已交付现房，
--     期房价格做分母没有意义；get_dubai_area_metrics 里永远从 'all' 行取）
-- 样本护栏：get_dubai_area_metrics(p_segment) 对每个区域单独判断——该区 segment
-- 行样本 < p_min_n 时回退 'all' 行，并用 price_segment 列告知前端实际口径。
--
-- 应用: cd backend && npx ts-node scripts/db-runner.ts src/db/offplan-segment-metrics.sql
-- 回滚: 调用方传 segment='all' 即完全恢复旧行为（数据未删未改）。
-- ===========================================================================

-- 1. segment 维度列 + 唯一索引升级
ALTER TABLE dubai_area_rolling_metrics ADD COLUMN IF NOT EXISTS segment text NOT NULL DEFAULT 'all';
DROP INDEX IF EXISTS dubai_area_rolling_metrics_area_period_usage_key;
CREATE UNIQUE INDEX IF NOT EXISTS dubai_area_rolling_metrics_area_period_usage_segment_key
  ON dubai_area_rolling_metrics (dubai_area_id, period_end_month, usage, segment);

-- 2. 官方区域（area_id 桥接）：usage × segment 矩阵
CREATE OR REPLACE FUNCTION calculate_area_metrics_by_usage(p_end_date date DEFAULT CURRENT_DATE)
RETURNS integer LANGUAGE plpgsql AS $function$
DECLARE
  v_count int := 0;
  v_pe date := date_trunc('month', p_end_date);
  v_ps date := (date_trunc('month', p_end_date) - interval '12 months');
  v_pps date := (date_trunc('month', p_end_date) - interval '24 months');
BEGIN
  INSERT INTO dubai_area_rolling_metrics (
    dubai_area_id, period_end_month, usage, segment,
    avg_price_sqm, median_price_sqm, median_unit_price, total_sales_volume,
    sales_transaction_count, avg_sale_size_sqm,
    median_rent_sqm, median_new_rent_sqm, new_contract_count, renew_contract_count,
    rent_stability_pct, rental_yield_pct, price_growth_pct, price_trend
  )
  SELECT
    curr.aid, v_pe, COALESCE(curr.usage,'all'), COALESCE(curr.seg,'all'),
    curr.avg_psm, curr.med_psm, curr.med_unit, curr.vol, curr.n, curr.sz,
    -- 租金/收益率类指标只写在 segment='all' 行（见文件头口径规则）
    CASE WHEN COALESCE(curr.seg,'all')='all' AND COALESCE(curr.usage,'all') IN ('residential','all') THEN rent.med_rent END,
    CASE WHEN COALESCE(curr.seg,'all')='all' AND COALESCE(curr.usage,'all') IN ('residential','all') THEN rent.med_new END,
    CASE WHEN COALESCE(curr.seg,'all')='all' AND COALESCE(curr.usage,'all') IN ('residential','all') THEN rent.new_n END,
    CASE WHEN COALESCE(curr.seg,'all')='all' AND COALESCE(curr.usage,'all') IN ('residential','all') THEN rent.renew_n END,
    CASE WHEN COALESCE(curr.seg,'all')='all' AND COALESCE(curr.usage,'all') IN ('residential','all')
              AND rent.new_n>=40 AND rent.renew_n>=40 AND rent.med_new>0 AND rent.med_renew>0
         THEN ROUND((rent.med_renew/rent.med_new*100)::numeric,1) END,
    CASE WHEN COALESCE(curr.seg,'all')='all' AND COALESCE(curr.usage,'all') IN ('residential','all') AND curr.med_psm>0
              AND COALESCE(CASE WHEN rent.new_n>=30 THEN rent.med_new END, rent.med_rent)>0
         THEN ROUND((COALESCE(CASE WHEN rent.new_n>=30 THEN rent.med_new END, rent.med_rent)/curr.med_psm*100)::numeric,2) END,
    CASE WHEN prev.med_psm>0 AND prev.n>=20 AND curr.n>=20
              AND ABS((curr.med_psm-prev.med_psm)/prev.med_psm*100)<=120
         THEN ROUND(((curr.med_psm-prev.med_psm)/prev.med_psm*100)::numeric,1) END,
    CASE WHEN prev.med_psm IS NULL THEN NULL
         WHEN curr.med_psm > prev.med_psm*1.02 THEN 'up'
         WHEN curr.med_psm < prev.med_psm*0.98 THEN 'down' ELSE 'stable' END
  FROM (
    SELECT dla.dubai_area_id aid, dld_usage_bucket(dt.property_usage) usage,
           CASE WHEN dt.is_offplan THEN 'offplan' ELSE 'ready' END seg,
           AVG(dt.meter_sale_price) avg_psm,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY dt.meter_sale_price) med_psm,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY dt.actual_worth) med_unit,
           SUM(dt.actual_worth) vol, COUNT(*)::int n, AVG(dt.procedure_area) sz
    FROM dld_transactions dt JOIN dld_areas dla ON dla.area_id=dt.area_id
    WHERE dt.trans_group='Sales' AND dt.meter_sale_price>0 AND dla.dubai_area_id IS NOT NULL
      AND dt.instance_date>=v_ps AND dt.instance_date<v_pe
    GROUP BY GROUPING SETS ((1,2,3),(1,3),(1,2),(1))
  ) curr
  LEFT JOIN (
    SELECT dla.dubai_area_id aid, dld_usage_bucket(dt.property_usage) usage,
           CASE WHEN dt.is_offplan THEN 'offplan' ELSE 'ready' END seg,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY dt.meter_sale_price) med_psm, COUNT(*)::int n
    FROM dld_transactions dt JOIN dld_areas dla ON dla.area_id=dt.area_id
    WHERE dt.trans_group='Sales' AND dt.meter_sale_price>0 AND dla.dubai_area_id IS NOT NULL
      AND dt.instance_date>=v_pps AND dt.instance_date<v_ps
    GROUP BY GROUPING SETS ((1,2,3),(1,3),(1,2),(1))
  ) prev ON prev.aid=curr.aid AND prev.usage IS NOT DISTINCT FROM curr.usage
        AND prev.seg IS NOT DISTINCT FROM curr.seg
  LEFT JOIN (
    SELECT rc.dubai_area_id aid,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY rc.annual_amount/NULLIF(rc.property_area,0)) med_rent,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY rc.annual_amount/NULLIF(rc.property_area,0))
             FILTER (WHERE rc.registration_type='New') med_new,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY rc.annual_amount/NULLIF(rc.property_area,0))
             FILTER (WHERE rc.registration_type='Renew') med_renew,
           COUNT(*) FILTER (WHERE rc.registration_type='New')::int new_n,
           COUNT(*) FILTER (WHERE rc.registration_type='Renew')::int renew_n
    FROM dld_rent_contracts rc
    WHERE rc.usage_type='Residential' AND rc.property_area>=20
      AND rc.annual_amount<=500000 AND (rc.annual_amount/rc.property_area)<=3000
      AND rc.start_date>=v_ps AND rc.start_date<v_pe
    GROUP BY 1
  ) rent ON rent.aid=curr.aid
  WHERE curr.n>0
  ON CONFLICT (dubai_area_id, period_end_month, usage, segment) DO UPDATE SET
    avg_price_sqm=EXCLUDED.avg_price_sqm, median_price_sqm=EXCLUDED.median_price_sqm,
    median_unit_price=EXCLUDED.median_unit_price, total_sales_volume=EXCLUDED.total_sales_volume,
    sales_transaction_count=EXCLUDED.sales_transaction_count, avg_sale_size_sqm=EXCLUDED.avg_sale_size_sqm,
    median_rent_sqm=EXCLUDED.median_rent_sqm, median_new_rent_sqm=EXCLUDED.median_new_rent_sqm,
    new_contract_count=EXCLUDED.new_contract_count, renew_contract_count=EXCLUDED.renew_contract_count,
    rent_stability_pct=EXCLUDED.rent_stability_pct, rental_yield_pct=EXCLUDED.rental_yield_pct,
    price_growth_pct=EXCLUDED.price_growth_pct, price_trend=EXCLUDED.price_trend;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $function$;

-- 3. 手绘（custom）区域：空间匹配版，同样加 segment
CREATE OR REPLACE FUNCTION calculate_custom_area_metrics_by_usage(p_end_date date DEFAULT CURRENT_DATE)
RETURNS integer LANGUAGE plpgsql AS $function$
DECLARE
  v_count int := 0;
  v_pe date := date_trunc('month', p_end_date);
  v_ps date := (date_trunc('month', p_end_date) - interval '12 months');
  v_pps date := (date_trunc('month', p_end_date) - interval '24 months');
BEGIN
  INSERT INTO dubai_area_rolling_metrics (
    dubai_area_id, period_end_month, usage, segment,
    avg_price_sqm, median_price_sqm, median_unit_price, total_sales_volume,
    sales_transaction_count, avg_sale_size_sqm,
    median_rent_sqm, median_new_rent_sqm, new_contract_count, renew_contract_count,
    rent_stability_pct, rental_yield_pct, price_growth_pct, price_trend
  )
  SELECT
    curr.aid, v_pe, COALESCE(curr.usage,'all'), COALESCE(curr.seg,'all'),
    curr.avg_psm, curr.med_psm, curr.med_unit, curr.vol, curr.n, curr.sz,
    CASE WHEN COALESCE(curr.seg,'all')='all' AND COALESCE(curr.usage,'all') IN ('residential','all') THEN rent.med_rent END,
    CASE WHEN COALESCE(curr.seg,'all')='all' AND COALESCE(curr.usage,'all') IN ('residential','all') THEN rent.med_new END,
    CASE WHEN COALESCE(curr.seg,'all')='all' AND COALESCE(curr.usage,'all') IN ('residential','all') THEN rent.new_n END,
    CASE WHEN COALESCE(curr.seg,'all')='all' AND COALESCE(curr.usage,'all') IN ('residential','all') THEN rent.renew_n END,
    CASE WHEN COALESCE(curr.seg,'all')='all' AND COALESCE(curr.usage,'all') IN ('residential','all')
              AND rent.new_n>=40 AND rent.renew_n>=40 AND rent.med_new>0 AND rent.med_renew>0
         THEN ROUND((rent.med_renew/rent.med_new*100)::numeric,1) END,
    CASE WHEN COALESCE(curr.seg,'all')='all' AND COALESCE(curr.usage,'all') IN ('residential','all') AND curr.med_psm>0
              AND COALESCE(CASE WHEN rent.new_n>=30 THEN rent.med_new END, rent.med_rent)>0
         THEN ROUND((COALESCE(CASE WHEN rent.new_n>=30 THEN rent.med_new END, rent.med_rent)/curr.med_psm*100)::numeric,2) END,
    CASE WHEN prev.med_psm>0 AND prev.n>=20 AND curr.n>=20
              AND ABS((curr.med_psm-prev.med_psm)/prev.med_psm*100)<=120
         THEN ROUND(((curr.med_psm-prev.med_psm)/prev.med_psm*100)::numeric,1) END,
    CASE WHEN prev.med_psm IS NULL THEN NULL
         WHEN curr.med_psm > prev.med_psm*1.02 THEN 'up'
         WHEN curr.med_psm < prev.med_psm*0.98 THEN 'down' ELSE 'stable' END
  FROM (
    SELECT da.id aid, dld_usage_bucket(dt.property_usage) usage,
           CASE WHEN dt.is_offplan THEN 'offplan' ELSE 'ready' END seg,
           AVG(dt.meter_sale_price) avg_psm,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY dt.meter_sale_price) med_psm,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY dt.actual_worth) med_unit,
           SUM(dt.actual_worth) vol, COUNT(*)::int n, AVG(dt.procedure_area) sz
    FROM dubai_areas da
    JOIN dld_project_locations loc ON loc.geom IS NOT NULL AND ST_Covers(da.boundary, loc.geom)
    JOIN dld_transactions dt ON dt.area_name=loc.area_name
         AND COALESCE(NULLIF(dt.project_name,''), NULLIF(dt.building_name,''), '__AREA__')=loc.project_name
    WHERE da.boundary IS NOT NULL AND da.visible
      AND NOT EXISTS (SELECT 1 FROM dld_areas dla WHERE dla.dubai_area_id=da.id AND dla.area_id<900000)
      AND dt.trans_group='Sales' AND dt.meter_sale_price>0
      AND dt.instance_date>=v_ps AND dt.instance_date<v_pe
    GROUP BY GROUPING SETS ((1,2,3),(1,3),(1,2),(1))
  ) curr
  LEFT JOIN (
    SELECT da.id aid, dld_usage_bucket(dt.property_usage) usage,
           CASE WHEN dt.is_offplan THEN 'offplan' ELSE 'ready' END seg,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY dt.meter_sale_price) med_psm, COUNT(*)::int n
    FROM dubai_areas da
    JOIN dld_project_locations loc ON loc.geom IS NOT NULL AND ST_Covers(da.boundary, loc.geom)
    JOIN dld_transactions dt ON dt.area_name=loc.area_name
         AND COALESCE(NULLIF(dt.project_name,''), NULLIF(dt.building_name,''), '__AREA__')=loc.project_name
    WHERE da.boundary IS NOT NULL AND da.visible
      AND NOT EXISTS (SELECT 1 FROM dld_areas dla WHERE dla.dubai_area_id=da.id AND dla.area_id<900000)
      AND dt.trans_group='Sales' AND dt.meter_sale_price>0
      AND dt.instance_date>=v_pps AND dt.instance_date<v_ps
    GROUP BY GROUPING SETS ((1,2,3),(1,3),(1,2),(1))
  ) prev ON prev.aid=curr.aid AND prev.usage IS NOT DISTINCT FROM curr.usage
        AND prev.seg IS NOT DISTINCT FROM curr.seg
  LEFT JOIN (
    SELECT da.id aid,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY rc.annual_amount/NULLIF(rc.property_area,0)) med_rent,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY rc.annual_amount/NULLIF(rc.property_area,0))
             FILTER (WHERE rc.registration_type='New') med_new,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY rc.annual_amount/NULLIF(rc.property_area,0))
             FILTER (WHERE rc.registration_type='Renew') med_renew,
           COUNT(*) FILTER (WHERE rc.registration_type='New')::int new_n,
           COUNT(*) FILTER (WHERE rc.registration_type='Renew')::int renew_n
    FROM dubai_areas da
    JOIN dld_project_locations loc ON loc.geom IS NOT NULL AND ST_Covers(da.boundary, loc.geom)
    JOIN dld_rent_contracts rc ON rc.area_name=loc.area_name
         AND COALESCE(NULLIF(rc.project_name,''), '__AREA__')=loc.project_name
    WHERE da.boundary IS NOT NULL AND da.visible
      AND NOT EXISTS (SELECT 1 FROM dld_areas dla WHERE dla.dubai_area_id=da.id AND dla.area_id<900000)
      AND rc.usage_type='Residential' AND rc.property_area>=20
      AND rc.annual_amount<=500000 AND (rc.annual_amount/rc.property_area)<=3000
      AND rc.start_date>=v_ps AND rc.start_date<v_pe
    GROUP BY 1
  ) rent ON rent.aid=curr.aid
  WHERE curr.n>0
  ON CONFLICT (dubai_area_id, period_end_month, usage, segment) DO UPDATE SET
    avg_price_sqm=EXCLUDED.avg_price_sqm, median_price_sqm=EXCLUDED.median_price_sqm,
    median_unit_price=EXCLUDED.median_unit_price, total_sales_volume=EXCLUDED.total_sales_volume,
    sales_transaction_count=EXCLUDED.sales_transaction_count, avg_sale_size_sqm=EXCLUDED.avg_sale_size_sqm,
    median_rent_sqm=EXCLUDED.median_rent_sqm, median_new_rent_sqm=EXCLUDED.median_new_rent_sqm,
    new_contract_count=EXCLUDED.new_contract_count, renew_contract_count=EXCLUDED.renew_contract_count,
    rent_stability_pct=EXCLUDED.rent_stability_pct, rental_yield_pct=EXCLUDED.rental_yield_pct,
    price_growth_pct=EXCLUDED.price_growth_pct, price_trend=EXCLUDED.price_trend;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $function$;

-- 4. get_dubai_area_metrics：加 p_segment + 每区样本护栏 + price_segment 口径标记。
--    价格类字段取 segment 行（样本足够时），租金/收益率类永远取 'all' 行。
--    旧调用 get_dubai_area_metrics() / ($1) 走默认参数，行为与之前完全一致。
DROP FUNCTION IF EXISTS get_dubai_area_metrics(text);

CREATE OR REPLACE FUNCTION get_dubai_area_metrics(
  p_usage text DEFAULT 'residential',
  p_segment text DEFAULT 'all',
  p_min_n int DEFAULT 10
)
RETURNS TABLE(
  id uuid, name character varying, name_ar character varying,
  avg_price_sqm numeric, median_price_sqm numeric, median_unit_price numeric,
  sales_volume numeric, transaction_count bigint, capital_growth_pct numeric,
  rental_yield_pct numeric, rent_stability_pct numeric, median_new_rent_sqm numeric,
  new_contract_count integer, renew_contract_count integer,
  price_segment text
)
LANGUAGE sql STABLE AS $function$
  WITH eff AS (
    SELECT CASE WHEN EXISTS (SELECT 1 FROM dubai_area_rolling_metrics WHERE usage = p_usage AND segment = 'all')
                THEN p_usage ELSE 'residential' END AS u
  ),
  latest AS (
    SELECT MAX(rm.period_end_month) AS pe
    FROM dubai_area_rolling_metrics rm, eff
    WHERE rm.usage = eff.u AND rm.segment = 'all'
  ),
  base AS (
    SELECT rm.* FROM dubai_area_rolling_metrics rm, eff, latest
    WHERE rm.usage = eff.u AND rm.segment = 'all' AND rm.period_end_month = latest.pe
  ),
  seg AS (
    SELECT rm.* FROM dubai_area_rolling_metrics rm, eff, latest
    WHERE p_segment <> 'all' AND rm.usage = eff.u AND rm.segment = p_segment
      AND rm.period_end_month = latest.pe
      AND rm.sales_transaction_count >= p_min_n
  )
  SELECT
    da.id, da.name, da.name_ar,
    ROUND(pick.avg_price_sqm::numeric, 0),
    ROUND(pick.median_price_sqm::numeric, 0),
    ROUND(pick.median_unit_price::numeric, 0),
    ROUND(pick.total_sales_volume::numeric, 0),
    pick.sales_transaction_count::bigint,
    pick.price_growth_pct,
    b.rental_yield_pct,
    b.rent_stability_pct,
    ROUND(b.median_new_rent_sqm::numeric, 0),
    b.new_contract_count,
    b.renew_contract_count,
    pick.price_segment
  FROM base b
  LEFT JOIN seg s ON s.dubai_area_id = b.dubai_area_id
  CROSS JOIN LATERAL (
    SELECT
      CASE WHEN s.dubai_area_id IS NOT NULL THEN s.avg_price_sqm ELSE b.avg_price_sqm END AS avg_price_sqm,
      CASE WHEN s.dubai_area_id IS NOT NULL THEN s.median_price_sqm ELSE b.median_price_sqm END AS median_price_sqm,
      CASE WHEN s.dubai_area_id IS NOT NULL THEN s.median_unit_price ELSE b.median_unit_price END AS median_unit_price,
      CASE WHEN s.dubai_area_id IS NOT NULL THEN s.total_sales_volume ELSE b.total_sales_volume END AS total_sales_volume,
      CASE WHEN s.dubai_area_id IS NOT NULL THEN s.sales_transaction_count ELSE b.sales_transaction_count END AS sales_transaction_count,
      CASE WHEN s.dubai_area_id IS NOT NULL THEN s.price_growth_pct ELSE b.price_growth_pct END AS price_growth_pct,
      CASE WHEN s.dubai_area_id IS NOT NULL THEN p_segment ELSE 'all' END AS price_segment
  ) pick
  JOIN dubai_areas da ON da.id = b.dubai_area_id
  WHERE b.sales_transaction_count > 0
  ORDER BY b.sales_transaction_count DESC;
$function$;

COMMENT ON FUNCTION get_dubai_area_metrics(text, text, int) IS
  'Area metrics with usage lens + market segment (all/offplan/ready). Price metrics come from the segment row when its sample >= p_min_n (else fall back to all; see price_segment). Rent/yield metrics always come from the all row.';
