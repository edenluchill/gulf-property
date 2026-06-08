-- ============================================================================
-- Dubai 投资分析 v2 —— 干净查询层(视图)+ 万能受控分析函数
-- 设计:docs/dubai-analytics-db-spec.md
-- 在现有真实数据(dld_transactions / dld_rent_contracts)上即可用,无需 backfill。
-- 规范化(bedrooms/size_band/ptype)在视图里 CASE 现算 → 零迁移、零维护。
-- 应用:cd backend && npx ts-node scripts/db-runner.ts src/db/dubai-analytics-v2.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- v_sales —— 销售事实(住宅可控分析的查询面)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_sales AS
SELECT
  t.transaction_id,
  t.instance_date                          AS txn_date,
  t.area_id,
  dla.dubai_area_id,
  t.area_name,
  CASE t.property_type
    WHEN 'Unit'     THEN 'apartment'
    WHEN 'Villa'    THEN 'villa'
    WHEN 'Land'     THEN 'land'
    WHEN 'Building' THEN 'building'
    ELSE lower(t.property_type)
  END                                       AS ptype,
  CASE
    WHEN t.rooms = 'Studio'        THEN 0
    WHEN t.rooms ~ '^[0-9]+ B/R$'  THEN split_part(t.rooms, ' ', 1)::int
    ELSE NULL
  END                                       AS bedrooms,
  t.procedure_area                          AS size_sqm,
  CASE
    WHEN t.procedure_area IS NULL  THEN NULL
    WHEN t.procedure_area < 50     THEN 'XS'
    WHEN t.procedure_area < 100    THEN 'S'
    WHEN t.procedure_area < 200    THEN 'M'
    WHEN t.procedure_area < 400    THEN 'L'
    ELSE 'XL'
  END                                       AS size_band,
  COALESCE(t.is_offplan, false)             AS is_offplan,
  t.has_parking,
  t.property_usage,
  t.project_name,
  t.actual_worth                            AS price_aed,
  t.meter_sale_price                        AS price_sqm
FROM dld_transactions t
LEFT JOIN dld_areas dla ON dla.area_id = t.area_id
WHERE t.trans_group = 'Sales'
  AND t.meter_sale_price > 0
  AND t.instance_date <= CURRENT_DATE          -- 拦垃圾未来日期
  AND t.instance_date >= '2000-01-01';         -- 拦伊斯兰历/古董垃圾日期

-- ---------------------------------------------------------------------------
-- v_rent —— 租约事实(住宅,沿用现有异常值过滤)。注意:无卧室数,用 size_band 代理。
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_rent AS
SELECT
  r.contract_id,
  COALESCE(r.dubai_area_id, dla.dubai_area_id) AS dubai_area_id,
  r.area_id,
  r.area_name,
  CASE
    WHEN r.property_type IN ('Flat','Studio ','Studio','Hotel apartments') THEN 'apartment'
    WHEN r.property_type IN ('Villa','Complex Villas')                     THEN 'villa'
    ELSE lower(r.property_type)
  END                                        AS ptype,
  r.property_area                            AS size_sqm,
  CASE
    WHEN r.property_area IS NULL THEN NULL
    WHEN r.property_area < 50    THEN 'XS'
    WHEN r.property_area < 100   THEN 'S'
    WHEN r.property_area < 200   THEN 'M'
    WHEN r.property_area < 400   THEN 'L'
    ELSE 'XL'
  END                                        AS size_band,
  r.annual_amount                            AS annual_rent,
  (r.annual_amount / NULLIF(r.property_area, 0)) AS rent_sqm,
  r.start_date
FROM dld_rent_contracts r
LEFT JOIN dld_areas dla ON dla.area_id = r.area_id
WHERE r.property_type IN ('Flat','Studio ','Studio','Hotel apartments','Villa','Complex Villas')
  AND r.property_area >= 20
  AND r.annual_amount > 0
  AND r.annual_amount <= 500000
  AND (r.annual_amount / NULLIF(r.property_area, 0)) <= 3000
  AND r.start_date <= CURRENT_DATE              -- 拦垃圾未来日期(如 2205)
  AND r.start_date >= '2000-01-01';

