/**
 * Refresh the derived materialized views after the daily data.dubai sync.
 * These precompute the expensive per-area aggregations (percentile over v_sales
 * 763k + v_rent 2.9M) so /api/dubai/areas and the find-home calculator are fast.
 * Order matters: net-yield first, then the invest summary that joins it.
 *
 *   cd backend && npx ts-node scripts/refresh-derived.ts
 *   # add to the daily sync, AFTER the sync step.
 */
import dotenv from 'dotenv'
dotenv.config()
import pool from '../src/db/pool'

const VIEWS = ['mv_area_net_yield', 'mv_area_invest_apt', 'mv_city_baseline'] // dependency order

/**
 * 🔴 **必须在刷 MV 之前跑,而且不能删。**
 *
 * v_rent 原来写的是 `COALESCE(r.dubai_area_id, dla.dubai_area_id)` —— 为了给 3% 没有
 * dubai_area_id 的行做 JOIN 兜底。代价是 **COALESCE 谓词匹配不上任何裸列索引**,
 * 于是按区域查租金要扫全迪拜近 2 年的租约(1268ms/次)。
 *
 * 2026-07-14 的修法是:**把那 3% 回填掉,然后从视图里删掉 COALESCE**(裸列 → 索引可用)。
 * 但每日 data.dubai 同步会插进新行,新行的 dubai_area_id 又可能是 NULL ——
 * **视图已经没有兜底了**,这些行会从区域查询里**静默消失**(不报错,就是少数据)。
 *
 * 所以回填必须每日跟着同步跑。**删掉这段 = 数据慢慢烂掉且没人发现。**
 */
async function backfillRentAreaIds(): Promise<void> {
  const t0 = process.hrtime.bigint()
  const r = await pool.query(
    `UPDATE dld_rent_contracts r
        SET dubai_area_id = dla.dubai_area_id
       FROM dld_areas dla
      WHERE dla.area_id = r.area_id
        AND r.dubai_area_id IS NULL
        AND dla.dubai_area_id IS NOT NULL`
  )
  const ms = Number((process.hrtime.bigint() - t0) / 1000000n)
  console.log(`✓ backfilled dld_rent_contracts.dubai_area_id: ${r.rowCount} rows (${ms}ms)`)
}

async function main(): Promise<void> {
  await backfillRentAreaIds()   // 必须先于 MV —— mv_area_net_yield 读的就是 v_rent

  for (const v of VIEWS) {
    const t0 = process.hrtime.bigint()
    try {
      await pool.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${v}`)
    } catch (e: any) {
      // CONCURRENTLY needs a unique index + an existing populated matview; fall back.
      console.warn(`  ${v}: concurrent refresh failed (${e.message}); plain refresh`)
      await pool.query(`REFRESH MATERIALIZED VIEW ${v}`)
    }
    const ms = Number((process.hrtime.bigint() - t0) / 1000000n)
    console.log(`✓ refreshed ${v} (${ms}ms)`)
  }
  await pool.end()
}
main().catch((e) => { console.error(e?.message ?? e); process.exit(1) })
