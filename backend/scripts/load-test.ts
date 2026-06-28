/**
 * load-test.ts — closed-loop concurrency load tester for the public API.
 *
 * Zero-dependency (Node http/https only). Models a realistic public-user mix
 * (map first-screen + area clicks + transactions + project detail), self-seeds
 * real area/project IDs from the API, and reports PER-ENDPOINT p50/p95/p99/max,
 * error rate, and RPS. Detects crashes (ECONNREFUSED/ETIMEDOUT/5xx spike) and
 * can abort a phase when the error rate blows past a threshold.
 *
 * USAGE:
 *   cd backend
 *   # local instance (safe — start the server on :3000 first):
 *   LOAD_TEST_URL=http://localhost:3000 npx ts-node scripts/load-test.ts --phases 50,100,500
 *   # single level for a fixed duration:
 *   LOAD_TEST_URL=http://localhost:3000 npx ts-node scripts/load-test.ts -c 1000 -d 30
 *   # against production (DANGEROUS — see warnings in the assessment doc):
 *   LOAD_TEST_URL=https://api.pinzos.com npx ts-node scripts/load-test.ts --phases 100 --read-only
 *
 * FLAGS:
 *   -c, --connections N    fixed concurrency (overrides --phases)
 *   -d, --duration S       seconds per phase (default 20)
 *       --phases a,b,c      ramp through these concurrency levels (default 50,100,500,1000)
 *       --warmup S          ramp connections up over S seconds at each phase (default 3)
 *       --read-only         skip POST endpoints (events/batch) — use against prod
 *       --abort-pct N       abort a phase if error rate exceeds N% over a 3s window (default 40)
 *       --timeout S         per-request timeout seconds (default 15)
 *
 * NOTE ON 10000: a single client machine cannot reliably *generate* 10k sustained
 * concurrent connections (OS ephemeral-port / FD limits, client CPU). Ramp toward
 * the breaking point instead, or drive from multiple machines / k6 Cloud. This tool
 * warns and proceeds if you ask for >2000.
 */

import http from 'http'
import https from 'https'
import { URL } from 'url'

