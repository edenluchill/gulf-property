/**
 * Owner-only analytics dashboard API.
 *
 * Mounted at /api/admin/analytics. Every route is gated by requireAuth +
 * requireOwner (email allow-list — see middleware/requireOwner.ts). Thin: just
 * parses the [from,to] window and delegates to services/analyticsQueries.ts.
 */
import { Router, Request, Response } from 'express'
import { optionalAuth } from '../middleware/auth'
import { requireOwner } from '../middleware/requireOwner'
import * as q from '../services/analyticsQueries'
import { summarizeLunaSession } from '../services/lunaSummary'
import { getCollabSessions, getCollabReport } from '../services/collabReport'
import * as perf from '../services/perfMonitor'
import * as tq from '../services/telemetryQueries'
import { getAgentRuns, getAgentClientsOverview } from '../services/agentRuns'
import { getRevenueShare, settleMonth, unsettleMonth } from '../services/revenueShare'
import {
  getSubscribers, getSubscriptionSummary, getTourScripts, getSalesOffers, getBuyerReports,
} from '../services/adminBizQueries'

const router = Router()

// optionalAuth (not requireAuth) attaches a verified Supabase user when present
// but never blocks — so the dashboard-secret path works without a token.
// requireOwner is the sole, fail-closed gate.
router.use(optionalAuth, requireOwner)

/** Resolve [from,to] from query (?from&to ISO, or ?days=N). Default last 30d. */
function range(req: Request): q.Range {
  const now = Date.now()
  const days = Math.min(365, Math.max(1, Number(req.query.days) || 30))
  const from = typeof req.query.from === 'string' ? req.query.from : new Date(now - days * 86_400_000).toISOString()
  const to = typeof req.query.to === 'string' ? req.query.to : new Date(now).toISOString()
  return { from, to }
}

function wrap(fn: (req: Request) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      res.json({ success: true, data: await fn(req) })
    } catch (err) {
      console.error('[admin-analytics] query failed:', err)
      res.status(500).json({ success: false, error: 'query failed' })
    }
  }
}

router.get('/overview', wrap(async (req) => {
  const r = range(req)
  const [overview, daily] = await Promise.all([q.getOverview(r), q.getDailyVisitors(r)])
  return { overview, daily }
}))

router.get('/searches', wrap(async (req) => {
  const r = range(req)
  const [terms, projects, recent] = await Promise.all([
    q.getTopSearches(r), q.getTopProjects(r), q.getRecentSearches(r),
  ])
  return { terms, projects, recent }
}))

router.get('/timeseries', wrap((req) =>
  q.getTimeseries(range(req), String(req.query.event || 'search'), String(req.query.granularity || 'day'))
))

router.get('/luna', wrap((req) => q.getLunaStats(range(req))))

router.get('/tutorial', wrap((req) => q.getTutorialFunnel(range(req))))

router.get('/leads', wrap((req) => q.getLeads(Math.min(500, Number(req.query.limit) || 100))))

// Customers we're losing — high-intent visitors gone silent, with churn reasons.
router.get('/lost', wrap((req) => q.getLostCustomers(Math.min(500, Number(req.query.limit) || 100))))

// Unique visitors in the window (each = one browser/visitor_id) + intent score.
router.get('/visitors', wrap((req) => q.getVisitors(range(req), Math.min(500, Number(req.query.limit) || 200))))

// One visitor's full timeline + prediction profile.
router.get('/visitors/:id', wrap(async (req) => {
  const visitor = await q.getVisitorDetail(String(req.params.id))
  return { visitor }
}))

router.get('/sessions', wrap((req) =>
  q.getLunaSessions(
    Math.min(200, Number(req.query.limit) || 50),
    Math.max(0, Number(req.query.offset) || 0),
    {
      errored: req.query.errored === '1' || req.query.errored === 'true',
      visitorId: typeof req.query.visitorId === 'string' ? req.query.visitorId : undefined,
      q: typeof req.query.q === 'string' ? req.query.q : undefined,
      tool: typeof req.query.tool === 'string' ? req.query.tool : undefined,
    }
  )
))

router.get('/sessions/:id', wrap(async (req) => {
  const session = await q.getLunaSession(String(req.params.id))
  // Lazy-generate + cache the AI synopsis on first open for older sessions that
  // predate write-time summarization. Best-effort; never blocks the response.
  if (session && !session.summary) {
    const summary = await summarizeLunaSession(session.transcript).catch(() => null)
    if (summary) {
      session.summary = summary
      q.saveLunaSummary(session.session_id, summary).catch(() => {})
    }
  }
  return { session }
}))

// Backfill AI summaries for sessions that have none yet (≤30/call). Owner-triggered.
router.post('/sessions/backfill-summaries', wrap(async () => ({
  generated: await q.backfillLunaSummaries(30),
})))

