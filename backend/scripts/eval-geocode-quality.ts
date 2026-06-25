/**
 * Geocode quality evaluation.
 *
 * Two questions:
 *   COVERAGE (匹配率): of the transactions we *could* place, how many are placed?
 *   ACCURACY (准确率): of the points we placed, how many are in the RIGHT place?
 *
 * We have no human ground-truth, so accuracy uses a self-consistency proxy:
 * DLD stamps every transaction with an official `area_id`. All projects sharing
 * an area_id must cluster together. A project whose geocoded point sits far from
 * the ROBUST (median) centre of its area's other points is almost certainly a
 * bad geocode (e.g. Google matched a same-named building in another district).
 * Where we additionally have an official area polygon, we report the stricter
 * "inside the official boundary" accuracy too.
 *
 * Usage: npx ts-node scripts/eval-geocode-quality.ts [--suspects N] [--km 2]
 */
import 'dotenv/config'
import pool from '../src/db/pool'

const arg = (f: string, d: string) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d }
const KM = Number(arg('--km', '2'))
const SUSPECTS = Number(arg('--suspects', '15'))

async function q(sql: string, params: unknown[] = []) { return (await pool.query(sql, params)).rows }
const pctf = (a: number, b: number) => b ? `${((a / b) * 100).toFixed(1)}%` : 'n/a'

