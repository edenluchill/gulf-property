/**
 * Production smoke test for browser direct-to-R2 multipart upload.
 *
 * Exercises the real flow against production:
 *   start -> sign -> R2 CORS preflight -> PUT a 6MB part -> abort
 * plus a liveness check that /complete is deployed (expects 400, not 404).
 *
 * It does NOT call /complete with real data, so NO task is created and the
 * multipart upload is aborted afterwards — zero pollution of production.
 *
 * Run: cd backend && npx ts-node scripts/test-r2-direct-upload.ts
 *      (override target: TEST_API=https://... npx ts-node ...)
 */

const API = process.env.TEST_API || 'https://api.pinzos.com'
const ORIGIN = 'https://pinzos.com'

function line(n: string, ...rest: any[]) {
  console.log(n, ...rest)
}

async function main() {
  console.log(`\n🔍 Direct-upload smoke test against ${API}\n`)
  const filename = `__smoketest_${Date.now()}.pdf`
  const size = 6 * 1024 * 1024 // 6MB — single multipart part

  // 1. /start — create job + multipart upload
  const startRes = await fetch(`${API}/api/r2-upload/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ files: [{ filename, size }] }),
  })
  const start: any = await startRes.json().catch(() => ({}))
  line('1. POST /start            ->', startRes.status, start?.success ? 'OK' : JSON.stringify(start))
  if (!startRes.ok || !start?.success) throw new Error('start failed — route not deployed?')
  const { jobId, uploads } = start
  const up = uploads[0]

  // 2. /sign — presign part 1
  const signRes = await fetch(`${API}/api/r2-upload/sign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ key: up.key, uploadId: up.uploadId, partNumbers: [1] }),
  })
  const signed: any = await signRes.json().catch(() => ({}))
  line('2. POST /sign             ->', signRes.status, signed?.success ? 'OK' : JSON.stringify(signed))
  const partUrl: string = signed?.urls?.['1']
  if (!partUrl) throw new Error('no presigned URL returned')

  // 3. R2 CORS preflight (simulate the browser's OPTIONS before PUT).
  //    NOTE: Expose-Headers belongs on the ACTUAL response, not the preflight —
  //    preflight only needs to allow the origin + method.
  const pre = await fetch(partUrl, {
    method: 'OPTIONS',
    headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'PUT' },
  })
  const preAllowOrigin = pre.headers.get('access-control-allow-origin')
  const preAllowMethods = pre.headers.get('access-control-allow-methods')
  line('3. R2 CORS preflight      ->', pre.status, `Allow-Origin=${preAllowOrigin}  Allow-Methods=${preAllowMethods}`)
  const preflightOk = pre.status >= 200 && pre.status < 300 && !!preAllowOrigin

  // 4. PUT the part WITH an Origin header so R2 returns the CORS headers a real
  //    browser would see — including Access-Control-Expose-Headers: ETag, which
  //    is what lets browser JS actually read the ETag for the complete call.
  const body = Buffer.alloc(size, 0x25)
  const putRes = await fetch(partUrl, { method: 'PUT', headers: { Origin: ORIGIN }, body })
  const etag = putRes.headers.get('etag')
  const exposeHeaders = putRes.headers.get('access-control-expose-headers')
  line('4. PUT part to R2         ->', putRes.status, `ETag=${etag}  Expose-Headers=${exposeHeaders}`)
  if (putRes.status !== 200 || !etag) throw new Error('part PUT failed or no ETag')
  const corsOk = preflightOk && /etag/i.test(exposeHeaders || '')
  if (!corsOk) {
    console.warn('   ⚠️  Browser would not be able to read ETag (Expose-Headers missing on PUT) — check R2 CORS.')
  }

  // 5. /abort — clean up the multipart upload (no task created)
  const abortRes = await fetch(`${API}/api/r2-upload/abort`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uploads: [{ key: up.key, uploadId: up.uploadId }] }),
  })
  line('5. POST /abort (cleanup)  ->', abortRes.status)

  // 6. /complete liveness — expect 400 (validation), proving the route is deployed
  const compRes = await fetch(`${API}/api/r2-upload/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  line('6. POST /complete (live)  ->', compRes.status, compRes.status === 400 ? 'OK (deployed)' : '⚠️ unexpected')

  console.log('\n✅ PASSED — direct-to-R2 upload path is live in production.')
  console.log(`   Test jobId=${jobId} (aborted; no task created)`)
  if (!corsOk) {
    console.log('   NOTE: re-check R2 bucket CORS ExposeHeaders: ETag before relying on browser uploads.')
    process.exit(2)
  }
}

main().catch((e) => {
  console.error('\n❌ FAILED:', e?.message || e)
  process.exit(1)
})
