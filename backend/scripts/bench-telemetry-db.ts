/**
 * 遥测的**存储和读取**会不会拖累业务? —— 实测,不估算。
 *
 * 遥测跑在**同一个生产库**上,所以它自己的写入和查询都可能:
 *   · 占用连接池(把业务请求挤到排队)
 *   · 被算成"慢查询"把告警刷屏(已包 beginMaintenance,但要验证)
 *   · 表长大后查询变慢(90 天保留期 × 每分钟几十行)
 *
 * 四个地方要量:
 *   ① flush 写入(每 60s 一次批量 INSERT)
 *   ② worker 的队列 gauge(**每 5 秒查一次 DB** —— 最容易出事的)
 *   ③ Admin 的读取(diagnose / ops 的 jsonb 聚合,可能很慢)
 *   ④ 表增长速度 → 90 天后还查得动吗
 *
 * 用法:cd backend && npx ts-node -T scripts/bench-telemetry-db.ts
 */
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(__dirname, '../.env') })

import pool from '../src/db/pool'

const SLOW_MS = 500   // perfSink 的慢查询阈值 —— 超过这个数就会被算成慢查询

async function time(label: string, sql: string, params: unknown[] = []): Promise<number> {
  const t0 = Date.now()
  const r = await pool.query(sql, params)
  const ms = Date.now() - t0
  const mark = ms >= SLOW_MS ? '🔴' : ms >= 100 ? '🟠' : '✅'
  console.log(`  ${mark} ${label.padEnd(46)} ${String(ms).padStart(5)}ms  (${r.rowCount ?? 0} 行)`)
  return ms
}

async function run() {
  console.log(`\n慢查询阈值 = ${SLOW_MS}ms(超过就会被 perfSink 算成慢查询)\n`)

  console.log('① 写入 —— flush 每 60s 一次批量 INSERT')
  // 模拟一次真实 flush(约 40 条 series)
  const vals: unknown[] = []
  const tuples = Array.from({ length: 40 }, (_, i) => {
    const b = i * 4
    vals.push(`bench.metric.${i}`, '{}', 'counter', i)
    return `(date_trunc('minute', now()) - interval '999 days', $${b + 1}, $${b + 2}::jsonb, $${b + 3}, $${b + 4})`
  })
  await time('批量插 40 条 series',
    `INSERT INTO metrics_minute (minute, name, labels, kind, count) VALUES ${tuples.join(',')}
     ON CONFLICT (minute, name, labels) DO UPDATE SET count = EXCLUDED.count`, vals)

  console.log('\n② worker 的队列 gauge —— **每 5 秒查一次**(最高频的遥测查询)')
  await time('队列深度/卡死(pdf_processing_tasks 聚合)',
    `SELECT COUNT(*) FILTER (WHERE status = 'pending') AS pending,
            COUNT(*) FILTER (WHERE status = 'processing') AS processing,
            COALESCE(EXTRACT(EPOCH FROM (now() - MIN(created_at) FILTER (WHERE status = 'pending'))), 0) AS oldest,
            COUNT(*) FILTER (WHERE status = 'processing' AND updated_at < now() - interval '20 minutes') AS stuck
       FROM pdf_processing_tasks`)

  console.log('\n③ Admin 读取 —— 只在 owner 打开 dashboard 时跑')
  await time('metricSeries(单指标 180 分钟曲线)',
    `SELECT minute, kind, count, value FROM metrics_minute
      WHERE name = 'runtime.cpu.pct' AND minute > now() - interval '180 minutes' ORDER BY minute`)
  await time('AI 成本(按 task 聚合 24h)',
    `SELECT labels->>'task', SUM(count) FROM metrics_minute
      WHERE name IN ('ai.call','ai.cost.usd_micro') AND minute > now() - interval '24 hours'
      GROUP BY 1`)
  await time('质量诊断:规则失败排行(jsonb 展开)',
    `SELECT i->>'rule', COUNT(*) FROM quality_samples s
       CROSS JOIN LATERAL jsonb_array_elements(s.issues) AS i
      WHERE s.feature = 'luna_session' AND s.created_at > now() - interval '7 days'
      GROUP BY 1`)
  await time('质量诊断:最差样本',
    `SELECT ref_id, score, issues FROM quality_samples
      WHERE feature = 'pdf_extract' AND created_at > now() - interval '7 days'
      ORDER BY score ASC LIMIT 20`)

  console.log('\n④ 增长速度')
  const { rows: g } = await pool.query<{ per_min: string; total: string }>(
    `SELECT ROUND(AVG(n))::text AS per_min, (SELECT COUNT(*) FROM metrics_minute)::text AS total
       FROM (SELECT minute, COUNT(*) AS n FROM metrics_minute
              WHERE minute > now() - interval '30 minutes' GROUP BY minute) x`
  )
  const perMin = Number(g[0]?.per_min || 0)
  const days90 = perMin * 60 * 24 * 90
  console.log(`  每分钟写入 ${perMin} 行 · 当前 ${g[0]?.total} 行`)
  console.log(`  90 天保留期 → 约 ${(days90 / 1e6).toFixed(2)}M 行(${(days90 * 0.3 / 1e6).toFixed(0)}MB 上下)`)

  // 清理 bench 数据
  await pool.query(`DELETE FROM metrics_minute WHERE name LIKE 'bench.metric.%'`)

  console.log(`\n判读:`)
  console.log(`  · **worker 每 5 秒那个查询是最大的风险** —— 它最高频。>100ms 就该加缓存/索引。`)
  console.log(`  · Admin 的查询只在 owner 打开 dashboard 时跑,慢一点无所谓(但别超 1 秒)。`)
  console.log(`  · flush 的 INSERT 已经包了 beginMaintenance,不会被算成慢查询刷屏告警。\n`)

  await pool.end()
}

run().catch(async (e) => { console.error('💥', e); await pool.end(); process.exit(1) })
