/**
 * Data-freshness watchdog for the daily data.dubai load.
 *
 * The production tables are refreshed by a rebuild+swap flow that doesn't write
 * the sync_runs audit table, so "did today's load run?" had no signal. This checks
 * the RESULT (max load_timestamp per core table) instead of the process — robust
 * to HOW the data is loaded. Exits 1 if anything is stale so cron mail / a monitor
 * picks it up.
 *
 *   cd backend && npx ts-node scripts/check-dubai-freshness.ts
 *   # cron (hourly), anywhere that can reach the DB:
 *   #   0 * * * * /path/to/backend/scripts/run-freshness.sh
 */
import dotenv from 'dotenv'
dotenv.config()
import pool from '../src/db/pool'

// max_age_hours: alert if max(load_timestamp) is older than this.
// Thresholds match each dataset's real publish cadence on data.dubai:
//  - transactions advance daily → 36h catches a missed day.
//  - rent (Ejari) publishes in BATCHES every few days, not daily (confirmed
//    2026-06-22: source had nothing newer than our 58h-old data) → 120h so we
//    only alert on a genuinely stuck feed, not the normal batch gap.
const CHECKS: { table: string; col: string; maxAgeHours: number }[] = [
  { table: 'dld_transactions', col: 'load_timestamp', maxAgeHours: 36 },
  { table: 'dld_rent_contracts', col: 'load_timestamp', maxAgeHours: 120 },
]

async function main(): Promise<void> {
  let stale = false
  for (const c of CHECKS) {
    const r = await pool.query(
      `SELECT max(${c.col}) AS latest, EXTRACT(EPOCH FROM (now() - max(${c.col})))/3600 AS age_h FROM ${c.table}`
    )
    const latest = r.rows[0]?.latest
    const ageH = r.rows[0]?.age_h != null ? Number(r.rows[0].age_h) : null
    if (latest == null || ageH == null) {
      console.error(`STALE: ${c.table} has no load_timestamp data`)
      stale = true
      continue
    }
    const tag = ageH > c.maxAgeHours ? 'STALE' : 'ok'
    const line = `${tag}: ${c.table} latest=${new Date(latest).toISOString()} age=${ageH.toFixed(1)}h (limit ${c.maxAgeHours}h)`
    if (ageH > c.maxAgeHours) { console.error(line); stale = true } else { console.log(line) }
  }
  // 陈旧了要分清是谁的锅 —— 老版无论如何都喊 "the daily sync did not run",
  // 而 2026-07-14 那次同步明明跑了、是 DLD 源头停发,照着这句去查会一路查错方向。
  // market_cache.updated_at = daily 跑到最后一步(precompute)的时间 = 我们跑完了的心跳。
  if (stale) {
    const { rows } = await pool.query(
      `SELECT EXTRACT(EPOCH FROM (now() - max(updated_at)))/3600 AS age_h FROM market_cache`
    )
    const syncAgeH = rows[0]?.age_h != null ? Number(rows[0].age_h) : null
    await pool.end()
    if (syncAgeH != null && syncAgeH <= 36) {
      console.error(
        `\n⚠️ 数据陈旧,但**同步是好的**(${syncAgeH.toFixed(1)}h 前刚跑完一轮)。` +
        `\n   → 是 DLD 源头停发了,不是我们的锅。改代码没用,等它恢复。`
      )
    } else {
      console.error(
        `\n❌ 数据陈旧,且**同步本身也没跑完**(market_cache 已 ${syncAgeH?.toFixed(1) ?? '?'}h 未更新)。` +
        `\n   → 这是我们的锅。去盒子看:` +
        `\n   ssh -i ~/.ssh/dubai_proxy root@38.54.8.9 "systemctl status dubai-daily.service; tail -40 /opt/dubai-sync/daily.log"`
      )
    }
    process.exit(1)
  }
  await pool.end()
  console.log('\n✅ Dubai data is fresh.')
}
main().catch((e) => { console.error(e?.message ?? e); process.exit(1) })
