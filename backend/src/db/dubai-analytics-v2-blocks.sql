-- ============================================================================
-- Dubai 投资分析 v2 —— 按 area block(dubai_area_id)对齐的函数
-- 让每个地图区块拿到一致、去重的数据(不靠 area_name 模糊匹配)。
-- 应用:cd backend && npx ts-node scripts/db-runner.ts src/db/dubai-analytics-v2-blocks.sql
-- ============================================================================

-- 按 block 的投资分析(地图点击区块 → 直接传 dubai_area_id)
CREATE OR REPLACE FUNCTION block_analysis(
  p_block uuid, p_ptype text DEFAULT 'apartment',
  p_bedrooms int DEFAULT NULL, p_is_offplan boolean DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_name text;
  v_price_aed numeric; v_price_sqm numeric; v_size numeric; v_cnt int;
  v_rent_sqm numeric; v_rent_cnt int; v_price_then numeric;
  v_cagr numeric; v_g numeric; v_yield numeric; v_annual_rent numeric;
  v_future numeric; v_rentinc numeric; v_roi numeric; v_payback numeric; v_conf text;
BEGIN
  SELECT name INTO v_name FROM dubai_areas WHERE id = p_block;

  SELECT percentile_cont(0.5) within group (order by price_aed),
         percentile_cont(0.5) within group (order by price_sqm),
         avg(size_sqm), count(*)
    INTO v_price_aed, v_price_sqm, v_size, v_cnt
  FROM v_sales
  WHERE dubai_area_id = p_block AND ptype = p_ptype
    AND (p_bedrooms IS NULL OR bedrooms = p_bedrooms)
    AND (p_is_offplan IS NULL OR is_offplan = p_is_offplan)
    AND txn_date >= CURRENT_DATE - INTERVAL '24 months';

  IF v_cnt IS NULL OR v_cnt = 0 THEN
    RETURN jsonb_build_object('block_id',p_block,'area_name',v_name,'ptype',p_ptype,
      'bedrooms',p_bedrooms,'sample',jsonb_build_object('sales_count',0,'confidence','none'),
      'note','no sales data in last 24m for this block/segment');
  END IF;

  SELECT percentile_cont(0.5) within group (order by rent_sqm), count(*)
    INTO v_rent_sqm, v_rent_cnt
  FROM v_rent WHERE dubai_area_id = p_block AND ptype = p_ptype
    AND start_date >= CURRENT_DATE - INTERVAL '24 months';

  SELECT percentile_cont(0.5) within group (order by price_sqm) INTO v_price_then
  FROM v_sales WHERE dubai_area_id = p_block AND ptype = p_ptype
    AND (p_bedrooms IS NULL OR bedrooms = p_bedrooms)
    AND txn_date >= CURRENT_DATE - INTERVAL '48 months'
    AND txn_date <  CURRENT_DATE - INTERVAL '36 months';

  IF v_price_then > 0 THEN v_cagr := power(v_price_sqm / v_price_then, 1.0/3) - 1; END IF;
  v_g := greatest(-0.10, least(0.20, COALESCE(v_cagr, 0.03)));

  IF v_rent_sqm > 0 AND v_price_sqm > 0 THEN
    v_yield := round((v_rent_sqm / v_price_sqm * 100)::numeric, 2);
    v_annual_rent := v_rent_sqm * v_size;
    v_payback := round((v_price_aed / NULLIF(v_annual_rent,0))::numeric, 1);
  END IF;
  v_future := v_price_aed * power(1+v_g, 5);
  v_rentinc := CASE WHEN v_g = 0 THEN COALESCE(v_annual_rent,0)*5
                    ELSE COALESCE(v_annual_rent,0) * ((power(1+v_g,5)-1)/v_g) END;
  v_roi := round(((v_future - v_price_aed + v_rentinc) / v_price_aed * 100)::numeric, 1);
  v_conf := CASE WHEN v_cnt>=50 THEN 'high' WHEN v_cnt>=10 THEN 'medium' ELSE 'low' END;

  RETURN jsonb_build_object(
    'block_id', p_block, 'area_name', v_name, 'ptype', p_ptype, 'bedrooms', p_bedrooms, 'is_offplan', p_is_offplan,
    'sample', jsonb_build_object('sales_count',v_cnt,'rent_count',COALESCE(v_rent_cnt,0),'confidence',v_conf),
    'median_price_aed', round(v_price_aed), 'median_price_sqm', round(v_price_sqm), 'avg_size_sqm', round(v_size::numeric,1),
    'gross_yield_pct', v_yield, 'cagr_3y_pct', round((COALESCE(v_cagr,0)*100)::numeric,1), 'growth_used_pct', round((v_g*100)::numeric,1),
    'projection_5y', jsonb_build_object('future_price_aed',round(v_future),'rental_income_5y_aed',round(v_rentinc),
       'total_roi_pct',v_roi,'payback_years',v_payback),
    'note','indicative projection from historical DLD medians; not a guarantee'
  );
END $$;

-- 按预算推荐 —— 改为 block-keyed(返回 block_id + 区名,直接对应地图区块,去重)
CREATE OR REPLACE FUNCTION recommend_for_budget(
  p_budget numeric, p_goal text DEFAULT 'balanced',
  p_ptype text DEFAULT 'apartment', p_bedrooms int DEFAULT NULL, p_limit int DEFAULT 5
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE res jsonb;
BEGIN
  WITH s AS (
    SELECT dubai_area_id,
      percentile_cont(0.5) within group (order by price_aed) AS price_aed,
      percentile_cont(0.5) within group (order by price_sqm) AS price_sqm,
      count(*) AS cnt
    FROM v_sales
    WHERE dubai_area_id IS NOT NULL AND ptype=p_ptype AND (p_bedrooms IS NULL OR bedrooms=p_bedrooms)
      AND txn_date >= CURRENT_DATE - INTERVAL '24 months'
    GROUP BY dubai_area_id HAVING count(*) >= 10
  ),
  r AS (
    SELECT dubai_area_id, percentile_cont(0.5) within group (order by rent_sqm) AS rent_sqm
    FROM v_rent WHERE dubai_area_id IS NOT NULL AND ptype=p_ptype AND start_date >= CURRENT_DATE - INTERVAL '24 months'
    GROUP BY dubai_area_id
  ),
  g AS (
    SELECT dubai_area_id, percentile_cont(0.5) within group (order by price_sqm) AS p_then
    FROM v_sales WHERE dubai_area_id IS NOT NULL AND ptype=p_ptype AND (p_bedrooms IS NULL OR bedrooms=p_bedrooms)
      AND txn_date >= CURRENT_DATE - INTERVAL '48 months' AND txn_date < CURRENT_DATE - INTERVAL '36 months'
    GROUP BY dubai_area_id
  ),
  j AS (
    SELECT s.dubai_area_id AS block_id, da.name AS area_name,
      round(s.price_aed::numeric) AS median_price_aed, round(s.price_sqm::numeric) AS median_price_sqm, s.cnt AS sales_count,
      round((r.rent_sqm/NULLIF(s.price_sqm,0)*100)::numeric,2) AS gross_yield_pct,
      round(((power(s.price_sqm/NULLIF(g.p_then,0),1.0/3)-1)*100)::numeric,1) AS cagr_3y_pct,
      CASE WHEN s.cnt>=50 THEN 'high' WHEN s.cnt>=10 THEN 'medium' ELSE 'low' END AS confidence
    FROM s
    JOIN dubai_areas da ON da.id = s.dubai_area_id
    LEFT JOIN r USING(dubai_area_id) LEFT JOIN g USING(dubai_area_id)
    WHERE s.price_aed <= p_budget
  )
  SELECT COALESCE(jsonb_agg(row_to_json(x)),'[]'::jsonb) INTO res FROM (
    SELECT * FROM j
    ORDER BY CASE p_goal
      WHEN 'yield'  THEN gross_yield_pct
      WHEN 'growth' THEN cagr_3y_pct
      ELSE COALESCE(gross_yield_pct,0) + COALESCE(cagr_3y_pct,0) END DESC NULLS LAST
    LIMIT p_limit
  ) x;
  RETURN res;
END $$;

-- 覆盖率小工具(让你随时看哪些 block 有可靠数据)
CREATE OR REPLACE VIEW v_block_coverage AS
SELECT da.id AS block_id, da.name AS area_name,
  count(s.*) FILTER (WHERE s.txn_date >= CURRENT_DATE - INTERVAL '24 months') AS sales_24m,
  CASE WHEN count(s.*) FILTER (WHERE s.txn_date >= CURRENT_DATE - INTERVAL '24 months') >= 50 THEN 'high'
       WHEN count(s.*) FILTER (WHERE s.txn_date >= CURRENT_DATE - INTERVAL '24 months') >= 10 THEN 'medium'
       WHEN count(s.*) > 0 THEN 'low' ELSE 'none' END AS data_quality
FROM dubai_areas da
LEFT JOIN v_sales s ON s.dubai_area_id = da.id
GROUP BY da.id, da.name;
