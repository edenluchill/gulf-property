-- ===========================================================================
-- FIX (2026-07-17): get_dubai_area_metrics anchored EVERY area to the single
-- GLOBAL MAX(period_end_month). Any area without a row at that exact month fell
-- out of the result entirely → BLANK (grey) on the map's capital-growth layer.
--
-- This bites on every data batch / daily recompute: the daily job writes OFFICIAL
-- areas first (calculate_area_rolling_metrics) then CUSTOM areas
-- (calculate_custom_area_rolling_metrics, "Run after"). High-volume official
-- areas advance the global latest month first, so custom + low-activity areas
-- that don't yet have that month's row VANISH until their row lands. Some areas
-- also legitimately produce no row in a sparse month (WHERE txn_count>0) and then
-- disappear for good under the global anchor.
--
-- Measured 2026-07-17: 20 visible real areas (Jumeirah Park, Town Square,
-- Remraam, Pearl Jumeirah, Al Nahda, …) stuck at 2026-05/06 while global max was
-- 2026-07 → all grey on the map, right now.
--
-- FIX: anchor PER-AREA to that area's own latest period, capped to within
-- FRESHNESS_MONTHS (3) of the global max. A 1-2 month lag now shows last month's
-- value instead of disappearing; only genuinely stale (>3mo) areas stay grey
-- (honest "no recent data"). Change is additive-only: it can only ADD back areas
-- that the global anchor dropped, never removes a currently-correct area.
--
-- Signature/return columns/segment-overlay logic all unchanged — only the base/
-- seg period selection differs (global pe → per-area DISTINCT ON within cap, and
-- seg now aligns to each area's chosen base period).
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.get_dubai_area_metrics(
  p_usage text DEFAULT 'residential'::text,
  p_segment text DEFAULT 'all'::text,
  p_min_n integer DEFAULT 10
)
RETURNS TABLE(
  id uuid, name character varying, name_ar character varying,
  avg_price_sqm numeric, median_price_sqm numeric, median_unit_price numeric,
  sales_volume numeric, transaction_count bigint, capital_growth_pct numeric,
  rental_yield_pct numeric, rent_stability_pct numeric, median_new_rent_sqm numeric,
  new_contract_count integer, renew_contract_count integer,
  price_segment text, transaction_count_all bigint
)
LANGUAGE sql
STABLE
AS $function$
  WITH eff AS (
    SELECT CASE WHEN EXISTS (SELECT 1 FROM dubai_area_rolling_metrics WHERE usage = p_usage AND segment = 'all')
                THEN p_usage ELSE 'residential' END AS u
  ),
  gmax AS (
    -- Global newest month — used ONLY as the staleness ceiling, not as a hard anchor.
    SELECT MAX(rm.period_end_month) AS pe
    FROM dubai_area_rolling_metrics rm, eff
    WHERE rm.usage = eff.u AND rm.segment = 'all'
  ),
  base AS (
    -- PER-AREA latest 'all' row within FRESHNESS_MONTHS of the global max, so an
    -- area whose newest row lags 1-2 months shows that row instead of vanishing.
    SELECT DISTINCT ON (rm.dubai_area_id) rm.*
    FROM dubai_area_rolling_metrics rm, eff, gmax
    WHERE rm.usage = eff.u AND rm.segment = 'all'
      AND rm.period_end_month >= gmax.pe - INTERVAL '3 months'
    ORDER BY rm.dubai_area_id, rm.period_end_month DESC
  ),
  seg AS (
    -- Segment overlay across the same eligible window; aligned to base's chosen
    -- per-area period in the join below (NOT to the global max).
    SELECT rm.* FROM dubai_area_rolling_metrics rm, eff, gmax
    WHERE p_segment <> 'all' AND rm.usage = eff.u AND rm.segment = p_segment
      AND rm.period_end_month >= gmax.pe - INTERVAL '3 months'
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
    pick.price_segment,
    b.sales_transaction_count::bigint
  FROM base b
  LEFT JOIN seg s
    ON s.dubai_area_id = b.dubai_area_id
   AND s.period_end_month = b.period_end_month   -- align overlay to base's per-area period
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
