/**
 * 样板客户分析报告 (share_code = 'demo') —— 公开可看,不用登录、不花积分。
 *
 * 为什么要它:**经纪不知道这功能能产出什么,就不敢花 20 积分去试。**
 * 同 Luna demo 的思路 —— 先看到效果,再决定为自己的客户生成一份。
 * 报告页顶部的「看一份样板 →」就链到 /cr/demo。
 *
 * 用**真实项目 + 真实 DLD 数据 + 一个虚构客户**(陈先生一家四口)跑完整管线,
 * 所以样板里的两层论证是**真的 AI 写的**,不是假数据。
 *
 * 跑:  cd backend && npx ts-node -T scripts/seed-demo-client-report.ts
 */
import pool from '../src/db/pool'
import { generateClientReport } from '../src/luna-tour/client-report-builder'
import type { ExtractedProfile } from '../src/luna-tour/client-profile-coach'

const SHARE_CODE = 'demo'
const DEMO_AGENT_EMAIL = 'demo-agent@luna.tour'   // 与 seed-demo-session 共用

/** 虚构客户 —— 刻意选一个「有取舍」的画像,样板才显得诚实、可信。 */
const DEMO_PROFILE: ExtractedProfile = {
  name: '陈先生',
  goal: 'live',
  budget_max: 3_000_000,
  payment: 'cash',
  family_size: 4,
  has_children: true,
  has_maid: true,
  cooking: 'often',
  nationality: '中国大陆',
  first_time_buyer: true,
  offplan_ok: true,
}
const DEMO_NOTE = '陈先生，中国大陆客户，第一次在迪拜买房。一家四口带两个小孩，请了保姆，太太常在家做中餐。预算 300 万 AED 全款，自住为主，接受期房。'

const STEPS = [
  { key: 'match', label: '匹配最优项目', done: false },
  { key: 'data', label: '深度数据分析（成交 / 回报 / 供给）', done: false },
  { key: 'market', label: '市场与政策趋势', done: false },
  { key: 'finalize', label: '编排报告', done: false },
]

async function main() {
  // demo 经纪(与 Luna demo 共用同一个)
  const a = await pool.query<{ id: string }>(
    `INSERT INTO lt_agents (email, display_name) VALUES ($1, 'Pinzos Demo')
     ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name
     RETURNING id`,
    [DEMO_AGENT_EMAIL]
  )
  const agentId = a.rows[0].id

  // 挑一个户型丰富的真实项目 —— 户型多才看得出「哪个适合你 / 为什么不推别的」
  const p = await pool.query<{ id: string; name: string; n: number }>(
    `SELECT p.id::text, p.project_name AS name, COUNT(u.id)::int AS n
       FROM residential_projects p
       JOIN project_unit_types u ON u.project_id = p.id
      WHERE p.latitude IS NOT NULL AND u.price IS NOT NULL
      GROUP BY p.id
     HAVING COUNT(u.id) >= 5
      ORDER BY COUNT(u.id) DESC
      LIMIT 1`
  )
  if (!p.rows[0]) { console.error('没有户型够多的项目,种不了 demo'); process.exit(1) }
  const proj = p.rows[0]
  console.log(`样板项目: ${proj.name}（${proj.n} 个户型）`)

  // 重种:删旧的同 code 报告
  await pool.query(`DELETE FROM lt_client_reports WHERE share_code = $1`, [SHARE_CODE])
  const r = await pool.query<{ id: string }>(
    `INSERT INTO lt_client_reports (agent_id, share_code, client_name, brief, status, progress)
     VALUES ($1,$2,$3,$4,'generating',$5) RETURNING id`,
    [agentId, SHARE_CODE, DEMO_PROFILE.name, DEMO_NOTE, JSON.stringify(STEPS)]
  )

  console.log('生成中（跑的是真管线：真实 DLD 数据 + 两层 AI 论证）…')
  await generateClientReport(r.rows[0].id, { name: DEMO_PROFILE.name }, DEMO_NOTE, DEMO_PROFILE, [proj.id])

  const done = await pool.query<{ status: string }>(`SELECT status FROM lt_client_reports WHERE id = $1`, [r.rows[0].id])
  console.log(`\n状态: ${done.rows[0]?.status}`)
  console.log(`✅ 样板报告: https://pinzos.com/cr/${SHARE_CODE}\n`)
  await pool.end()
}

main().catch(async (e) => { console.error(e); await pool.end().catch(() => {}); process.exit(1) })
