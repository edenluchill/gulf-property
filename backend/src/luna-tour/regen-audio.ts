/**
 * Luna Tour — (re)generate narration audio for an existing session.
 *
 *   npx ts-node src/luna-tour/regen-audio.ts <shareCode|sessionId> [--force]
 *
 * Use to backfill audio for sessions created before TTS existed (e.g. `demo`),
 * or to rebuild after editing narration. --force re-synthesizes every beat.
 */
import dotenv from 'dotenv'
dotenv.config()
import pool from '../db/pool'
import { generateSessionAudio } from './audio-pipeline'

async function resolveSessionId(arg: string): Promise<string | null> {
  // UUID? use directly; else treat as share_code.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(arg)) return arg
  const { rows } = await pool.query(`SELECT id FROM lt_demo_sessions WHERE share_code = $1 LIMIT 1`, [arg])
  return rows[0]?.id ?? null
}

async function main() {
  const arg = process.argv[2]
  const force = process.argv.includes('--force')
  if (!arg) {
    console.error('usage: regen-audio.ts <shareCode|sessionId> [--force]')
    process.exit(1)
  }
  const sessionId = await resolveSessionId(arg)
  if (!sessionId) {
    console.error(`no session for "${arg}"`)
    process.exit(1)
  }
  console.log(`generating audio for session ${sessionId} (force=${force})…`)
  const r = await generateSessionAudio(sessionId, { force, concurrency: 2 })
  console.log(`✅ done: ${r.ready} ready, ${r.skipped} skipped, ${r.failed} failed (of ${r.total})`)
  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