// ── 错误监控(auth_failure + api_error)─────────────────
router.get('/errors', wrap(async (req) => {
  const r = range(req)
  const [overview, groups, recent] = await Promise.all([
    q.getErrorOverview(r),
    q.getErrorGroups(r, Math.min(100, Number(req.query.groups) || 40)),
    q.getRecentErrors(r, Math.min(300, Number(req.query.limit) || 100)),
  ])
  return { overview, groups, recent }
}))

// Fault-recovery loop: real customers who hit an error recently — reach out now.
router.get('/error-impact', wrap((req) => q.getErrorImpact(Math.min(168, Number(req.query.hours) || 48))))

// What the autonomous cx-guardian agent did each patrol (transparency).
router.get('/agent-runs', wrap((req) => getAgentRuns(Math.min(200, Number(req.query.limit) || 50))))

// Owner-only cross-agent view of every agent's clients (admin can see all).
router.get('/agent-clients', wrap((req) => getAgentClientsOverview(Math.min(1000, Number(req.query.limit) || 500))))

// ── 实时带看(collab)意向报告 ─────────────────────────
router.get('/collab', wrap((req) =>
  getCollabSessions(Math.min(200, Number(req.query.limit) || 50), Math.max(0, Number(req.query.offset) || 0))
))

router.get('/collab/:code', wrap(async (req) => {
  const report = await getCollabReport(String(req.params.code))
  return { report }
}))

// ── 订阅客户(B 端:谁订阅了我们)+ 功能记录 ─────────────────
router.get('/subscribers', wrap(async () => ({
  subscribers: await getSubscribers(),
  summary: await getSubscriptionSummary(),
})))

router.get('/feature-log/tours', wrap((req) => getTourScripts(Math.min(300, Number(req.query.limit) || 100))))
router.get('/feature-log/sales-offers', wrap((req) => getSalesOffers(Math.min(300, Number(req.query.limit) || 100))))
router.get('/feature-log/reports', wrap((req) => getBuyerReports(Math.min(300, Number(req.query.limit) || 100))))

// ── 性能 / 负载监控 ───────────────────────────────────────
// Full panel: live in-memory snapshot + minute rollups + alert history.
router.get('/perf', wrap(async (req) => {
  const minutes = Math.min(1440, Math.max(5, Number(req.query.minutes) || 180))
  const [rollups, alerts, slow] = await Promise.all([
    perf.getPerfRollups(minutes),
    perf.getRecentAlerts(50),
    perf.getSlowRequests(50),
  ])
  return { live: perf.getPerfSnapshot(), rollups, alerts, slow, endpoints: perf.getEndpointStats(5) }
}))

// Lightweight — drives the dashboard red banner (polled frequently).
router.get('/perf/alerts/active', wrap(async () => ({ alerts: await perf.getActiveAlerts() })))

// Manually resolve an alert.
router.post('/perf/alerts/:id/ack', wrap(async (req) => ({
  ok: await perf.ackAlert(Number(req.params.id)),
})))

// ── 实时带看遥测(WS 之前 100% 全盲)── docs/telemetry-spec.md ────────────
// 一次给全:此刻现状 + 容量曲线 + 进房漏斗 + 客户端真实体验 + Agora 真金白银。
router.get('/telemetry/live-tour', wrap(async (req) => {
  const hours = Math.min(168, Math.max(1, Number(req.query.hours) || 24))
  const minutes = Math.min(1440, Math.max(30, Number(req.query.minutes) || 180))
  const [cpu, conns, fanout, funnel, rum, agora] = await Promise.all([
    tq.metricSeries('runtime.cpu.pct', minutes),
    tq.metricSeries('collab.ws.connections', minutes),
    tq.metricSeries('collab.fanout.msgs', minutes),
    tq.joinFunnel(hours),
    tq.rumSummary(hours),
    tq.agoraCost(30),
  ])
  return { live: tq.liveSnapshot(), series: { cpu, conns, fanout }, funnel, rum, agora }
}))

// ── 分成对账(FINDHOMEGO 25% / 运营方 75%,按 Stripe 实收净额)──────────
router.get('/revenue-share', wrap((req) =>
  getRevenueShare(Math.min(24, Math.max(1, Number(req.query.months) || 12)))
))

// 标记某月已线下转账结算(锁定当时的 Stripe 数字做快照)。
router.post('/revenue-share/settle', wrap((req) =>
  settleMonth(
    String(req.body?.month || ''),
    String(req.body?.currency || 'usd'),
    req.user?.email || null,
    req.body?.note ? String(req.body.note).slice(0, 500) : null,
  )
))

// 撤销结算标记(误点/转错)。
router.post('/revenue-share/unsettle', wrap(async (req) => {
  await unsettleMonth(String(req.body?.month || ''), String(req.body?.currency || 'usd'))
  return { ok: true }
}))

export default router
