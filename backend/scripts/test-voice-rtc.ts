/**
 * Voice-RTC 生产集成测试(打 api.pinzos.com,Agora 已配)。
 * 建房 → start → viewer-token → heartbeat → end → 查库 → 限额429 → 自清理。
 * 运行:cd backend && npx ts-node scripts/test-voice-rtc.ts
 */
import pool from '../src/db/pool'

const BASE = process.env.BE || 'https://api.pinzos.com'
const TEST_EMAIL = `voicetest_${Date.now()}@pinzos.local`

let passed = 0
function ok(cond: boolean, label: string): void {
  if (cond) { passed++; console.log(`  ✓ ${label}`) }
  else { console.error(`  ✗ ${label}`); throw new Error(`FAILED: ${label}`) }
}

async function post(path: string, body: any): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  let json: any = null
  try { json = await res.json() } catch { /* 204 */ }
  return { status: res.status, json }
}

async function main() {
  console.log(`\n[test-voice-rtc] BASE=${BASE}\n`)

  // 0. health
  const health = await (await fetch(`${BASE}/api/voice-rtc/health`)).json() as any
  ok(health.configured === true, `health configured:true`)

  // 1. create a real collab room (in-memory; /start validates it exists)
  const room = await post('/api/collab/rooms', { name: 'voicetest' })
  const code: string = room.json.code
  ok(typeof code === 'string' && code.length >= 4, `room created (${code})`)

  // 2. start → token
  const start = await post('/api/voice-rtc/start', { roomCode: code, agentEmail: TEST_EMAIL })
  ok(start.status === 200 && start.json.ok === true, 'start ok')
  ok(typeof start.json.token === 'string' && start.json.token.startsWith('007'), `token is AccessToken2 (007…)`)
  ok(start.json.appId && start.json.channel === code, 'appId + channel returned')
  ok(start.json.allowedSeconds > 0 && start.json.allowedSeconds <= 1800, `allowedSeconds ${start.json.allowedSeconds} ∈ (0,1800]`)
  const sessionId: number = start.json.sessionId
  ok(typeof sessionId === 'number', `sessionId ${sessionId}`)

  // 3. viewer-token (active session exists)
  const vt = await post('/api/voice-rtc/viewer-token', { roomCode: code })
  ok(vt.status === 200 && vt.json.ok === true, 'viewer-token ok')
  ok(typeof vt.json.token === 'string' && vt.json.token.startsWith('007'), 'viewer token AccessToken2')
  ok(vt.json.remainingSeconds > 0 && vt.json.remainingSeconds <= 1800, `viewer remaining ${vt.json.remainingSeconds}`)

  // 4. heartbeat → 204
  const hb = await post('/api/voice-rtc/heartbeat', { sessionId })
  ok(hb.status === 204, 'heartbeat 204')

  // 5. end → 204, then DB row finalized
  const end = await post('/api/voice-rtc/end', { sessionId, reason: 'test' })
  ok(end.status === 204, 'end 204')
  await new Promise(r => setTimeout(r, 800)) // best-effort write
  const row = (await pool.query('SELECT * FROM voice_sessions WHERE id=$1', [sessionId])).rows[0]
  ok(!!row && row.ended_at !== null, 'session row ended_at set')
  ok(row.ended_reason === 'test', `ended_reason=test`)
  ok(row.allowed_seconds > 0, 'allowed_seconds recorded')

  // 6. after end, viewer-token → 409 (no active session)
  const vt2 = await post('/api/voice-rtc/viewer-token', { roomCode: code })
  ok(vt2.status === 409 && vt2.json.ok === false, 'viewer-token 409 after end')

  // 7. bogus room → 404
  const bogus = await post('/api/voice-rtc/start', { roomCode: 'ZZZZZ', agentEmail: TEST_EMAIL })
  ok(bogus.status === 404, 'start bogus room 404')

  // 8. agent daily limit: stuff synthetic usage > 3h today for a fresh email, then start → 429
  const limitEmail = `voicelimit_${Date.now()}@pinzos.local`
  await pool.query(
    `INSERT INTO voice_sessions (agent_email, room_code, started_at, ended_at, duration_seconds, allowed_seconds, ended_reason)
     VALUES ($1,$2, now(), now(), $3, $3, 'seed')`,
    [limitEmail, code, 3 * 60 * 60 + 60] // 3h + 1min
  )
  const room2 = await post('/api/collab/rooms', { name: 'voicelimit' })
  const code2: string = room2.json.code
  const limited = await post('/api/voice-rtc/start', { roomCode: code2, agentEmail: limitEmail })
  ok(limited.status === 429 && limited.json.reason === 'agent_daily_limit', `agent daily limit → 429 (${limited.json.reason})`)

  // 9. usage endpoint reflects the seeded usage
  const usage = await (await fetch(`${BASE}/api/voice-rtc/usage?email=${encodeURIComponent(limitEmail)}`)).json() as any
  ok(usage.ok && usage.usedSeconds >= 3 * 60 * 60, `usage usedSeconds=${usage.usedSeconds} ≥ 3h`)
  ok(usage.remainingSeconds === 0, 'usage remaining 0 (over limit)')

  // cleanup
  await pool.query(`DELETE FROM voice_sessions WHERE agent_email IN ($1,$2)`, [TEST_EMAIL, limitEmail])
  console.log('\n✓ cleaned up test rows')

  await pool.end()
  console.log(`\nALL VOICE-RTC TESTS PASSED (${passed} assertions)\n`)
  process.exit(0)
}

main().catch(async (e) => {
  console.error('\n[test-voice-rtc] FAILED:', e?.message || e)
  try { await pool.query(`DELETE FROM voice_sessions WHERE agent_email LIKE 'voicetest_%' OR agent_email LIKE 'voicelimit_%'`) } catch {}
  process.exit(1)
})
