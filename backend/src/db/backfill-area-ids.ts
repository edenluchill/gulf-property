/**
 * 一次性回填：用改进的共享 resolver 给「已导入但 area_id 为空」的行补 area_id，
 * 然后重算指标。无需重导整个 CSV。
 * 用法：npx ts-node src/db/backfill-area-ids.ts
 */
import pool from './pool'
import { buildAreaResolver } from './area-resolver'

async function main() {
  const resolve = buildAreaResolver(pool)

  const distinct = await pool.query(
    `SELECT UPPER(TRIM(area_name)) AS name, COUNT(*) n
       FROM dld_transactions
      WHERE area_id IS NULL AND area_name IS NOT NULL AND area_name <> ''
      GROUP BY 1 ORDER BY n DESC`)
  console.log(`待回填 distinct 区域名: ${distinct.rowCount}`)

  let fixedNames = 0, fixedRows = 0
  const stillNull: string[] = []
  for (const row of distinct.rows) {
    const id = await resolve(row.name)
    if (id == null) { stillNull.push(`${row.name}(${row.n})`); continue }
    const upd = await pool.query(
      `UPDATE dld_transactions SET area_id = $1
        WHERE area_id IS NULL AND UPPER(TRIM(area_name)) = $2`, [id, row.name])
    fixedNames++; fixedRows += upd.rowCount || 0
    process.stdout.write(`\r  已回填 ${fixedNames} 区域 / ${fixedRows} 行`)
  }
  console.log(`\n回填完成: ${fixedNames} 个区域名, ${fixedRows} 行`)
  if (stillNull.length) console.log(`仍未匹配(${stillNull.length}): ${stillNull.slice(0, 30).join(' | ')}`)

  console.log('重算指标…')
  await pool.query('SELECT calculate_area_yearly_metrics(2026)').catch(e => console.warn('y2026', e.message))
  await pool.query('SELECT calculate_area_yearly_metrics(2025)').catch(e => console.warn('y2025', e.message))
  await pool.query('SELECT calculate_area_rolling_metrics(CURRENT_DATE)').catch(e => console.warn('rolling', e.message))

  const chk = await pool.query(
    `SELECT COUNT(*) tot, COUNT(*) FILTER(WHERE area_id IS NULL) nul,
            round(100.0*COUNT(*) FILTER(WHERE area_id IS NULL)/COUNT(*),1) pct_null
       FROM dld_transactions WHERE instance_date >= '2026-01-01'`)
  console.log('2026 窗口 area_id 缺失:', chk.rows[0])
  const m = await pool.query(
    `SELECT COUNT(*) n, COUNT(median_unit_price) mu FROM get_dubai_area_metrics()`)
  console.log('get_dubai_area_metrics:', m.rows[0])
  process.exit(0)
}
main().catch(e => { console.error(e); process.exit(1) })