// ───────────────────────── arg parsing ─────────────────────────
function arg(name: string, short?: string): string | undefined {
  const i = process.argv.findIndex((a) => a === `--${name}` || (short && a === `-${short}`))
  return i >= 0 ? process.argv[i + 1] : undefined
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

const BASE = (process.env.LOAD_TEST_URL || arg('url') || 'http://localhost:3000').replace(/\/$/, '')
const FIXED_C = arg('connections', 'c') ? Number(arg('connections', 'c')) : null
const DURATION = Number(arg('duration', 'd') || 20)
const PHASES = FIXED_C ? [FIXED_C] : (arg('phases') || '50,100,500,1000').split(',').map(Number)
const WARMUP = Number(arg('warmup') || 3)
const READ_ONLY = flag('read-only')
const ABORT_PCT = Number(arg('abort-pct') || 40)
const TIMEOUT_MS = Number(arg('timeout') || 15) * 1000

const isHttps = BASE.startsWith('https')
const agent = isHttps
  ? new https.Agent({ keepAlive: true, maxSockets: Infinity })
  : new http.Agent({ keepAlive: true, maxSockets: Infinity })

// ───────────────────────── scenario ─────────────────────────
// weight = relative share of requests. {} placeholders filled from seeded IDs.
interface Spec {
  key: string
  method: 'GET' | 'POST'
  path: (ids: Seed) => string
  body?: () => any
  weight: number
  write?: boolean
}
interface Seed { areaIds: (string | number)[]; projectIds: (string | number)[] }

function pick<T>(arr: T[]): T { return arr[Math.floor((idx++ * 2654435761) % Math.max(1, arr.length))] }
let idx = 0 // deterministic-ish rotation (Math.random unavailable in some harnesses; fine here)

const SCENARIO: Spec[] = [
  // T1 — map first screen (every new visitor)
  { key: 'GET /dubai/areas',            method: 'GET', weight: 10, path: () => '/api/dubai/areas' },
  { key: 'GET /residential/map-pins',   method: 'GET', weight: 10, path: () => '/api/residential-projects/map-pins' },
  { key: 'GET /dubai/landmarks',        method: 'GET', weight: 8,  path: () => '/api/dubai/landmarks' },
  { key: 'GET /meta/data-version',      method: 'GET', weight: 6,  path: () => '/api/meta/data-version' },
  // T2 — area interactions (per click)
  { key: 'GET /market/area-insights',   method: 'GET', weight: 14, path: (s) => `/api/market/area-insights?areaId=${pick(s.areaIds)}&usage=all` },
  { key: 'GET /custom-routes/geojson',  method: 'GET', weight: 3,  path: () => '/api/custom-routes/geojson/all' },
  // T3 — transactions (cached path)
  { key: 'GET /tx/filters',             method: 'GET', weight: 5,  path: () => '/api/market/transactions/filters' },
  { key: 'GET /tx/summary',             method: 'GET', weight: 6,  path: () => '/api/market/transactions/summary' },
  { key: 'GET /tx/list',                method: 'GET', weight: 5,  path: () => '/api/market/transactions/list?limit=25&offset=0' },
  { key: 'GET /market/area-classify',   method: 'GET', weight: 3,  path: () => '/api/market/area-classification' },
  // T4 — project detail
  { key: 'GET /residential/:id',        method: 'GET', weight: 6,  path: (s) => `/api/residential-projects/${pick(s.projectIds)}` },
  { key: 'GET /market/price-check',     method: 'GET', weight: 4,  path: (s) => `/api/market/price-check?projectId=${pick(s.projectIds)}` },
  // writes (skipped with --read-only)
  { key: 'POST /events',                method: 'POST', weight: 6, write: true, path: () => '/api/events',
    body: () => ({ events: [{ type: 'page_view', path: '/map', ts: 0 }] }) },
  { key: 'POST /residential/batch',     method: 'POST', weight: 5, write: true, path: () => '/api/residential-projects/batch',
    body: (/* needs ids */) => ({ ids: [] }) },
]

// weighted expansion → flat pool to rotate through
function buildPool(specs: Spec[]): Spec[] {
  const pool: Spec[] = []
  for (const s of specs) {
    if (READ_ONLY && s.write) continue
    for (let i = 0; i < s.weight; i++) pool.push(s)
  }
  return pool
}

// ───────────────────────── http ─────────────────────────
interface Res { ok: boolean; status: number; ms: number; netErr?: string }
function fire(spec: Spec, seed: Seed): Promise<Res> {
  return new Promise((resolve) => {
    const start = process.hrtime.bigint()
    const u = new URL(BASE + spec.path(seed))
    const lib = isHttps ? https : http
    const payload = spec.method === 'POST' ? JSON.stringify(spec.body ? spec.body() : {}) : undefined
    const req = lib.request(
      u,
      {
        method: spec.method,
        agent,
        timeout: TIMEOUT_MS,
        headers: payload
          ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }
          : {},
      },
      (res) => {
        res.on('data', () => {}) // drain
        res.on('end', () => {
          const ms = Number(process.hrtime.bigint() - start) / 1e6
          resolve({ ok: (res.statusCode || 0) < 400, status: res.statusCode || 0, ms })
        })
      }
    )
    req.on('error', (e: any) => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6
      resolve({ ok: false, status: 0, ms, netErr: e.code || e.message })
    })
    req.on('timeout', () => { req.destroy(new Error('ETIMEDOUT')) })
    if (payload) req.write(payload)
    req.end()
  })
}

// ───────────────────────── stats ─────────────────────────
class Stat {
  lat: number[] = []
  n = 0; err = 0
  net: Record<string, number> = {}
  status: Record<number, number> = {}
  add(r: Res) {
    this.n++
    this.lat.push(r.ms)
    if (!r.ok) this.err++
    if (r.netErr) this.net[r.netErr] = (this.net[r.netErr] || 0) + 1
    this.status[r.status] = (this.status[r.status] || 0) + 1
  }
  pct(p: number): number {
    if (!this.lat.length) return 0
    const s = [...this.lat].sort((a, b) => a - b)
    return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))])
  }
}

function seedHarvest(): Promise<Seed> {
  // best-effort: pull real area + project ids so parameterized routes hit real rows
  const out: Seed = { areaIds: [1], projectIds: [1] }
  return new Promise((resolve) => {
    let pending = 2
    const done = () => { if (--pending === 0) resolve(out) }
    const get = (path: string, onJson: (j: any) => void) => {
      const lib = isHttps ? https : http
      const r = lib.request(new URL(BASE + path), { agent, timeout: TIMEOUT_MS }, (res) => {
        let buf = ''
        res.on('data', (c) => (buf += c))
        res.on('end', () => { try { onJson(JSON.parse(buf)) } catch {} ; done() })
      })
      r.on('error', done); r.on('timeout', () => r.destroy()); r.end()
    }
    get('/api/dubai/areas', (j) => {
      const rows = Array.isArray(j) ? j : j?.areas || j?.data || []
      const ids = rows.map((a: any) => a.id).filter((x: any) => x != null)
      if (ids.length) out.areaIds = ids.slice(0, 200)
    })
    get('/api/residential-projects/map-pins', (j) => {
      const rows = Array.isArray(j) ? j : j?.pins || j?.projects || j?.data || []
      const ids = rows.map((p: any) => p.id || p.project_id).filter((x: any) => x != null)
      if (ids.length) out.projectIds = ids.slice(0, 200)
    })
  })
}