async function main() {
  // ── COVERAGE ────────────────────────────────────────────────────────────
  const [proj] = await q(`
    WITH keys AS (
      SELECT area_name, project_name, COUNT(*)::int tx
      FROM dld_transactions
      WHERE project_name IS NOT NULL AND project_name<>'' AND area_name IS NOT NULL AND area_name<>''
      GROUP BY 1,2 HAVING COUNT(*) >= 3)
    SELECT COUNT(*) total,
           COUNT(*) FILTER (WHERE l.geom IS NOT NULL) AS geocoded,
           COUNT(*) FILTER (WHERE l.source='failed') AS failed,
           COUNT(*) FILTER (WHERE l.area_name IS NULL) AS pending
    FROM keys k LEFT JOIN dld_project_locations l USING (area_name, project_name)`)

  const [txcov] = await q(`
    SELECT
      COUNT(*) AS all_sales,
      COUNT(*) FILTER (WHERE dt.project_name IS NOT NULL AND dt.project_name<>'') AS has_project,
      COUNT(*) FILTER (WHERE l.geom IS NOT NULL) AS placed
    FROM dld_transactions dt
    LEFT JOIN dld_project_locations l ON l.area_name=dt.area_name AND l.project_name=dt.project_name
    WHERE dt.trans_group='Sales' AND dt.property_usage='Residential'`)

  // ── ACCURACY (self-consistency vs area cluster) ──────────────────────────
  const [acc] = await q(`
    WITH pa AS (
      SELECT DISTINCT ON (area_name, project_name) area_name, project_name, area_id
      FROM (SELECT area_name, project_name, area_id, COUNT(*) c FROM dld_transactions
             WHERE area_id IS NOT NULL AND project_name IS NOT NULL AND project_name<>''
             GROUP BY 1,2,3) s
      ORDER BY area_name, project_name, c DESC),
    loc AS (
      SELECT l.area_name, l.project_name, l.geom, l.tx_count, pa.area_id
      FROM dld_project_locations l JOIN pa USING (area_name, project_name)
      WHERE l.geom IS NOT NULL),
    centre AS (   -- robust (median) centre per area_id
      SELECT area_id,
        ST_SetSRID(ST_MakePoint(
          percentile_cont(0.5) WITHIN GROUP (ORDER BY ST_X(geom::geometry)),
          percentile_cont(0.5) WITHIN GROUP (ORDER BY ST_Y(geom::geometry))),4326)::geography AS c,
        COUNT(*) n
      FROM loc WHERE area_id IS NOT NULL GROUP BY area_id),
    d AS (
      SELECT loc.*, ST_Distance(loc.geom, c.c) AS dist
      FROM loc JOIN centre c ON c.area_id=loc.area_id WHERE c.n >= 3)
    SELECT COUNT(*) projects,
           COUNT(*) FILTER (WHERE dist <= ${KM}*1000) AS within_n,
           SUM(tx_count) tx,
           SUM(tx_count) FILTER (WHERE dist <= ${KM}*1000) tx_within,
           ROUND(AVG(dist)) avg_m, ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY dist)) median_m
    FROM d`)

  // Stricter: inside the official boundary, where one exists for the area_id.
  const [bound] = await q(`
    WITH pa AS (
      SELECT DISTINCT ON (area_name, project_name) area_name, project_name, area_id
      FROM (SELECT area_name, project_name, area_id, COUNT(*) c FROM dld_transactions
             WHERE area_id IS NOT NULL AND project_name IS NOT NULL AND project_name<>''
             GROUP BY 1,2,3) s
      ORDER BY area_name, project_name, c DESC),
    loc AS (
      SELECT l.geom, pa.area_id
      FROM dld_project_locations l JOIN pa USING (area_name, project_name)
      WHERE l.geom IS NOT NULL),
    b AS (SELECT dla.area_id, da.boundary FROM dld_areas dla JOIN dubai_areas da ON da.id=dla.dubai_area_id
           WHERE dla.area_id < 900000 AND da.boundary IS NOT NULL)
    SELECT COUNT(*) checkable, COUNT(*) FILTER (WHERE ST_Covers(b.boundary, loc.geom)) inside
    FROM loc JOIN b ON b.area_id=loc.area_id`)

  // Worst offenders to re-geocode.
  const suspects = await q(`
    WITH pa AS (
      SELECT DISTINCT ON (area_name, project_name) area_name, project_name, area_id
      FROM (SELECT area_name, project_name, area_id, COUNT(*) c FROM dld_transactions
             WHERE area_id IS NOT NULL AND project_name IS NOT NULL AND project_name<>''
             GROUP BY 1,2,3) s
      ORDER BY area_name, project_name, c DESC),
    loc AS (
      SELECT l.area_name, l.project_name, l.geom, l.tx_count, pa.area_id
      FROM dld_project_locations l JOIN pa USING (area_name, project_name)
      WHERE l.geom IS NOT NULL),
    centre AS (
      SELECT area_id, ST_SetSRID(ST_MakePoint(
        percentile_cont(0.5) WITHIN GROUP (ORDER BY ST_X(geom::geometry)),
        percentile_cont(0.5) WITHIN GROUP (ORDER BY ST_Y(geom::geometry))),4326)::geography AS c,
        COUNT(*) n FROM loc WHERE area_id IS NOT NULL GROUP BY area_id)
    SELECT loc.area_name, loc.project_name, loc.tx_count,
           ROUND((ST_Distance(loc.geom, c.c)/1000.0)::numeric,1) AS km_off
    FROM loc JOIN centre c ON c.area_id=loc.area_id WHERE c.n>=3
    ORDER BY ST_Distance(loc.geom,c.c) DESC LIMIT ${SUSPECTS}`)

  console.log('\n══════════ GEOCODE QUALITY ══════════')
  console.log('\n── COVERAGE (匹配率) ──')
  console.log(`projects (≥3 tx): geocoded ${proj.geocoded}/${proj.total} = ${pctf(proj.geocoded, proj.total)}  (failed ${proj.failed}, pending ${proj.pending})`)
  console.log(`sales tx placed:  ${txcov.placed}/${txcov.all_sales} = ${pctf(txcov.placed, txcov.all_sales)} of ALL  |  ${pctf(txcov.placed, txcov.has_project)} of tx that have a project_name`)
  console.log(`  (tx without a project_name can't be project-geocoded: ${txcov.all_sales - txcov.has_project})`)
  console.log(`\n── ACCURACY (准确率) — within ${KM}km of area cluster centre ──`)
  console.log(`projects: ${acc.within_n}/${acc.projects} = ${pctf(acc.within_n, acc.projects)}   tx-weighted: ${acc.tx_within}/${acc.tx} = ${pctf(acc.tx_within, acc.tx)}`)
  console.log(`distance to centre: median ${acc.median_m}m, mean ${acc.avg_m}m`)
  if (bound) console.log(`strict (inside official boundary, where one exists): ${bound.inside}/${bound.checkable} = ${pctf(bound.inside, bound.checkable)}`)
  console.log(`\n── TOP ${SUSPECTS} SUSPECTS (re-geocode candidates) ──`)
  for (const s of suspects) console.log(`  ${s.km_off}km off · ${s.tx_count}tx · ${s.area_name} / ${s.project_name}`)
  console.log('')
  await pool.end()
}
main().catch(e => { console.error(e); process.exit(1) })
