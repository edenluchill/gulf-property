-- ============================================================================
-- area_investment_report —— 复合"全维"投资报告(一次返回所有维度 + 显式缺口)
-- 区名解析:先匹配 dubai_areas 区块(认营销名如 "Marina"/"Arabian Ranches"),
--          匹配不到再退回 DLD 地籍名 ILIKE。依赖 v_sales / v_rent / dubai_areas。
-- 应用:cd backend && npx ts-node scripts/db-runner.ts src/db/dubai-analytics-v2-report.sql
-- ============================================================================
CREATE OR REPLACE FUNCTION area_investment_report(
  p_area text, p_ptype text DEFAULT 'apartment', p_bedrooms int DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_like text := '%'||p_area||'%';
  v_block uuid;
  v_price_aed numeric; v_price_sqm numeric; v_p25 numeric; v_p75 numeric; v_size numeric;
  v_cnt int; v_cnt12 int; v_offplan_share numeric;
  v_rent_sqm numeric; v_rent_cnt int;
  v_then numeric; v_prev12 numeric; v_cur12 numeric; v_city_sqm numeric;
  v_cagr numeric; v_yoy numeric; v_g numeric;
  v_yield numeric; v_annual_rent numeric; v_future numeric; v_rentinc numeric; v_roi numeric; v_payback numeric;
  v_conf text; v_liq text; v_trend text; v_avail jsonb;
  v_sc_sqft numeric; v_sc_drag numeric; v_net_yield numeric;
BEGIN
  -- 营销名 → 区块(认 "Marina"/"Arabian Ranches" 等);取最短匹配名(最贴切)
  SELECT id INTO v_block FROM dubai_areas WHERE name ILIKE v_like ORDER BY length(name) ASC LIMIT 1;

  SELECT percentile_cont(0.5) within group (order by price_aed),
         percentile_cont(0.5) within group (order by price_sqm),
         percentile_cont(0.25) within group (order by price_sqm),
         percentile_cont(0.75) within group (order by price_sqm),
         avg(size_sqm), count(*),
         count(*) FILTER (WHERE txn_date >= CURRENT_DATE - INTERVAL '12 months'),
         avg((is_offplan)::int::numeric)
    INTO v_price_aed, v_price_sqm, v_p25, v_p75, v_size, v_cnt, v_cnt12, v_offplan_share
  FROM v_sales
  WHERE ptype = p_ptype AND (p_bedrooms IS NULL OR bedrooms = p_bedrooms)
    AND (CASE WHEN v_block IS NOT NULL THEN dubai_area_id = v_block ELSE area_name ILIKE v_like END)
    AND txn_date >= CURRENT_DATE - INTERVAL '24 months';

  IF v_cnt IS NULL OR v_cnt = 0 THEN
    SELECT jsonb_agg(jsonb_build_object('ptype', ptype, 'count', c) ORDER BY c DESC) INTO v_avail
    FROM (SELECT ptype, count(*) c FROM v_sales
          WHERE (CASE WHEN v_block IS NOT NULL THEN dubai_area_id = v_block ELSE area_name ILIKE v_like END)
            AND txn_date >= CURRENT_DATE - INTERVAL '24 months'
          GROUP BY ptype) q;
    RETURN jsonb_build_object('area',p_area,'ptype',p_ptype,'bedrooms',p_bedrooms,
      'error','no_data', 'available_in_area', COALESCE(v_avail,'[]'::jsonb),
      'message','该区/户型近2年无成交;改用 available_in_area 里有数据的类型(可能该区就没有这种房型)');
  END IF;

  SELECT percentile_cont(0.5) within group (order by rent_sqm), count(*)
    INTO v_rent_sqm, v_rent_cnt
  FROM v_rent WHERE ptype = p_ptype
    AND (CASE WHEN v_block IS NOT NULL THEN dubai_area_id = v_block ELSE area_name ILIKE v_like END)
    AND start_date >= CURRENT_DATE - INTERVAL '24 months';

  SELECT percentile_cont(0.5) within group (order by price_sqm) INTO v_then
  FROM v_sales WHERE ptype=p_ptype AND (p_bedrooms IS NULL OR bedrooms=p_bedrooms)
    AND (CASE WHEN v_block IS NOT NULL THEN dubai_area_id = v_block ELSE area_name ILIKE v_like END)
    AND txn_date >= CURRENT_DATE - INTERVAL '48 months' AND txn_date < CURRENT_DATE - INTERVAL '36 months';
  SELECT percentile_cont(0.5) within group (order by price_sqm) INTO v_prev12
  FROM v_sales WHERE ptype=p_ptype AND (p_bedrooms IS NULL OR bedrooms=p_bedrooms)
    AND (CASE WHEN v_block IS NOT NULL THEN dubai_area_id = v_block ELSE area_name ILIKE v_like END)
    AND txn_date >= CURRENT_DATE - INTERVAL '24 months' AND txn_date < CURRENT_DATE - INTERVAL '12 months';
  SELECT percentile_cont(0.5) within group (order by price_sqm) INTO v_cur12
  FROM v_sales WHERE ptype=p_ptype AND (p_bedrooms IS NULL OR bedrooms=p_bedrooms)
    AND (CASE WHEN v_block IS NOT NULL THEN dubai_area_id = v_block ELSE area_name ILIKE v_like END)
    AND txn_date >= CURRENT_DATE - INTERVAL '12 months';
  SELECT percentile_cont(0.5) within group (order by price_sqm) INTO v_city_sqm
  FROM v_sales WHERE ptype=p_ptype AND txn_date >= CURRENT_DATE - INTERVAL '12 months';

  IF v_then > 0 THEN v_cagr := power(v_price_sqm / v_then, 1.0/3) - 1; END IF;
  IF v_prev12 > 0 AND v_cur12 > 0 THEN v_yoy := v_cur12/v_prev12 - 1; END IF;
  v_g := greatest(-0.10, least(0.20, COALESCE(v_cagr, 0.03)));

  IF v_rent_sqm > 0 AND v_price_sqm > 0 THEN
    v_yield := round((v_rent_sqm / v_price_sqm * 100)::numeric, 2);
    v_annual_rent := v_rent_sqm * v_size;
    v_payback := round((v_price_aed / NULLIF(v_annual_rent,0))::numeric, 1);
  END IF;
  v_future := v_price_aed * power(1+v_g, 5);
  v_rentinc := CASE WHEN v_g=0 THEN COALESCE(v_annual_rent,0)*5 ELSE COALESCE(v_annual_rent,0)*((power(1+v_g,5)-1)/v_g) END;
  v_roi := round(((v_future - v_price_aed + v_rentinc) / v_price_aed * 100)::numeric, 1);

  v_conf := CASE WHEN v_cnt>=50 THEN 'high' WHEN v_cnt>=10 THEN 'medium' ELSE 'low' END;
  v_liq  := CASE WHEN v_cnt12>=200 THEN 'high' WHEN v_cnt12>=50 THEN 'medium' WHEN v_cnt12>=10 THEN 'low' ELSE 'thin' END;
  v_trend := CASE WHEN COALESCE(v_cagr,0)>0.05 THEN 'up' WHEN COALESCE(v_cagr,0)< -0.02 THEN 'down' ELSE 'stable' END;

  -- net = 本函数 gross − mv_area_net_yield 的 service-charge drag;缺物业费时 net 回退 gross。
  SELECT service_charge_sqft, sc_drag_pct INTO v_sc_sqft, v_sc_drag
  FROM mv_area_net_yield WHERE dubai_area_id = v_block;
  v_net_yield := CASE WHEN v_yield IS NULL THEN NULL
                      ELSE round((v_yield - COALESCE(v_sc_drag,0))::numeric, 2) END;

  RETURN jsonb_build_object(
    'area', p_area, 'matched_block', v_block, 'ptype', p_ptype, 'bedrooms', p_bedrooms,
    'pricing', jsonb_build_object(
      'median_price_aed', round(v_price_aed), 'median_price_sqm', round(v_price_sqm),
      'price_sqm_p25', round(v_p25), 'price_sqm_p75', round(v_p75), 'avg_size_sqm', round(v_size::numeric,1)),
    'trend', jsonb_build_object('cagr_3y_pct', round((COALESCE(v_cagr,0)*100)::numeric,1),
      'yoy_pct', round((COALESCE(v_yoy,0)*100)::numeric,1), 'direction', v_trend),
    'yield', jsonb_build_object('gross_yield_pct', v_yield, 'net_yield_pct', v_net_yield,
      'service_charge_sqft', v_sc_sqft,
      'note', CASE WHEN v_sc_sqft IS NOT NULL THEN 'net = gross − service-charge drag (residential SC, AED/sqft)'
                   ELSE 'net = gross (no service-charge data for this area)' END),
    'projection_5y', jsonb_build_object('growth_used_pct', round((v_g*100)::numeric,1),
      'future_price_aed', round(v_future), 'rental_income_5y_aed', round(v_rentinc),
      'total_roi_pct', v_roi, 'payback_years', v_payback, 'basis','indicative, not guaranteed'),
    'liquidity', jsonb_build_object('sales_last_12m', v_cnt12, 'level', v_liq),
    'context', jsonb_build_object(
      'vs_city_pct', CASE WHEN v_city_sqm>0 THEN round((v_price_sqm/v_city_sqm*100-100)::numeric,1) ELSE NULL END,
      'offplan_share_pct', round((COALESCE(v_offplan_share,0)*100)::numeric,0)),
    'sample', jsonb_build_object('sales_count', v_cnt, 'rent_count', COALESCE(v_rent_cnt,0), 'confidence', v_conf),
    'persona_hints', jsonb_build_object(
      'yield_friendly', COALESCE(v_yield,0) >= 6,
      'growth_friendly', COALESCE(v_cagr,0)*100 >= 10,
      'value_vs_city', CASE WHEN v_city_sqm>0 AND v_price_sqm < v_city_sqm THEN true ELSE false END),
    'gaps', (CASE WHEN v_sc_sqft IS NULL THEN jsonb_build_array('net_yield: no service-charge data for this area (net = gross)') ELSE '[]'::jsonb END) || jsonb_build_array(
      'supply_pipeline: needs projects/handover data (PROD)',
      'demographics/demand: needs DSC population (request access)',
      'liquidity is volume-based; days-on-market not in DLD')
  );
END $$;
