-- ============================================================================
-- Dubai 投资分析 v2 —— 客户向成品函数(收益 / 5年预测 / 按预算推荐)
-- 依赖 v_sales / v_rent(见 dubai-analytics-v2.sql)
-- 收益率用 per-sqm(rent_sqm/price_sqm)→ 与户型/卧室无关,绕开"租约无卧室"的限制。
-- 应用:cd backend && npx ts-node scripts/db-runner.ts src/db/dubai-analytics-v2-functions.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION investment_analysis(
  p_area text, p_ptype text DEFAULT 'apartment',
  p_bedrooms int DEFAULT NULL, p_is_offplan boolean DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_like text := '%'||p_area||'%';
  v_block uuid;
  v_price_aed numeric; v_price_sqm numeric; v_size numeric; v_cnt int;
  v_rent_sqm numeric; v_rent_cnt int; v_price_then numeric;
  v_cagr numeric; v_g numeric; v_yield numeric; v_annual_rent numeric;
  v_future numeric; v_rentinc numeric; v_roi numeric; v_payback numeric; v_conf text;
  v_sc_sqft numeric; v_sc_drag numeric; v_net_yield numeric;
BEGIN
  SELECT id INTO v_block FROM dubai_areas WHERE name ILIKE v_like ORDER BY length(name) ASC LIMIT 1;

  SELECT percentile_cont(0.5) within group (order by price_aed),
         percentile_cont(0.5) within group (order by price_sqm),
         avg(size_sqm), count(*)
    INTO v_price_aed, v_price_sqm, v_size, v_cnt
  FROM v_sales
  WHERE (CASE WHEN v_block IS NOT NULL THEN dubai_area_id = v_block ELSE area_name ILIKE v_like END) AND ptype = p_ptype
    AND (p_bedrooms IS NULL OR bedrooms = p_bedrooms)
    AND (p_is_offplan IS NULL OR is_offplan = p_is_offplan)
    AND txn_date >= CURRENT_DATE - INTERVAL '24 months';

  IF v_cnt IS NULL OR v_cnt = 0 THEN
    RETURN jsonb_build_object('error','no sales data in last 24m','area',p_area,'ptype',p_ptype,'bedrooms',p_bedrooms);
  END IF;

  SELECT percentile_cont(0.5) within group (order by rent_sqm), count(*)
    INTO v_rent_sqm, v_rent_cnt
  FROM v_rent
  WHERE (CASE WHEN v_block IS NOT NULL THEN dubai_area_id = v_block ELSE area_name ILIKE v_like END) AND ptype = p_ptype
    AND start_date >= CURRENT_DATE - INTERVAL '24 months';

  SELECT percentile_cont(0.5) within group (order by price_sqm) INTO v_price_then
  FROM v_sales
  WHERE (CASE WHEN v_block IS NOT NULL THEN dubai_area_id = v_block ELSE area_name ILIKE v_like END) AND ptype = p_ptype
    AND (p_bedrooms IS NULL OR bedrooms = p_bedrooms)
    AND txn_date >= CURRENT_DATE - INTERVAL '48 months'
    AND txn_date <  CURRENT_DATE - INTERVAL '36 months';

  IF v_price_then > 0 THEN v_cagr := power(v_price_sqm / v_price_then, 1.0/3) - 1; END IF;
  v_g := greatest(-0.10, least(0.20, COALESCE(v_cagr, 0.03)));   -- 封顶防失真

  IF v_rent_sqm > 0 AND v_price_sqm > 0 THEN
    v_yield := round(v_rent_sqm / v_price_sqm * 100, 2);
    v_annual_rent := v_rent_sqm * v_size;
    v_payback := round(v_price_aed / NULLIF(v_annual_rent,0), 1);
  END IF;

  v_future := v_price_aed * power(1+v_g, 5);
  v_rentinc := CASE WHEN v_g = 0 THEN COALESCE(v_annual_rent,0)*5
                    ELSE COALESCE(v_annual_rent,0) * ((power(1+v_g,5)-1)/v_g) END;
  v_roi := round((v_future - v_price_aed + v_rentinc) / v_price_aed * 100, 1);
  v_conf := CASE WHEN v_cnt>=50 THEN 'high' WHEN v_cnt>=10 THEN 'medium' ELSE 'low' END;

  -- net = 本函数 gross − mv_area_net_yield 的 service-charge drag;缺物业费时 net 回退 gross。
  SELECT service_charge_sqft, sc_drag_pct INTO v_sc_sqft, v_sc_drag
  FROM mv_area_net_yield WHERE dubai_area_id = v_block;
  v_net_yield := CASE WHEN v_yield IS NULL THEN NULL
                      ELSE round((v_yield - COALESCE(v_sc_drag,0))::numeric, 2) END;

  RETURN jsonb_build_object(
    'area', p_area, 'ptype', p_ptype, 'bedrooms', p_bedrooms, 'is_offplan', p_is_offplan,
    'sample', jsonb_build_object('sales_count', v_cnt, 'rent_count', COALESCE(v_rent_cnt,0), 'confidence', v_conf),
    'median_price_aed', round(v_price_aed), 'median_price_sqm', round(v_price_sqm,0), 'avg_size_sqm', round(v_size,1),
    'gross_yield_pct', v_yield, 'net_yield_pct', v_net_yield, 'service_charge_sqft', v_sc_sqft,
    'cagr_3y_pct', round(COALESCE(v_cagr,0)*100,1), 'growth_used_pct', round(v_g*100,1),
    'projection_5y', jsonb_build_object(
       'future_price_aed', round(v_future), 'rental_income_5y_aed', round(v_rentinc),
       'total_roi_pct', v_roi, 'payback_years', v_payback),
    'note', 'indicative projection from historical DLD medians; not a guarantee'
  );
END $$;

-- 按预算/收入推荐:预算内的区,按目标(yield/growth/balanced)排序
CREATE OR REPLACE FUNCTION recommend_for_budget(
  p_budget numeric, p_goal text DEFAULT 'balanced',
  p_ptype text DEFAULT 'apartment', p_bedrooms int DEFAULT NULL, p_limit int DEFAULT 5
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE res jsonb;
BEGIN
  -- Fast path: the find-home calculator's default segment (apartment, all bedrooms)
  -- is precomputed in mv_area_invest_apt (refreshed daily). Reading it is ~ms vs the
  -- ~12–20s live percentile scan over v_sales/v_rent below. Other segments fall through.
  IF p_ptype = 'apartment' AND p_bedrooms IS NULL THEN
    SELECT COALESCE(jsonb_agg(row_to_json(x)),'[]'::jsonb) INTO res FROM (
      SELECT area_name, median_price_aed, median_price_sqm, sales_count,
             gross_yield_pct, service_charge_sqft, net_yield_pct, cagr_3y_pct
      FROM mv_area_invest_apt
      WHERE median_price_aed <= p_budget
      ORDER BY CASE p_goal
        WHEN 'yield'  THEN gross_yield_pct
        WHEN 'growth' THEN cagr_3y_pct
        ELSE COALESCE(gross_yield_pct,0) + COALESCE(cagr_3y_pct,0) END DESC NULLS LAST
      LIMIT p_limit
    ) x;
    RETURN res;
  END IF;

  WITH s AS (
    SELECT area_name, (array_agg(dubai_area_id) FILTER (WHERE dubai_area_id IS NOT NULL))[1] AS dubai_area_id,
      percentile_cont(0.5) within group (order by price_aed) AS price_aed,
      percentile_cont(0.5) within group (order by price_sqm) AS price_sqm,
      count(*) AS cnt
    FROM v_sales
    WHERE ptype=p_ptype AND (p_bedrooms IS NULL OR bedrooms=p_bedrooms)
      AND txn_date >= CURRENT_DATE - INTERVAL '24 months'
    GROUP BY area_name HAVING count(*) >= 10
  ),
  r AS (
    SELECT area_name, percentile_cont(0.5) within group (order by rent_sqm) AS rent_sqm
    FROM v_rent WHERE ptype=p_ptype AND start_date >= CURRENT_DATE - INTERVAL '24 months'
    GROUP BY area_name
  ),
  g AS (
    SELECT area_name, percentile_cont(0.5) within group (order by price_sqm) AS p_then
    FROM v_sales WHERE ptype=p_ptype AND (p_bedrooms IS NULL OR bedrooms=p_bedrooms)
      AND txn_date >= CURRENT_DATE - INTERVAL '48 months' AND txn_date < CURRENT_DATE - INTERVAL '36 months'
    GROUP BY area_name
  ),
  j AS (
    -- net = 本函数自己的 gross − mv_area_net_yield 的 service-charge drag(sc_drag_pct)。
    -- 直连区块(dubai_area_id);缺物业费的区 drag 为 null → net 回退到 gross,绝不 null 掉整行。
    -- 不直接用 view 的 net_yield_pct,因 view 的 gross 基准(全房型/12月)与本函数(公寓/24月)不同。
    SELECT s.area_name,
      round(s.price_aed::numeric) AS median_price_aed, round(s.price_sqm::numeric) AS median_price_sqm, s.cnt AS sales_count,
      round((r.rent_sqm/NULLIF(s.price_sqm,0)*100)::numeric,2) AS gross_yield_pct,
      ny.service_charge_sqft AS service_charge_sqft,
      round((r.rent_sqm/NULLIF(s.price_sqm,0)*100 - COALESCE(ny.sc_drag_pct,0))::numeric,2) AS net_yield_pct,
      round(((power(s.price_sqm/NULLIF(g.p_then,0),1.0/3)-1)*100)::numeric,1) AS cagr_3y_pct
    FROM s LEFT JOIN r USING(area_name) LEFT JOIN g USING(area_name)
      LEFT JOIN mv_area_net_yield ny ON ny.dubai_area_id = s.dubai_area_id
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