// ───────────────────────── runner ─────────────────────────
async function runPhase(connections: number, seed: Seed): Promise<void> {
  const pool = buildPool(SCENARIO)
  const perEndpoint: Record<string, Stat> = {}
  const overall = new Stat()
  const deadline = Date.now() + DURATION * 1000
  let aborted = false
  let cursor = 0

  // rolling 3s window for abort guard
  let winN = 0, winErr = 0, winStart = Date.now()

  async function worker(rampDelay: number) {
    if (rampDelay) await sleep(rampDelay)
    while (Date.now() < deadline && !aborted) {
      const spec = pool[cursor++ % pool.length]
      const r = await fire(spec, seed)
      ;(perEndpoint[spec.key] ||= new Stat()).add(r)
      overall.add(r)
      winN++; if (!r.ok) winErr++
      if (Date.now() - winStart >= 3000) {
        const pct = winN ? (winErr / winN) * 100 : 0
        if (pct > ABORT_PCT && winN > 30) {
          aborted = true
          console.log(`\n  ⛔ ABORT: error rate ${pct.toFixed(0)}% over last 3s (>${ABORT_PCT}%). Server is failing — stopping phase.`)
        }
        winN = 0; winErr = 0; winStart = Date.now()
      }
    }
  }

  console.log(`\n━━━ Phase: ${connections} concurrent · ${DURATION}s · ${READ_ONLY ? 'read-only' : 'full mix'} ━━━`)
  const workers: Promise<void>[] = []
  for (let i = 0; i < connections; i++) {
    // spread worker starts over WARMUP seconds to avoid a thundering-herd connect storm
    workers.push(worker(WARMUP > 0 ? Math.floor((i / connections) * WARMUP * 1000) : 0))
  }
  await Promise.all(workers)

  // report
  const dur = DURATION
  const rps = (overall.n / dur).toFixed(0)
  console.log(`  total ${overall.n} reqs · ${rps} req/s · errors ${overall.err} (${((overall.err / Math.max(1, overall.n)) * 100).toFixed(1)}%)`)
  console.log(`  latency  p50 ${overall.pct(50)}ms · p95 ${overall.pct(95)}ms · p99 ${overall.pct(99)}ms · max ${overall.pct(100)}ms`)
  const netKeys = Object.values(perEndpoint).flatMap((s) => Object.keys(s.net))
  if (overall.err > 0) {
    const allNet: Record<string, number> = {}
    for (const s of Object.values(perEndpoint)) for (const [k, v] of Object.entries(s.net)) allNet[k] = (allNet[k] || 0) + v
    if (Object.keys(allNet).length) console.log(`  network errors: ${JSON.stringify(allNet)}`)
  }
  console.log(`  ${'endpoint'.padEnd(30)} ${'n'.padStart(6)} ${'err'.padStart(5)} ${'p50'.padStart(6)} ${'p95'.padStart(7)} ${'p99'.padStart(7)} ${'max'.padStart(7)}`)
  for (const [key, s] of Object.entries(perEndpoint).sort((a, b) => b[1].n - a[1].n)) {
    console.log(`  ${key.padEnd(30)} ${String(s.n).padStart(6)} ${String(s.err).padStart(5)} ${String(s.pct(50)).padStart(6)} ${String(s.pct(95)).padStart(7)} ${String(s.pct(99)).padStart(7)} ${String(s.pct(100)).padStart(7)}`)
  }
  void netKeys
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)) }

;(async () => {
  console.log(`\n🎯 Target: ${BASE}`)
  if (Math.max(...PHASES) > 2000) {
    console.log(`⚠️  Requested >2000 concurrent. A single client usually can't sustain this (ephemeral ports / FD limits). Results past ~1-2k may reflect CLIENT saturation, not the server. Proceeding anyway.`)
  }
  if (isHttps && BASE.includes('pinzos.com')) {
    console.log(`⚠️  Targeting PRODUCTION. This stresses the live single-box API real users share, and Cloudflare may rate-limit/block. Run off-peak; watch the Admin 性能 tab; Ctrl-C to abort.`)
  }
  console.log(`\nSeeding real area/project IDs…`)
  const seed = await seedHarvest()
  console.log(`  areaIds: ${seed.areaIds.length}, projectIds: ${seed.projectIds.length}`)
  for (const c of PHASES) {
    await runPhase(c, seed)
    await sleep(2000) // brief recovery between phases
  }
  console.log(`\n✅ Done.`)
  process.exit(0)
})()
