/**
 * Luna Tour — Phase 0 heart-slice seed (share_code = 'demo').
 *
 * Thin wrapper over session-builder.createSession: picks 3 real projects in
 * distinct areas and builds the canonical demo. All the heavy lifting (real
 * POIs/distances/ROI + AI script + persistence) lives in session-builder so the
 * parameterized generator (create-session.ts) and this seed share one code path.
 *
 * Usage (from backend/):
 *   npx ts-node src/luna-tour/seed-demo-session.ts
 *
 * ISOLATION: only lt_* writes. Delete the luna-tour directory to remove.
 */
import pool from '../db/pool'
import { createSession, ensureAgent } from './session-builder'

const SHARE_CODE = 'demo'
const DEMO_AGENT_EMAIL = 'demo-agent@luna.tour'

function num(v: string | number | null): number | undefined {
  if (v == null) return undefined
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : undefined
}

/** Pick 3 projects across distinct areas + spread across the price range. */
async function pickDemoProjectIds(): Promise<string[]> {
  const { rows } = await pool.query<{ id: string; min_price: string | number | null; latitude: string | number | null; longitude: string | number | null }>(
    `SELECT DISTINCT ON (area) id::text, min_price, latitude, longitude
       FROM residential_projects
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL
        AND min_price IS NOT NULL AND min_price > 500000
        AND area IS NOT NULL
      ORDER BY area, min_price DESC`
  )
  const sorted = rows
    .filter((r) => num(r.latitude) && num(r.longitude))
    .sort((a, b) => (num(b.min_price) ?? 0) - (num(a.min_price) ?? 0))
  if (sorted.length < 3) return sorted.map((r) => r.id)
  return [sorted[0].id, sorted[Math.floor(sorted.length / 2)].id, sorted[sorted.length - 1].id]
}

async function main(): Promise<void> {
  console.log('1/4  Picking 3 real projects (distinct areas)...')
  const projectIds = await pickDemoProjectIds()
  if (projectIds.length < 3) throw new Error(`Need 3 usable projects, found ${projectIds.length}.`)

  console.log('2/4  Ensuring demo agent + client...')
  const agentId = await ensureAgent({
    email: DEMO_AGENT_EMAIL,
    displayName: 'David Chen',
    phone: '+971500000000',
    whatsapp: '971500000000',
    photoUrl: 'https://i.pravatar.cc/200?img=12',
    brand: { title: 'Emaar 认证顾问', whatsapp: '971500000000', accent: '#00E0B8' },
  })

  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM lt_clients WHERE agent_id=$1 AND name=$2 LIMIT 1`,
    [agentId, '陈先生']
  )
  let clientId = existing.rows[0]?.id
  if (!clientId) {
    const ins = await pool.query<{ id: string }>(
      `INSERT INTO lt_clients (agent_id, name, nationality, preferred_language, goal, budget_min, budget_max)
       VALUES ($1,$2,$3,'zh','invest_both',1000000,5000000) RETURNING id`,
      [agentId, '陈先生', '香港']
    )
    clientId = ins.rows[0].id
  }

  console.log('3/4  Building session (real POIs + AI script, ~10s)...')
  const res = await createSession({
    shareCode: SHARE_CODE,
    projectIds,
    title: 'David 为陈先生精选的 3 个家',
    agentId,
    clientId,
    client: { persona: 'investor', name: '陈先生', goal: 'investment', nationality: '香港' },
    awaitAudio: true, // CLI: wait so the seed command finishes with audio ready
  })
  if (res.warnings.length) res.warnings.forEach((w) => console.log(`     ! ${w}`))

  console.log('4/4  Done.')
  console.log(`\n  ✅ Seeded. Open: /?toursession=${SHARE_CODE}`)
  console.log(`     total_ms=${res.totalMs} acts=${res.acts} | session_id=${res.sessionId}`)
  await pool.end()
}

main().catch(async (err) => {
  console.error('\nSEED FAILED:', err instanceof Error ? err.message : err)
  try {
    await pool.end()
  } catch {
    /* ignore */
  }
  process.exit(1)
})
