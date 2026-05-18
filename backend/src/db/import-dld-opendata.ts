/**
 * 导入 dubailand 开放数据导出的 transactions CSV（无 VPN 路线）。
 *
 * 该 CSV 列格式与 Dubai Pulse 批量 CSV 不同，需要适配：
 *  - 列名映射 → dld_transactions
 *  - GROUP_EN 'Mortgage'→'Mortgages'；PROCEDURE_EN 'Sale'→'Sell'（与既有数据/分析口径一致）
 *  - meter_sale_price = TRANS_VALUE / PROCEDURE_AREA（源无此列，确定性推导）
 *  - AREA_EN 无 area_id：精确匹配 dld_areas.area_name，未中则用 area-matcher
 *    模糊解析到 dubai_areas 再桥接回一个 dld_areas.area_id（指标 join 不变）
 *  - 新增列 is_offplan / is_freehold / actual_area（dubailand 多带的高价值字段）
 *
 * 去重：删除 instance_date >= 文件最早日 的现有行，再整段插入（幂等，重跑同文件结果一致；
 *       ≤ 文件范围之前的历史 bulk 数据不动）。
 *
 * 用法：npx ts-node src/db/import-dld-opendata.ts "C:\path\transactions.csv"
 */
import pool from './pool'
import * as fs from 'fs'
import { parse } from 'csv-parse'
import { findAreaByName } from '../services/area-matcher'

function parseDate(s: string): string | null {
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10)
  const m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}
function num(v: string): number | null {
  if (v == null || v === '' || v === 'null') return null
  const n = parseFloat(String(v).replace(/,/g, ''))
  return isNaN(n) ? null : n
}
function norm(s: string): string {
  return (s || '').toString().trim()
}

// AREA_EN → dld_areas.area_id 解析（带缓存）
const areaCache = new Map<string, number | null>()
async function resolveAreaId(areaEn: string): Promise<number | null> {
  const key = areaEn.trim().toUpperCase()
  if (!key) return null
  if (areaCache.has(key)) return areaCache.get(key)!

  // 1) 精确(忽略大小写/空白)
  let r = await pool.query(
    `SELECT area_id FROM dld_areas WHERE UPPER(TRIM(area_name)) = $1 LIMIT 1`, [key])
  if (r.rowCount) { areaCache.set(key, r.rows[0].area_id); return r.rows[0].area_id }

  // 2) 去非字母数字后再精确
  r = await pool.query(
    `SELECT area_id FROM dld_areas
      WHERE regexp_replace(UPPER(area_name),'[^A-Z0-9]','','g') = regexp_replace($1,'[^A-Z0-9]','','g')
      LIMIT 1`, [key])
  if (r.rowCount) { areaCache.set(key, r.rows[0].area_id); return r.rows[0].area_id }

  // 3) area-matcher 模糊 → dubai_areas → 桥接回 dld_areas.area_id
  try {
    const da = await findAreaByName(pool, areaEn)
    if (da && da.id) {
      const b = await pool.query(
        `SELECT area_id FROM dld_areas WHERE dubai_area_id = $1 AND area_id IS NOT NULL LIMIT 1`,
        [da.id])
      if (b.rowCount) { areaCache.set(key, b.rows[0].area_id); return b.rows[0].area_id }
    }
  } catch { /* ignore matcher errors */ }

  areaCache.set(key, null)
  return null
}

