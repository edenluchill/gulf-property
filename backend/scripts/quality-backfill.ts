/**
 * 质检回填 —— 把规则跑在**已经存在的生产数据**上。
 *
 * 为什么重要:新规则只对"以后生成的"生效,那要等好几天才知道现状。
 * 但我们手上已经有几十场真实 tour / 对话 / 楼书解析躺在库里 ——
 * **现在就能算出质量基线**,而且直接指出哪些是烂的。
 *
 * 用法:
 *   npx ts-node -T scripts/quality-backfill.ts            # 全部
 *   npx ts-node -T scripts/quality-backfill.ts luna_tour  # 只回填一种
 */
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(__dirname, '../.env') })

import pool from '../src/db/pool'
import { runAudit } from '../src/quality'
import { TOUR_RULES } from '../src/quality/tour-rules'
import { PDF_RULES } from '../src/quality/pdf-rules'
import { LUNA_RULES, type LunaSession } from '../src/quality/luna-rules'

const only = process.argv[2]

async function backfillTours() {
  const { rows } = await pool.query(
    `SELECT s.share_code, t.script,
            (SELECT json_agg(json_build_object('id', p.project_id, 'units', 0))
               FROM lt_session_properties p WHERE p.session_id = s.id) AS props
       FROM lt_demo_sessions s
       JOIN lt_tour_scripts t ON t.session_id = s.id
      ORDER BY s.created_at DESC LIMIT 100`
  )
  console.log(`\n🎬 Luna Tour:回填 ${rows.length} 场`)
  for (const r of rows) {
    const script = typeof r.script === 'string' ? JSON.parse(r.script) : r.script
    // 注意:回填时拿不到"每个项目实际有几个户型"(那是生成时的上下文),
    // 所以跳过依赖它的规则 —— 宁可少判,不可误判。
    await runAudit('luna_tour', r.share_code, script, TOUR_RULES.filter(
      (x) => x.id !== 'homes_beat_present' && x.id !== 'acts_match_projects'
    ), { backfill: true })
  }
}

async function backfillPdf() {
  const { rows } = await pool.query(
    `SELECT job_id, result_data AS result FROM pdf_processing_tasks
      WHERE status = 'completed' AND result_data IS NOT NULL
      ORDER BY created_at DESC LIMIT 100`
  )
  console.log(`\n📄 楼书抽取:回填 ${rows.length} 个 job`)
  for (const r of rows) {
    const res = typeof r.result === 'string' ? JSON.parse(r.result) : r.result
    const building = res?.buildingData || res
    if (!building) continue
    await runAudit('pdf_extract', r.job_id, building, PDF_RULES, {
      totalPages: res?.totalPages ?? 0, backfill: true,
    })
  }
}

async function backfillLuna() {
  const { rows } = await pool.query(
    `SELECT session_id, transcript, turn_count, tool_call_count, duration_ms
       FROM luna_sessions
      WHERE transcript IS NOT NULL AND transcript::text <> '{}'
      ORDER BY started_at DESC LIMIT 200`
  )
  console.log(`\n🎙️  Luna 对话:回填 ${rows.length} 场`)
  for (const r of rows) {
    const t = (typeof r.transcript === 'string' ? JSON.parse(r.transcript) : r.transcript) as LunaSession
    await runAudit('luna_session', r.session_id, t, LUNA_RULES, {
      turns: r.turn_count, toolCalls: r.tool_call_count, durationMs: r.duration_ms, backfill: true,
    })
  }
}

async function report() {
  const { rows } = await pool.query<{
    feature: string; n: string; avg: string; crit: string; worst: string
  }>(
    `SELECT feature, COUNT(*)::bigint AS n, ROUND(AVG(score))::text AS avg,
            COUNT(*) FILTER (WHERE issues @> '[{"severity":"critical"}]')::bigint AS crit,
            MIN(score)::text AS worst
       FROM quality_samples WHERE meta->>'backfill' = 'true'
      GROUP BY feature ORDER BY 3`
  )
  console.log(`\n${'─'.repeat(70)}\n质量基线(跑在真实生产数据上):\n`)
  for (const r of rows) {
    console.log(`  ${r.feature.padEnd(14)} 平均 ${String(r.avg).padStart(3)} 分 · ` +
      `${r.n} 个样本 · ${r.crit} 个有严重问题 · 最差 ${r.worst} 分`)
  }

  console.log(`\n最该改的缺陷(失败次数 × 严重度):\n`)
  const { rows: top } = await pool.query<{
    feature: string; rule: string; severity: string; fails: string; example: string
  }>(
    `SELECT s.feature, i->>'rule' AS rule, i->>'severity' AS severity,
            COUNT(*)::bigint AS fails,
            (ARRAY_AGG(i->>'detail' ORDER BY s.created_at DESC))[1] AS example
       FROM quality_samples s CROSS JOIN LATERAL jsonb_array_elements(s.issues) AS i
      WHERE s.meta->>'backfill' = 'true'
      GROUP BY 1,2,3
      ORDER BY (CASE i->>'severity' WHEN 'critical' THEN 5 WHEN 'major' THEN 2 ELSE 1 END) * COUNT(*) DESC
      LIMIT 12`
  )
  for (const t of top) {
    const mark = t.severity === 'critical' ? '🔴' : t.severity === 'major' ? '🟠' : '⚪'
    console.log(`  ${mark} ${t.feature}/${t.rule}  ×${t.fails}`)
    console.log(`     ${String(t.example).slice(0, 100)}`)
  }
}

async function run() {
  if (!only || only === 'luna_tour') await backfillTours()
  if (!only || only === 'pdf_extract') await backfillPdf()
  if (!only || only === 'luna_session') await backfillLuna()
  await report()
  await pool.end()
}

run().catch(async (e) => { console.error('💥', e); await pool.end(); process.exit(1) })
