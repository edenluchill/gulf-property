/**
 * perfSink — dependency-free, in-memory performance accumulator.
 *
 * WHY a standalone module: db/pool.ts feeds query timings here, and
 * services/perfMonitor.ts (which imports pool) drains+evaluates here. Keeping
 * the raw buffers in a module with ZERO imports breaks the pool↔monitor cycle
 * and guarantees this can never throw into a request path.
 *
 * Model: one bucket per wall-clock SECOND, ring of 300 (last 5 min). Each
 * request/query updates the current second's bucket. window(s) aggregates the
 * last s seconds. Per-bucket latency samples are capped so memory stays bounded
 * even under a 10k-user spike (≤ LAT_CAP numbers/sec × 300s).
 */

const RING = 300 // seconds of history kept
const LAT_CAP = 1000 // max latency samples stored per second (reservoir cap)

export const SLOW_REQ_MS = Number(process.env.PERF_SLOW_REQ_MS) || 1000
export const SLOW_QUERY_MS = Number(process.env.PERF_SLOW_QUERY_MS) || 500

interface Bucket {
  sec: number // epoch second this bucket represents
  req: number
  err4: number
  err5: number
  slowReq: number
  query: number
  slowQuery: number
  peakConc: number
  lat: number[] // request latencies (ms), capped at LAT_CAP
}

function emptyBucket(sec: number): Bucket {
  return { sec, req: 0, err4: 0, err5: 0, slowReq: 0, query: 0, slowQuery: 0, peakConc: 0, lat: [] }
}

const buckets: Bucket[] = Array.from({ length: RING }, () => emptyBucket(0))
let activeConcurrency = 0

function nowSec(): number {
  return Math.floor(Date.now() / 1000)
}

/** Get (and lazily reset) the bucket for a given epoch second. */
function bucketFor(sec: number): Bucket {
  const idx = sec % RING
  const b = buckets[idx]
  if (b.sec !== sec) {
    // Reused slot from 300s ago — reset it for the new second.
    b.sec = sec
    b.req = 0; b.err4 = 0; b.err5 = 0; b.slowReq = 0
    b.query = 0; b.slowQuery = 0; b.peakConc = 0
    b.lat.length = 0
  }
  return b
}

/** skipLatency: 长连接(上传/SSE)只计次数与错误率,不进延迟分位/慢请求计数 —
 *  它们的耗时是设计如此,混入会在低流量窗口把 p95 报警顶爆(见 perfMetrics)。 */
export function recordRequest(status: number, ms: number, skipLatency = false): void {
  const b = bucketFor(nowSec())
  b.req++
  if (status >= 500) b.err5++
  else if (status >= 400) b.err4++
  if (skipLatency) return
  if (ms >= SLOW_REQ_MS) b.slowReq++
  if (b.lat.length < LAT_CAP) b.lat.push(ms)
}

/**
 * Maintenance window flag — background warmers (area-insights / project-insights)
 * intentionally run hundreds of >500ms aggregate queries every few hours. Counting
 * those as "slow queries" fired the SLOW_QUERIES alarm ~50×/day with req=0 and
 * drowned out real incidents. While depth > 0, queries still count into
 * query_count but NOT into the alarm-driving slowQuery counter. Trade-off: a real
 * user slow query during the few-minute warm window is also uncounted — acceptable
 * vs. a permanently red alarm channel.
 */
let maintenanceDepth = 0
export function beginMaintenance(): void { maintenanceDepth++ }
export function endMaintenance(): void { if (maintenanceDepth > 0) maintenanceDepth-- }

export function recordQuery(ms: number): void {
  const b = bucketFor(nowSec())
  b.query++
  if (ms >= SLOW_QUERY_MS && maintenanceDepth === 0) b.slowQuery++
}

export function incConcurrency(): void {
  activeConcurrency++
  const b = bucketFor(nowSec())
  if (activeConcurrency > b.peakConc) b.peakConc = activeConcurrency
}

export function decConcurrency(): void {
  if (activeConcurrency > 0) activeConcurrency--
}

/** 当前在途的真实用户请求数。 */
export function liveRequestsInFlight(): number {
  return activeConcurrency
}

