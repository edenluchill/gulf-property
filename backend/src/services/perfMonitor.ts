/**
 * perfMonitor — minute rollups + threshold alerting on top of perfSink.
 *
 * startPerfFlusher() runs a 60s timer that:
 *   1. writes the last 60s aggregate into perf_minute (1 row/min),
 *   2. evaluates alert rules over a 180s window,
 *   3. opens/closes rows in perf_alerts (state machine: no active → breach opens
 *      one + emails; recovery resolves it + emails). Firing only on transitions
 *      gives natural debounce — no flapping spam.
 *
 * Read helpers (getPerfSnapshot/getActiveAlerts/...) back the Admin dashboard.
 * Everything is wrapped so a DB hiccup can never crash the process.
 */
import pool from '../db/pool'
import * as sink from './perfSink'
import { sendAlertEmail } from './notify'

// ── Tunable thresholds (env-overridable) ────────────────────────────────────
const P95_MS = Number(process.env.PERF_P95_MS) || 2000
// 5xx 不设"错误率"阈值 —— 见 evaluateRules 上方注释。任何一个 5xx 都开事故。
const ERR_PCT = 0
const SLOWQ_3MIN = Number(process.env.PERF_SLOWQ_3MIN) || 60
const POOL_WAIT = Number(process.env.PERF_POOL_WAIT) || 1
const EVAL_WINDOW_S = 180

const APP_URL = process.env.APP_URL || 'https://www.pinzos.com'

interface RuleResult {
  kind: string
  breached: boolean
  metric: number
  threshold: number
  message: string
}

export interface PoolStats {
  total: number
  idle: number
  waiting: number
  max: number
}

function poolStats(): PoolStats {
  // pg Pool exposes these counters at runtime; typings omit them.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = pool as any
  return {
    total: p.totalCount ?? 0,
    idle: p.idleCount ?? 0,
    waiting: p.waitingCount ?? 0,
    max: p.options?.max ?? 0,
  }
}

// NOTE: there is deliberately no HIGH_ERROR_RATE rule. A 5xx rate is a state, and
// treating errors as state is what let real bugs close themselves: at 3 req/min,
// "the rate fell back under 5%" only ever meant "nobody hit the broken endpoint
// again". Worse, a rate threshold *hides* sparse errors — one 500 an hour never
// reaches 5%, so it never even alerts. Every 5xx now opens an API_5XX incident
// instead (ingestErrorIncidents): per endpoint, with the victim and the failing
// URL, and it stays open until someone finds the root cause.
function evaluateRules(w: sink.Window, ps: PoolStats, worst: sink.SlowHit[]): RuleResult[] {
  // Name the culprits in the alert itself. "p95 8673ms" tells you nothing you can
  // act on; "最慢: GET /api/dubai/areas 8673ms (匿名)" is the root cause, in the
  // alert, at the moment it fires.
  const blame = worst.length
    ? ` — 最慢: ${worst.map((h) => `${h.endpoint} ${h.ms}ms${h.who ? ` (${h.who})` : ''}${h.aborted ? ' [客户端已放弃]' : ''}`).join('; ')}`
    : ''
  return [
    {
      kind: 'HIGH_LATENCY',
      breached: w.req >= 5 && w.p95 > P95_MS,
      metric: w.p95,
      threshold: P95_MS,
      message: `p95 延迟 ${w.p95}ms 超过阈值 ${P95_MS}ms（近 3 分钟，${w.req} 请求）${blame}`,
    },
    {
      kind: 'SLOW_QUERIES',
      breached: w.slowQuery > SLOWQ_3MIN,
      metric: w.slowQuery,
      threshold: SLOWQ_3MIN,
      message: `慢查询 ${w.slowQuery} 条超过阈值 ${SLOWQ_3MIN}（近 3 分钟，>${sink.SLOW_QUERY_MS}ms）`,
    },
    {
      kind: 'DB_POOL_SATURATION',
      breached: ps.waiting >= POOL_WAIT,
      metric: ps.waiting,
      threshold: POOL_WAIT,
      message: `数据库连接池排队 ${ps.waiting}（池 ${ps.total}/${ps.max}）— 请求在等连接`,
    },
  ]
}