-- ---------------------------------------------------------------------------
-- market_stats —— 万能受控分析(白名单参数化 = 安全版 text-to-SQL)
--   p_group_by 留空的维度 + p_filters 固定的维度 = 受控变量
--   p_group_by 的维度 = 被观察变量
-- 例:Marina 同质 1 居 期房 vs 现房溢价
--   SELECT market_stats('{"ptype":"apartment","bedrooms":1,"area_name":"Marsa Dubai"}',
--                        ARRAY['is_offplan'], ARRAY['txn_count','median_price_sqm']);
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION market_stats(
  p_filters  jsonb   DEFAULT '{}'::jsonb,
  p_group_by text[]  DEFAULT ARRAY[]::text[],
  p_measures text[]  DEFAULT ARRAY['txn_count','median_price_sqm']::text[]
) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  dim_map jsonb := jsonb_build_object(
    'area_name','area_name', 'block','dubai_area_id', 'ptype','ptype', 'bedrooms','bedrooms',
    'size_band','size_band', 'is_offplan','is_offplan', 'has_parking','has_parking',
    'property_usage','property_usage', 'year','(EXTRACT(YEAR FROM txn_date)::int)');
  meas_map jsonb := jsonb_build_object(
    'txn_count','COUNT(*)::numeric',
    'median_price_aed','percentile_cont(0.5) within group (order by price_aed)',
    'median_price_sqm','percentile_cont(0.5) within group (order by price_sqm)',
    'avg_price_sqm','avg(price_sqm)',
    'p25_price_sqm','percentile_cont(0.25) within group (order by price_sqm)',
    'p75_price_sqm','percentile_cont(0.75) within group (order by price_sqm)',
    'avg_size_sqm','avg(size_sqm)');
  sel text := ''; grp text := ''; whr text := 'price_sqm > 0';
  g text; m text; k text; v jsonb; arr text[];
  res jsonb;
BEGIN
  FOREACH g IN ARRAY p_group_by LOOP
    IF NOT dim_map ? g THEN RAISE EXCEPTION 'unknown dimension: %', g; END IF;
    sel := sel || format('%s AS %I, ', dim_map->>g, g);
    grp := grp || (dim_map->>g) || ', ';
  END LOOP;

  FOREACH m IN ARRAY p_measures LOOP
    IF NOT meas_map ? m THEN RAISE EXCEPTION 'unknown measure: %', m; END IF;
    sel := sel || format('round((%s)::numeric, 2) AS %I, ', meas_map->>m, m);
  END LOOP;
  sel := rtrim(sel, ', ');

  FOR k, v IN SELECT * FROM jsonb_each(p_filters) LOOP
    IF    k = 'size_min'  THEN whr := whr || format(' AND size_sqm >= %s', (v#>>'{}')::numeric);
    ELSIF k = 'size_max'  THEN whr := whr || format(' AND size_sqm <= %s', (v#>>'{}')::numeric);
    ELSIF k = 'date_from' THEN whr := whr || format(' AND txn_date >= %L', v#>>'{}');
    ELSIF k = 'date_to'   THEN whr := whr || format(' AND txn_date <= %L', v#>>'{}');
    ELSIF k = 'bedrooms_min' THEN whr := whr || format(' AND bedrooms >= %s', (v#>>'{}')::int);
    ELSIF k = 'area_like' THEN whr := whr || format(' AND area_name ILIKE %L', '%'||(v#>>'{}')||'%');
    ELSIF dim_map ? k THEN
      IF jsonb_typeof(v) = 'array' THEN
        SELECT array_agg(x#>>'{}') INTO arr FROM jsonb_array_elements(v) x;
        whr := whr || format(' AND (%s)::text = ANY(%L)', dim_map->>k, arr);
      ELSE
        whr := whr || format(' AND (%s)::text = %L', dim_map->>k, v#>>'{}');
      END IF;
    ELSE RAISE EXCEPTION 'unknown filter: %', k;
    END IF;
  END LOOP;

  EXECUTE format(
    'SELECT COALESCE(jsonb_agg(row_to_json(r)), ''[]''::jsonb) FROM '
    || '(SELECT %s FROM v_sales WHERE %s %s ORDER BY %s LIMIT 300) r',
    sel, whr,
    CASE WHEN grp <> '' THEN 'GROUP BY ' || rtrim(grp, ', ') ELSE '' END,
    CASE WHEN grp <> '' THEN rtrim(grp, ', ') ELSE '1' END
  ) INTO res;

  RETURN res;
END $$;
