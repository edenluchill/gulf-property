/**
 * Daily incremental refresh — runs on the UAE box via cron (direct API, no proxy).
 * Re-fetches a rolling window (previous month start .. today) for both datasets into
 * the LIVE tables (delete-window + insert = idempotent, picks up late-arriving and
 * corrected records), re-bridges rent's dubai_area_id for the window, then rebuilds
 * the current-month rolling metrics.
 *
 *   DUBAI_API_BASE_URL=https://apis.data.dubai npx ts-node --transpile-only scripts/dubai-daily.ts
 */
import dotenv from 'dotenv'
dotenv.config()
import pool from '../src/db/pool'
import { iteratePages } from '../src/sync/dubai/client/dataApi'
import { applyFieldMap } from '../src/sync/dubai/core/transform'
import { DATASETS } from '../src/sync/dubai/config/datasets'

const SETS = [
  { key: 'dld_transactions', table: 'dld_transactions', apiDate: 'instance_date', dbCol: 'instance_date' },
  { key: 'dld_rent_contracts', table: 'dld_rent_contracts', apiDate: 'contract_start_date', dbCol: 'start_date' },
]

// window: first day of previous month (UTC) .. tomorrow, as YYYY-MM-DD
function windowBounds(): { from: string; to: string } {
  const now = new Date()
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return { from: fmt(from), to: fmt(to) }
}

async function refresh(s: (typeof SETS)[number], from: string, to: string) {
  const ds = DATASETS.find((d) => d.key === s.key)!
  const cols = Object.keys(ds.fieldMap)
  await pool.query(`DELETE FROM ${s.table} WHERE ${s.dbCol} >= $1 AND ${s.dbCol} < $2`, [from, to])
  const base: any = { pageSize: 1000, order_by: s.apiDate, order_dir: 'asc', filter: `${s.apiDate}>='${from}' and ${s.apiDate}<'${to}'` }
  let inserted = 0
  for await (const { results } of iteratePages(ds.entity, ds.dataset, base)) {
    const mapped = results.map((r) => applyFieldMap(r, ds.fieldMap))
    if (!mapped.length) continue
    const vals: any[] = []
    const tuples = mapped.map((m, i) => {
      const b = i * cols.length
      cols.forEach((col) => vals.push((m as any)[col] ?? null))
      return `(${cols.map((_, j) => `$${b + j + 1}`).join(',')})`
    })
    await pool.query(`INSERT INTO ${s.table} (${cols.join(',')}) VALUES ${tuples.join(',')}`, vals)
    inserted += mapped.length
  }
  console.log(`[daily] ${s.table} ${from}..${to}: ${inserted} rows`)
  return inserted
}

async function main() {
  const { from, to } = windowBounds()
  console.log(`[daily] window ${from}..${to} @ ${new Date().toISOString()}`)
  for (const s of SETS) await refresh(s, from, to)

  // re-bridge rent dubai_area_id for the refreshed window
  const rb = await pool.query(`
    UPDATE dld_rent_contracts rc SET dubai_area_id = dla.dubai_area_id
      FROM dld_areas dla
     WHERE dla.area_id = rc.area_id AND dla.dubai_area_id IS NOT NULL
       AND rc.dubai_area_id IS NULL AND rc.start_date >= $1`, [from])
  console.log(`[daily] rent re-bridged: ${rb.rowCount}`)

  await pool.query(`DELETE FROM dubai_area_rolling_metrics WHERE period_end_month = DATE_TRUNC('month', CURRENT_DATE)`)
  // Per-usage metrics (住宅/商业/酒店/工业/其他) — no hidden filters. See
  // area-metrics-by-usage.sql.
  const m = await pool.query(`SELECT calculate_area_metrics_by_usage(CURRENT_DATE) AS n`)
  console.log(`[daily] official per-usage metrics rebuilt: ${m.rows[0].n} rows`)

  // ── Custom (hand-drawn) areas: geocode-based spatial metrics ─────────────
  // Official areas use the area_id bridge above. Colleague-drawn areas have no
  // real bridge, so they're matched spatially via geocoded points. See
  // dld-geocode-cache.sql / custom-area-metrics.sql.

  // 1. Geocode any NEW project/building/area keys (resumable: skips cached).
  //    Best-effort — never fail the daily run over geocoding.
  try {
    const { execFileSync } = await import('child_process')
    for (const mode of [[], ['--buildings'], ['--areas']]) {
      execFileSync('npx', ['ts-node', '--transpile-only', 'scripts/geocode-dld-projects.ts', ...mode], {
        cwd: process.cwd(), stdio: 'inherit', timeout: 10 * 60 * 1000,
      })
    }
  } catch (e) {
    console.warn('[daily] incremental geocode skipped:', e instanceof Error ? e.message : e)
  }

  // 2. Refresh area centroids (so new areas/projects get an '__AREA__' fallback).
  await pool.query(`
    INSERT INTO dld_project_locations (area_name, project_name, lat, lng, geom, source, tx_count)
    SELECT s.area_name, '__AREA__', ST_Y(s.c::geometry), ST_X(s.c::geometry), s.c, 'area_centroid', 0
    FROM (SELECT area_name, ST_SetSRID(ST_MakePoint(
            percentile_cont(0.5) WITHIN GROUP (ORDER BY ST_X(geom::geometry)),
            percentile_cont(0.5) WITHIN GROUP (ORDER BY ST_Y(geom::geometry))),4326)::geography AS c
          FROM dld_project_locations WHERE geom IS NOT NULL AND project_name <> '__AREA__'
          GROUP BY area_name) s
    ON CONFLICT (area_name, project_name) DO UPDATE SET
      geom = EXCLUDED.geom, lat = EXCLUDED.lat, lng = EXCLUDED.lng, source='area_centroid', geocoded_at=now()`)

  // 3. Per-usage spatial rolling metrics for custom areas → same table the map reads.
  const c = await pool.query(`SELECT calculate_custom_area_metrics_by_usage(CURRENT_DATE) AS n`)
  console.log(`[daily] custom-area per-usage metrics rebuilt: ${c.rows[0].n} rows`)

  // 4. Bump custom areas' updated_at → changes /meta/data-version → clients
  //    clear their cache and refetch the new colours.
  await pool.query(`
    UPDATE dubai_areas SET updated_at = now()
     WHERE id IN (SELECT dubai_area_id FROM dubai_area_rolling_metrics
                   WHERE period_end_month = date_trunc('month', CURRENT_DATE))
       AND NOT EXISTS (SELECT 1 FROM dld_areas dla WHERE dla.dubai_area_id = dubai_areas.id AND dla.area_id < 900000)`)
  console.log('[daily] done.')
  await pool.end()
}
main().catch((e) => { console.error('[daily] FAILED', e?.response?.status, e?.message || e); process.exit(1) })
