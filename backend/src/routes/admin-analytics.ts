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
import { getCollabSessions, getCollabReport } from '../services/collabReport'

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

// Unique visitors in the window (each = one browser/visitor_id) + intent score.
router.get('/visitors', wrap((req) => q.getVisitors(range(req), Math.min(500, Number(req.query.limit) || 200))))

// One visitor's full timeline + prediction profile.
router.get('/visitors/:id', wrap(async (req) => {
  const visitor = await q.getVisitorDetail(String(req.params.id))
  return { visitor }
}))

router.get('/sessions', wrap((req) =>
  q.getLunaSessions(Math.min(200, Number(req.query.limit) || 50), Math.max(0, Number(req.query.offset) || 0))
))

router.get('/sessions/:id', wrap(async (req) => {
  const session = await q.getLunaSession(String(req.params.id))
  return { session }
}))

// ── 实时带看(collab)意向报告 ─────────────────────────
router.get('/collab', wrap((req) =>
  getCollabSessions(Math.min(200, Number(req.query.limit) || 50), Math.max(0, Number(req.query.offset) || 0))
))

router.get('/collab/:code', wrap(async (req) => {
  const report = await getCollabReport(String(req.params.code))
  return { report }
}))

export default router