async function flushMinute(w: sink.Window, ps: PoolStats): Promise<void> {
  // Stamp to the start of the current minute.
  const minute = new Date(Math.floor(Date.now() / 60000) * 60000).toISOString()
  await pool.query(
    `INSERT INTO perf_minute
       (minute, req, err4, err5, slow_req, query_count, slow_query,
        p50, p95, p99, max_ms, peak_concurrency, pool_total, pool_waiting)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (minute) DO UPDATE SET
       req=EXCLUDED.req, err4=EXCLUDED.err4, err5=EXCLUDED.err5,
       slow_req=EXCLUDED.slow_req, query_count=EXCLUDED.query_count,
       slow_query=EXCLUDED.slow_query, p50=EXCLUDED.p50, p95=EXCLUDED.p95,
       p99=EXCLUDED.p99, max_ms=EXCLUDED.max_ms,
       peak_concurrency=EXCLUDED.peak_concurrency,
       pool_total=EXCLUDED.pool_total, pool_waiting=EXCLUDED.pool_waiting`,
    [minute, w.req, w.err4, w.err5, w.slowReq, w.query, w.slowQuery,
     w.p50, w.p95, w.p99, w.max, w.peakConcurrency, ps.total, ps.waiting]
  )
}

/**
 * 5xx incidents. A 5xx is an event, not a state — it does not "recover", so
 * these are NEVER auto-resolved. One open incident per (endpoint, status);
 * repeat hits accumulate into it instead of spamming new rows. It stays open
 * until a human hits 「标记已解决」 on the dashboard, which is the only thing
 * that should mean "root cause found and fixed".
 *
 * This replaces the old behaviour, where HIGH_ERROR_RATE auto-closed as soon as
 * the 3-min error RATE fell back under 5% — which at 3 req/min just meant nobody
 * had touched the broken endpoint lately. 2026-07-09: /api/billing/checkout 500ed
 * on a paying customer three times, and the alert closed itself 3 minutes later.
 */
async function ingestErrorIncidents(): Promise<void> {
  for (const hit of sink.drainErrors()) {
    const victims = hit.victims.length ? hit.victims.join(', ') : '匿名'
    const message = `${hit.endpoint} 返回 ${hit.status}（${hit.count} 次,受影响: ${victims}）`
    // Open a new incident, or fold repeat hits into the open one.
    const upd = await pool.query(
      `UPDATE perf_alerts
          SET detail = jsonb_set(
                jsonb_set(coalesce(detail,'{}'::jsonb), '{count}',
                          to_jsonb(coalesce((detail->>'count')::int, 0) + $2)),
                '{lastAt}', to_jsonb($3::text)),
              message = $4
        WHERE kind = 'API_5XX' AND signature = $1 AND resolved_at IS NULL
        RETURNING id`,
      [hit.signature, hit.count, hit.lastAt, message]
    )
    if ((upd.rowCount ?? 0) > 0) continue

    const ins = await pool.query(
      `INSERT INTO perf_alerts (kind, severity, metric, threshold, window_s, message, signature, detail)
       VALUES ('API_5XX','error',$1,0,$2,$3,$4,$5) RETURNING id`,
      [
        hit.status, EVAL_WINDOW_S, message, hit.signature,
        JSON.stringify({
          endpoint: hit.endpoint, status: hit.status, count: hit.count,
          firstAt: hit.firstAt, lastAt: hit.lastAt,
          sampleUrl: hit.sampleUrl, victims: hit.victims,
        }),
      ]
    )
    const ok = await sendAlertEmail(
      `🚨 Pinzos 接口报错: ${hit.endpoint} → ${hit.status}`,
      `${message}\n\n请求: ${hit.sampleUrl}\n首次: ${hit.firstAt}\n\n` +
        `这条不会自动恢复——查清根因、修好之后到 dashboard 手动关闭。\n${APP_URL}/admin/analytics\n\n— 性能监控自动发出`
    )
    if (ok) await pool.query(`UPDATE perf_alerts SET emailed = true WHERE id = $1`, [ins.rows[0].id])
  }
}

