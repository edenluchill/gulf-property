/**
 * One-off: export a full area-data audit to docs/reports/. Lists every visible
 * dubai_area with its current rolling-metrics (residential) + bridge status, so
 * we can see exactly which areas have full / partial / no data and why.
 *   cd backend && npx ts-node scripts/export-area-audit.ts
 */
import dotenv from 'dotenv'
dotenv.config()
import pool from '../src/db/pool'
import * as fs from 'fs'
import * as path from 'path'

const dash = (v: any, suffix = '') => (v == null ? '—' : `${v}${suffix}`)

async function main() {
  const period = (await pool.query(
    "SELECT to_char(MAX(period_end_month),'YYYY-MM-DD') AS p FROM dubai_area_rolling_metrics"
  )).rows[0].p

  const rows = (await pool.query(`
    SELECT da.name,
           m.sales_transaction_count AS tx,
           ROUND(m.median_price_sqm)::int AS price_sqm,
           m.price_growth_pct AS growth,
           m.rental_yield_pct AS yield,
           (SELECT COUNT(*) FROM dld_areas dla WHERE dla.dubai_area_id = da.id) AS bridges,
           (SELECT COALESCE(SUM(dla.transaction_count),0) FROM dld_areas dla WHERE dla.dubai_area_id = da.id) AS bridged_tx
      FROM dubai_areas da
      LEFT JOIN dubai_area_rolling_metrics m
        ON m.dubai_area_id = da.id
       AND m.period_end_month = (SELECT MAX(period_end_month) FROM dubai_area_rolling_metrics)
     WHERE da.visible
     ORDER BY COALESCE(m.sales_transaction_count, 0) DESC, da.name
  `)).rows

  const orphans = (await pool.query(`
    SELECT area_name, transaction_count AS tx
      FROM dld_areas
     WHERE dubai_area_id IS NULL AND COALESCE(transaction_count,0) > 0
     ORDER BY transaction_count DESC
  `)).rows

  const full = rows.filter((r) => r.tx != null && r.price_sqm != null && r.growth != null && r.yield != null)
  const partial = rows.filter((r) => (r.tx != null || r.price_sqm != null) && !(r.tx != null && r.price_sqm != null && r.growth != null && r.yield != null))
  const empty = rows.filter((r) => r.tx == null && r.price_sqm == null)

  const tbl = (rs: any[]) =>
    ['| 区域 | 成交量(12m) | 中位价/m² | 资本增长 | 租金收益 | 桥接DLD区数 | 桥接区总成交 |',
     '|------|------------|-----------|---------|---------|-----------|-------------|',
     ...rs.map((r) => `| ${r.name} | ${dash(r.tx)} | ${dash(r.price_sqm)} | ${dash(r.growth, '%')} | ${dash(r.yield, '%')} | ${r.bridges} | ${r.bridged_tx} |`)
    ].join('\n')

  const md = `# 区域数据审计 (Area Data Audit)

> 生成:${period} 快照 · 共 ${rows.length} 个可见区
> 数据源:dld_transactions(住宅 Sales: property_usage='Residential', property_type IN ('Unit','Villa'), meter_sale_price 1000-250000)+ dld_rent_contracts,经 dld_areas 桥接到 dubai_areas。

## 摘要

| 状态 | 区数 | 说明 |
|------|------|------|
| **四项全有**(价/量/增长/收益) | ${full.length} | 有可靠住宅市场数据 |
| **部分有**(有价或量,缺增长/收益) | ${partial.length} | 成交稀疏,增长/收益算不出(<20笔护栏) |
| **完全空**(显示"—") | ${empty.length} | 无住宅成交:见下三类原因 |
| 合计可见区 | ${rows.length} | |

**完全空的三类原因:**
- 🅰 **真·非住宅**:机场 / 工业区 / Labor camp / DMCC / DIFC / Science Park(纯商业,无住宅成交,正确)。
- 🅱 **营销/楼盘名**:DLD 无此地籍区(如 Acres by meraas、Azizi Rivera、Cherry wood),数据不存在,接不上。
- 🅲 **真住宅但 DLD 用了不同地籍名**:数据存在但名字对不上(如 Arabian Ranches=Wadi Al Safa),需手动映射。见文末"未桥接 DLD 地籍区"。

---

## 1. 全部可见区(按成交量降序)

${tbl(rows)}

---

## 2. 未桥接的 DLD 地籍区(数据存在但没接到任何展示区 —— 需手动映射或手画)

共 ${orphans.length} 个,合计 ${orphans.reduce((s, o) => s + Number(o.tx), 0).toLocaleString()} 笔成交孤立。

| DLD 地籍区 | 成交量 |
|-----------|--------|
${orphans.map((o) => `| ${o.area_name} | ${Number(o.tx).toLocaleString()} |`).join('\n')}

---

## 3. 用到的 SQL 查询

### 每个可见区的指标 + 桥接状态(本报告主表)
\`\`\`sql
SELECT da.name,
       m.sales_transaction_count AS tx,
       ROUND(m.median_price_sqm)::int AS price_sqm,
       m.price_growth_pct AS growth,
       m.rental_yield_pct AS yield,
       (SELECT COUNT(*) FROM dld_areas dla WHERE dla.dubai_area_id = da.id) AS bridges,
       (SELECT COALESCE(SUM(dla.transaction_count),0) FROM dld_areas dla WHERE dla.dubai_area_id = da.id) AS bridged_tx
  FROM dubai_areas da
  LEFT JOIN dubai_area_rolling_metrics m
    ON m.dubai_area_id = da.id
   AND m.period_end_month = (SELECT MAX(period_end_month) FROM dubai_area_rolling_metrics)
 WHERE da.visible
 ORDER BY COALESCE(m.sales_transaction_count, 0) DESC, da.name;
\`\`\`

### 未桥接的 DLD 地籍区(孤立数据)
\`\`\`sql
SELECT area_name, transaction_count
  FROM dld_areas
 WHERE dubai_area_id IS NULL AND COALESCE(transaction_count,0) > 0
 ORDER BY transaction_count DESC;
\`\`\`

### 某个区为什么空 / 稀疏(以 Al Barsha South 1 为例)
\`\`\`sql
-- 它有没有桥接、桥接的 area_id 有没有住宅成交
SELECT da.id, da.name,
       (SELECT COUNT(*) FROM dld_areas dla WHERE dla.dubai_area_id = da.id) AS bridges,
       (SELECT COUNT(*) FROM dld_transactions dt
          JOIN dld_areas dla ON dla.area_id = dt.area_id
         WHERE dla.dubai_area_id = da.id
           AND dt.trans_group='Sales' AND dt.property_usage='Residential'
           AND dt.property_type IN ('Unit','Villa')
           AND dt.instance_date > NOW() - INTERVAL '12 months') AS residential_sales_12m
  FROM dubai_areas da WHERE da.name = 'Al Barsha South 1';
\`\`\`

### 重算指标(改了过滤/桥接后跑)
\`\`\`sql
DELETE FROM dubai_area_rolling_metrics WHERE period_end_month = DATE_TRUNC('month', CURRENT_DATE);
SELECT calculate_area_rolling_metrics(CURRENT_DATE);
\`\`\`
`

  const outDir = path.resolve(__dirname, '../../docs/reports')
  fs.mkdirSync(outDir, { recursive: true })
  const file = path.join(outDir, `${period}-area-data-audit.md`)
  fs.writeFileSync(file, md, 'utf8')
  console.log(`written: ${file}`)
  console.log(`full=${full.length} partial=${partial.length} empty=${empty.length} orphans=${orphans.length}`)
  await pool.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