/**
 * 后台批量任务(缓存预热等)在**每一项之前**调这个 —— 有真人在用就让路。
 *
 * 为什么需要:预热器本身已经每项 sleep 250ms 了,看着很"礼貌"。但礼貌的是**节奏**,
 * 不是**优先级** —— 它照样每秒往 DB 灌十几条**重聚合查询**(每个项目的 insights 都要
 * 打 DLD 那几张大表)。真实事故(2026-07-14 05:17):预热正在跑,一个客户请求了一个
 * 还没预热到的项目 → 他的查询在 DB 里排队等 CPU → **等了 7.6 秒**。
 * 那一分钟 `pool_waiting = 0` —— **不是连接池被占满,是 DB 的 CPU 被占满**。
 * (指纹:`req` 只有 9,`query_count` 却有 704 → 后台任务饿死前台。)
 *
 * 预热是**没有 deadline 的活**:晚 10 秒热完没人在乎,让一个真人等 7 秒有人在乎。
 * 所以规则很简单:**只要有活人在飞,就等**。等到没人了再继续。
 * 上限 maxWaitMs 是防呆 —— 万一有个 SSE/长连接一直挂着,预热不能就此永远停摆。
 */
export async function yieldToLiveTraffic(maxWaitMs = 30_000): Promise<void> {
  const deadline = Date.now() + maxWaitMs
  while (activeConcurrency > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200))
  }
}

export interface Window {
  windowSec: number
  req: number
  err4: number
  err5: number
  slowReq: number
  query: number
  slowQuery: number
  rps: number
  errPct: number // 5xx as % of all requests
  p50: number
  p95: number
  p99: number
  max: number
  peakConcurrency: number
  activeConcurrency: number
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return Math.round(sorted[idx])
}

/** Aggregate the last `seconds` of history (clamped to RING). */
export function window(seconds: number): Window {
  const s = Math.min(RING, Math.max(1, Math.floor(seconds)))
  const cutoff = nowSec() - s + 1
  let req = 0, err4 = 0, err5 = 0, slowReq = 0, query = 0, slowQuery = 0, peakConc = 0
  const lat: number[] = []
  for (const b of buckets) {
    if (b.sec >= cutoff) {
      req += b.req; err4 += b.err4; err5 += b.err5; slowReq += b.slowReq
      query += b.query; slowQuery += b.slowQuery
      if (b.peakConc > peakConc) peakConc = b.peakConc
      for (const v of b.lat) lat.push(v)
    }
  }
  lat.sort((a, b) => a - b)
  return {
    windowSec: s,
    req, err4, err5, slowReq, query, slowQuery,
    rps: Math.round((req / s) * 100) / 100,
    errPct: req > 0 ? Math.round((err5 / req) * 1000) / 10 : 0,
    p50: percentile(lat, 50),
    p95: percentile(lat, 95),
    p99: percentile(lat, 99),
    max: lat.length ? Math.round(lat[lat.length - 1]) : 0,
    peakConcurrency: peakConc,
    activeConcurrency,
  }
}

// ───────────────────────── 5xx incidents (NOT sampled) ──────────────────────
// A 5xx is an EVENT, not a state: it happened, a real customer ate it, and it
// never "un-happens". So every single one is captured here in full (no sampling
// — api_calls samples, and sampling is exactly how the worst failures stayed
// invisible), keyed by (route template, status). perfMonitor drains this each
// tick into a perf_alerts incident that ONLY a human can close, after finding
// the root cause. See db/perf-alerts-incidents.sql.
export interface ErrorHit {
  signature: string        // "POST /api/billing/checkout|500"
  endpoint: string
  status: number
  count: number
  firstAt: string
  lastAt: string
  sampleUrl: string
  victims: string[]        // emails / visitor ids that ate the error
}

const MAX_ERROR_SIGS = 100  // cardinality guard
const errorHits = new Map<string, ErrorHit>()

export function recordError(
  endpoint: string,
  status: number,
  originalUrl: string,
  who: string | null,
): void {
  const signature = `${endpoint}|${status}`
  const now = new Date().toISOString()
  let hit = errorHits.get(signature)
  if (!hit) {
    if (errorHits.size >= MAX_ERROR_SIGS) return
    hit = {
      signature, endpoint, status, count: 0,
      firstAt: now, lastAt: now,
      sampleUrl: originalUrl.slice(0, 300),
      victims: [],
    }
    errorHits.set(signature, hit)
  }
  hit.count++
  hit.lastAt = now
  if (who && !hit.victims.includes(who) && hit.victims.length < 10) hit.victims.push(who)
}