/**
 * Persist every slow request (unsampled) and hand back the worst few, so the
 * HIGH_LATENCY alert can name the culprit instead of just quoting a percentile.
 *
 * Before this, a latency alert was undiagnosable after the fact: api_calls
 * samples and skips uncurated GETs (the heavy map endpoints were never in it),
 * morgan's log dies with the container, and the console breadcrumb only fired
 * above 10s. "p95 8673ms" with no way to learn which request — that is why none
 * of these alerts ever got a root cause.
 */
async function ingestSlowRequests(): Promise<sink.SlowHit[]> {
  const hits = sink.drainSlow()
  if (!hits.length) return []
  const values: unknown[] = []
  const tuples = hits.map((h, i) => {
    const b = i * 6
    values.push(h.endpoint, h.url, h.status, h.ms, h.who, h.aborted)
    return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6})`
  })
  await pool.query(
    `INSERT INTO perf_slow_requests (endpoint, url, status, duration_ms, who, aborted)
     VALUES ${tuples.join(',')}`,
    values
  )
  return [...hits].sort((a, b) => b.ms - a.ms).slice(0, 3)
}

async function reconcileAlerts(rules: RuleResult[], hasTraffic: boolean): Promise<void> {
  // Current active (unresolved) STATE alerts keyed by kind. API_5XX incidents are
  // excluded: they are not state, they never auto-resolve, and several can be open
  // at once (one per endpoint).
  const { rows } = await pool.query(
    `SELECT id, kind FROM perf_alerts WHERE resolved_at IS NULL AND kind <> 'API_5XX'`
  )
  const active = new Map<string, number>()
  for (const r of rows) active.set(r.kind, Number(r.id))

  for (const rule of rules) {
    const isActive = active.has(rule.kind)
    if (rule.breached && !isActive) {
      // New breach → open alert + email.
      const ins = await pool.query(
        `INSERT INTO perf_alerts (kind, severity, metric, threshold, window_s, message)
         VALUES ($1,'warning',$2,$3,$4,$5) RETURNING id`,
        [rule.kind, rule.metric, rule.threshold, EVAL_WINDOW_S, rule.message]
      )
      const ok = await sendAlertEmail(
        `⚠️ Pinzos 性能告警: ${rule.kind}`,
        `${rule.message}\n\n时间: ${new Date().toISOString()}\n查看: ${APP_URL}/dashboard\n\n— 性能监控自动发出`
      )
      if (ok) {
        await pool.query(`UPDATE perf_alerts SET emailed = true WHERE id = $1`, [ins.rows[0].id])
      }
    } else if (!rule.breached && isActive && hasTraffic) {
      // Recovered → resolve + email. `hasTraffic` is the point: without it, an
      // empty 3-min window (nobody on the site) reads as "not breached" and
      // silently closes the alert. Every HIGH_LATENCY alert this week "recovered"
      // that way — the site just went quiet, the 8.8s query was still there.
      // Recovery now has to be demonstrated under real traffic, or not at all.
      await pool.query(`UPDATE perf_alerts SET resolved_at = now() WHERE id = $1`, [active.get(rule.kind)])
      await sendAlertEmail(
        `✅ Pinzos 性能恢复: ${rule.kind}`,
        `已恢复正常: ${rule.message}\n\n时间: ${new Date().toISOString()}\n\n— 性能监控自动发出`
      )
    }
  }
}

let timer: NodeJS.Timeout | null = null

async function tick(): Promise<void> {
  try {
    const w = sink.window(EVAL_WINDOW_S)
    const ps = poolStats()
    await flushMinute(sink.window(60), ps)
    await ingestErrorIncidents()
    const worst = await ingestSlowRequests()
    // A window with too few requests proves nothing — it can't clear an alert.
    await reconcileAlerts(evaluateRules(w, ps, worst), w.req >= 5)
  } catch (err) {
    console.error('[perfMonitor] tick failed:', err)
  }
}

/** Start the 60s rollup/alert loop. Idempotent. */
export function startPerfFlusher(): void {
  if (timer) return
  timer = setInterval(tick, 60_000)
  // Don't keep the event loop alive solely for this.
  if (typeof timer.unref === 'function') timer.unref()
  console.log('📈 Perf monitor started (60s rollups + threshold alerts)')
}

export function stopPerfFlusher(): void {
  if (timer) { clearInterval(timer); timer = null }
}

// ── Read helpers for the Admin dashboard ────────────────────────────────────

/** Live in-memory snapshot: 1-min + 3-min windows + current pool state. */
export function getPerfSnapshot() {
  return {
    now: new Date().toISOString(),
    last1m: sink.window(60),
    last3m: sink.window(EVAL_WINDOW_S),
    pool: poolStats(),
    thresholds: { p95_ms: P95_MS, err_pct: ERR_PCT, slowq_3min: SLOWQ_3MIN, pool_wait: POOL_WAIT },
  }
}

/** Per-endpoint usage + latency table (last `minutes`), busiest first. */
export function getEndpointStats(minutes = 5) {
  return sink.endpoints(minutes)
}

/** Recent minute rollups (newest first) for the trend charts. */
export async function getPerfRollups(minutes = 180) {
  const { rows } = await pool.query(
    `SELECT minute, req, err4, err5, slow_req, query_count, slow_query,
            p50, p95, p99, max_ms, peak_concurrency, pool_total, pool_waiting
       FROM perf_minute
      WHERE minute >= now() - ($1 || ' minutes')::interval
      ORDER BY minute ASC`,
    [String(Math.min(1440, Math.max(1, minutes)))]
  )
  return rows.map((r) => ({
    minute: r.minute,
    req: Number(r.req),
    err4: Number(r.err4),
    err5: Number(r.err5),
    slow_req: Number(r.slow_req),
    query_count: Number(r.query_count),
    slow_query: Number(r.slow_query),
    p50: Number(r.p50),
    p95: Number(r.p95),
    p99: Number(r.p99),
    max_ms: Number(r.max_ms),
    peak_concurrency: Number(r.peak_concurrency),
    pool_total: Number(r.pool_total),
    pool_waiting: Number(r.pool_waiting),
  }))
}

/** Recent alerts (active + recently resolved), newest first. */
export async function getRecentAlerts(limit = 50) {
  const { rows } = await pool.query(
    `SELECT id, created_at, resolved_at, kind, severity, metric, threshold, window_s, message, emailed,
            signature, detail
       FROM perf_alerts
      ORDER BY (resolved_at IS NULL) DESC, created_at DESC
      LIMIT $1`,
    [Math.min(200, Math.max(1, limit))]
  )
  return rows.map((r) => ({
    id: Number(r.id),
    created_at: r.created_at,
    resolved_at: r.resolved_at,
    kind: r.kind as string,
    severity: r.severity as string,
    metric: r.metric != null ? Number(r.metric) : null,
    threshold: r.threshold != null ? Number(r.threshold) : null,
    window_s: r.window_s != null ? Number(r.window_s) : null,
    message: r.message as string,
    emailed: !!r.emailed,
    signature: (r.signature as string) || null,
    detail: r.detail || null,
    active: r.resolved_at == null,
  }))
}

/** Slow requests (unsampled, with the real URL and who waited), newest first. */
export async function getSlowRequests(limit = 50) {
  const { rows } = await pool.query(
    `SELECT at, endpoint, url, status, duration_ms, who, aborted
       FROM perf_slow_requests
      ORDER BY at DESC
      LIMIT $1`,
    [Math.min(200, Math.max(1, limit))]
  )
  return rows.map((r) => ({
    at: r.at,
    endpoint: r.endpoint as string,
    url: r.url as string | null,
    status: r.status as number | null,
    duration_ms: Number(r.duration_ms),
    who: r.who as string | null,
    aborted: !!r.aborted,
  }))
}

/** Just the currently-firing alerts — drives the red banner (kept light). */
export async function getActiveAlerts() {
  const { rows } = await pool.query(
    `SELECT id, created_at, kind, message FROM perf_alerts
      WHERE resolved_at IS NULL ORDER BY created_at DESC`
  )
  return rows.map((r) => ({
    id: Number(r.id),
    created_at: r.created_at,
    kind: r.kind as string,
    message: r.message as string,
  }))
}

/** Manually resolve an alert from the dashboard. */
export async function ackAlert(id: number): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE perf_alerts SET resolved_at = now() WHERE id = $1 AND resolved_at IS NULL`,
    [id]
  )
  return (rowCount ?? 0) > 0
}
