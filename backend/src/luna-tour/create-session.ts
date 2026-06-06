/**
 * Luna Tour — parameterized session generator (CLI).
 *
 * Generate a tour for ANY properties (not just the demo). Reuses session-builder
 * (real POIs/distances/ROI + AI TourScript).
 *
 * Usage (from backend/):
 *   npx ts-node src/luna-tour/create-session.ts <shareCode> <projectId1,projectId2,...> ["Title"]
 *
 * Example:
 *   npx ts-node src/luna-tour/create-session.ts sarah-marina 0b683398-...,a1f2...,c9d8... "为 Sarah 精选"
 *
 * Uses the demo agent (David Chen) by default; pass LT_AGENT_EMAIL to use another.
 */
import pool from '../db/pool'
import { createSession, ensureAgent } from './session-builder'

async function main(): Promise<void> {
  const [shareCode, idsArg, title] = process.argv.slice(2)
  if (!shareCode || !idsArg) {
    console.log('Usage: npx ts-node src/luna-tour/create-session.ts <shareCode> <id1,id2,...> ["Title"]')
    process.exit(1)
  }
  const projectIds = idsArg.split(',').map((s) => s.trim()).filter(Boolean)
  if (projectIds.length < 2) {
    console.error('Need at least 2 project ids (comma-separated).')
    process.exit(1)
  }

  const agentId = await ensureAgent({
    email: process.env.LT_AGENT_EMAIL || 'demo-agent@luna.tour',
    displayName: 'David Chen',
    phone: '+971500000000',
    whatsapp: '971500000000',
    photoUrl: 'https://i.pravatar.cc/200?img=12',
    brand: { title: 'Emaar 认证顾问', whatsapp: '971500000000', accent: '#00E0B8' },
  })

  console.log(`Generating session "${shareCode}" for ${projectIds.length} properties...`)
  const res = await createSession({
    shareCode,
    projectIds,
    title: title || 'Luna 为你精选的家',
    agentId,
    awaitAudio: true, // CLI: wait so the command doesn't exit before audio finishes
  })

  if (res.warnings.length) res.warnings.forEach((w) => console.log(`  ! ${w}`))
  console.log(`\n  ✅ Done. total_ms=${res.totalMs} acts=${res.acts}`)
  console.log(`     Open: /?toursession=${res.shareCode}`)
  console.log(`     session_id = ${res.sessionId}`)
  await pool.end()
}

main().catch(async (err) => {
  console.error('\nCREATE SESSION FAILED:', err instanceof Error ? err.message : err)
  try {
    await pool.end()
  } catch {
    /* ignore */
  }
  process.exit(1)
})