/** Hand over everything captured since the last call; the sink starts empty again. */
export function drainErrors(): ErrorHit[] {
  const out = [...errorHits.values()]
  errorHits.clear()
  return out
}

// ───────────────────────── slow requests (NOT sampled) ──────────────────────
// Same lesson as the 5xx incidents: a latency alert is useless if you can't tell
// WHICH request was slow. api_calls samples (and only records GETs on a curated
// whitelist, so the heaviest map endpoints were never in it), morgan's log dies
// with the container, and the >10s console breadcrumb missed an 8.6s request by
// design. Every request over SLOW_REQ_MS is now captured whole, with the real URL
// and the person who waited, and drained to perf_slow_requests.
export interface SlowHit {
  endpoint: string
  url: string
  status: number
  ms: number
  who: string | null
  aborted: boolean
}

const MAX_SLOW_BUFFER = 200
const slowHits: SlowHit[] = []

export function recordSlow(hit: SlowHit): void {
  if (slowHits.length >= MAX_SLOW_BUFFER) return
  slowHits.push({ ...hit, url: hit.url.slice(0, 300) })
}

export function drainSlow(): SlowHit[] {
  return slowHits.splice(0, slowHits.length)
}

// ───────────────────────── per-endpoint (path) tracking ─────────────────────
// Separate, bounded structure: one record per normalized route template
// ("GET /api/dubai/areas"), each holding a small ring of minute buckets. This
// powers the dashboard's per-endpoint usage+latency table. Memory ceiling:
// MAX_PATHS × PATH_RING × PATH_LAT_CAP numbers (~300×5×200 = 300k worst case).
const PATH_RING = 5 // minute buckets kept per path (last 5 min)
const PATH_BUCKET_S = 60
const PATH_LAT_CAP = 200 // latency samples per path per minute bucket
const MAX_PATHS = 300 // distinct route templates tracked (real surface is ~80)

interface PathBucket { idx: number; req: number; err: number; slow: number; lat: number[] }
interface PathRec { buckets: PathBucket[] }
const paths = new Map<string, PathRec>()

function pathBucketIdx(sec: number): number {
  return Math.floor(sec / PATH_BUCKET_S)
}

export function recordEndpoint(key: string, status: number, ms: number): void {
  let rec = paths.get(key)
  if (!rec) {
    if (paths.size >= MAX_PATHS) return // cardinality guard — never grows unbounded
    rec = { buckets: Array.from({ length: PATH_RING }, () => ({ idx: -1, req: 0, err: 0, slow: 0, lat: [] })) }
    paths.set(key, rec)
  }
  const bIdx = pathBucketIdx(nowSec())
  const slot = rec.buckets[bIdx % PATH_RING]
  if (slot.idx !== bIdx) {
    slot.idx = bIdx; slot.req = 0; slot.err = 0; slot.slow = 0; slot.lat.length = 0
  }
  slot.req++
  if (status >= 500) slot.err++
  if (ms >= SLOW_REQ_MS) slot.slow++
  if (slot.lat.length < PATH_LAT_CAP) slot.lat.push(ms)
}

export interface EndpointStat {
  key: string
  req: number
  err: number
  slow: number
  rps: number
  p50: number
  p95: number
  p99: number
  max: number
}

/** Per-endpoint aggregate over the last `minutes` (clamped to PATH_RING). */
export function endpoints(minutes = 5): EndpointStat[] {
  const span = Math.min(PATH_RING, Math.max(1, Math.floor(minutes)))
  const cutoff = pathBucketIdx(nowSec()) - span + 1
  const out: EndpointStat[] = []
  for (const [key, rec] of paths) {
    let req = 0, err = 0, slow = 0
    const lat: number[] = []
    for (const b of rec.buckets) {
      if (b.idx >= cutoff) { req += b.req; err += b.err; slow += b.slow; for (const v of b.lat) lat.push(v) }
    }
    if (req === 0) continue
    lat.sort((a, b) => a - b)
    out.push({
      key, req, err, slow,
      rps: Math.round((req / (span * PATH_BUCKET_S)) * 100) / 100,
      p50: percentile(lat, 50),
      p95: percentile(lat, 95),
      p99: percentile(lat, 99),
      max: lat.length ? Math.round(lat[lat.length - 1]) : 0,
    })
  }
  out.sort((a, b) => b.req - a.req)
  return out
}