async function main() {
  const csvPath = process.argv[2]
  if (!csvPath || !fs.existsSync(csvPath)) {
    console.error('用法: npx ts-node src/db/import-dld-opendata.ts <csv 路径>')
    process.exit(1)
  }
  console.log(`📥 读取 ${csvPath}`)

  // 0) schema 扩展（幂等）
  await pool.query(`
    ALTER TABLE dld_transactions
      ADD COLUMN IF NOT EXISTS is_offplan  BOOLEAN,
      ADD COLUMN IF NOT EXISTS is_freehold BOOLEAN,
      ADD COLUMN IF NOT EXISTS actual_area NUMERIC
  `)
  // transaction_id 的 UNIQUE 约束对真实「一交易多单元」DLD 数据是错误假设
  // （TRANSACTION_NUMBER 是交易组号会合法重复；行标识用 serial id 主键）。移除之。
  await pool.query(
    `ALTER TABLE dld_transactions DROP CONSTRAINT IF EXISTS dld_transactions_transaction_id_key`)

  // 1) 解析全部行
  type Row = any[]
  const rows: Row[] = []
  const distinctAreas = new Set<string>()
  let minDate = '9999-99-99'
  let skipped = 0

  const parser = fs.createReadStream(csvPath).pipe(parse({
    columns: true, skip_empty_lines: true, trim: true, bom: true, relax_quotes: true,
    relax_column_count: true
  }))

  for await (const rec of parser as AsyncIterable<Record<string, string>>) {
    const date = parseDate(norm(rec.INSTANCE_DATE))
    const txnId = norm(rec.TRANSACTION_NUMBER)
    if (!date || !txnId) { skipped++; continue }
    if (date < minDate) minDate = date

    const areaEn = norm(rec.AREA_EN)
    distinctAreas.add(areaEn.toUpperCase())

    let grp = norm(rec.GROUP_EN)
    if (grp === 'Mortgage') grp = 'Mortgages'
    let proc = norm(rec.PROCEDURE_EN)
    if (proc === 'Sale') proc = 'Sell'

    const tv = num(rec.TRANS_VALUE)
    const pa = num(rec.PROCEDURE_AREA)
    const mps = (tv != null && pa != null && pa > 0) ? tv / pa : null
    const parking = norm(rec.PARKING)

    rows.push([
      txnId, grp, proc, date,
      norm(rec.PROP_TYPE_EN) || null, norm(rec.PROP_SB_TYPE_EN) || null, norm(rec.USAGE_EN) || null,
      areaEn || null,                          // area_id 稍后解析填充（占位）
      areaEn || null,                          // area_name
      null,                                    // building_name（dubailand 无楼栋名）
      norm(rec.PROJECT_EN) || null, norm(rec.MASTER_PROJECT_EN) || null,
      norm(rec.NEAREST_LANDMARK_EN) || null, norm(rec.NEAREST_METRO_EN) || null, norm(rec.NEAREST_MALL_EN) || null,
      norm(rec.ROOMS_EN) || null,
      parking !== '' && parking !== '0',        // has_parking
      pa, tv, mps, null, null,                  // procedure_area, actual_worth, meter_sale_price, rent_value, meter_rent_price
      norm(rec.IS_OFFPLAN_EN).toUpperCase() === 'OFF-PLAN',
      norm(rec.IS_FREE_HOLD_EN).toUpperCase() === 'FREE HOLD',
      num(rec.ACTUAL_AREA)
    ])
  }
  console.log(`  解析 ${rows.length} 行（跳过无效 ${skipped}），日期范围最早 = ${minDate}`)
  console.log(`  distinct 区域名 ${distinctAreas.size} 个，解析 area_id 中…`)

  // 2) 解析 area_id（缓存，仅 distinct 次 DB 调用）
  let matched = 0
  const unresolved: string[] = []
  for (const a of distinctAreas) {
    const id = await resolveAreaId(a)
    if (id != null) matched++; else unresolved.push(a)
  }
  // 回填每行 area_id（rows[i][7] 当前是 areaEn 占位）
  for (const r of rows) {
    const a = (r[7] || '').toString().toUpperCase()
    r[7] = a ? (areaCache.get(a) ?? null) : null
  }
  const cov = distinctAreas.size ? Math.round(matched / distinctAreas.size * 100) : 0
  console.log(`  区域匹配覆盖: ${matched}/${distinctAreas.size} (${cov}%)`)

  // 3) 事务：窗口删 + 批量插
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const del = await client.query(
      `DELETE FROM dld_transactions WHERE instance_date >= $1`, [minDate])
    console.log(`  删除 instance_date >= ${minDate} 的旧行: ${del.rowCount}`)

    const cols = `transaction_id,trans_group,procedure_name,instance_date,property_type,property_sub_type,property_usage,area_id,area_name,building_name,project_name,master_project,nearest_landmark,nearest_metro,nearest_mall,rooms,has_parking,procedure_area,actual_worth,meter_sale_price,rent_value,meter_rent_price,is_offplan,is_freehold,actual_area`
    const NCOL = 25
    const BATCH = 500
    let ins = 0
    for (let i = 0; i < rows.length; i += BATCH) {
      const slice = rows.slice(i, i + BATCH)
      const vals: any[] = []
      const ph = slice.map((r, j) => {
        const base = j * NCOL
        vals.push(...r)
        return '(' + Array.from({ length: NCOL }, (_, k) => `$${base + k + 1}`).join(',') + ')'
      }).join(',')
      await client.query(`INSERT INTO dld_transactions (${cols}) VALUES ${ph}`, vals)
      ins += slice.length
      if (ins % 10000 < BATCH) process.stdout.write(`\r  插入 ${ins}/${rows.length}`)
    }
    process.stdout.write(`\r  插入 ${ins}/${rows.length}\n`)
    await client.query('COMMIT')
    console.log('  ✅ 事务提交')
  } catch (e) {
    await client.query('ROLLBACK')
    console.error('  ❌ 失败，已回滚:', e)
    process.exit(1)
  } finally {
    client.release()
  }

  // 4) 重算指标（受影响年份 + rolling）
  console.log('  重算指标…')
  const years = new Set<number>()
  years.add(new Date(minDate).getFullYear())
  years.add(new Date().getFullYear())
  for (const y of years) {
    await pool.query('SELECT calculate_area_yearly_metrics($1)', [y]).catch(e => console.warn('yearly', y, e.message))
  }
  await pool.query('SELECT calculate_area_rolling_metrics(CURRENT_DATE)').catch(e => console.warn('rolling', e.message))

  console.log('\n=== 完成 ===')
  console.log(`插入 ${rows.length} 行；区域匹配 ${cov}%`)
  if (unresolved.length) {
    console.log(`未匹配区域(${unresolved.length}) 样例: ${unresolved.slice(0, 20).join(' | ')}`)
  }
  const chk = await pool.query(
    `SELECT MIN(instance_date) mn, MAX(instance_date) mx, COUNT(*) n
       FROM dld_transactions WHERE trans_group='Sales' AND property_usage='Residential'`)
  console.log('Sales/Residential 现状:', chk.rows[0])
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
