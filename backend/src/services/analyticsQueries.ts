/**
 * Analytics queries — pure read functions for the owner dashboard.
 *
 * No req/res here; the route (routes/admin-analytics.ts) stays thin and just
 * maps HTTP → these functions. Every function takes an explicit [from, to]
 * window (ISO strings) so the route owns defaulting. See analytics spec §4.3.
 */
import pool from '../db/pool'
import { summarizeLunaSession } from './lunaSummary'

export interface Range {
  from: string
  to: string
}

// ── Non-customer traffic exclusion ───────────────────────────────────────────
// The owner dashboard is about REAL CUSTOMERS (prospective buyers). Two kinds of
// traffic are NOT customers and must never pollute leads / visitors / lost / errors:
//   1. Our own testing (~70% of raw events): owner + colleague test accounts.
//   2. Registered AGENTS/agencies/developers — they SELL homes, they are not leads.
//      (This is the fix for "付费经纪被当 lead 推给别的经纪" — an agent browsing the
//       map must not become a prospect. See docs/reports/2026-07-09-admin-dashboard-audit.md)
// INTERNAL_EMAILS = owner allow-list + explicit test accounts (env-tunable); the
// agent set is derived live from lt_agents + user_profiles (role <> 'buyer').
const INTERNAL_EMAILS = [
  ...(process.env.OWNER_EMAILS || 'lzp6529@gmail.com').split(','),
  ...(process.env.ANALYTICS_INTERNAL_EMAILS || 'shelldubai26@gmail.com,edenlu1995@gmail.com').split(','),
].map((s) => s.trim().toLowerCase()).filter(Boolean)

let _internalCache: { ids: string[]; at: number } | null = null
/**
 * Every visitor_id that has EVER been tied to a NON-CUSTOMER email — internal/test
 * accounts OR a registered agent/agency/developer — so even the pre-login anonymous
 * browsing of such a person (same browser, identified later) is excluded. Cached 60s;
 * effectively free per call. Empty array is safe: `visitor_id <> ALL('{}')` is TRUE,
 * i.e. excludes nothing. Name kept as `internalVisitorIds` for its many call sites;
 * semantically it now means "not a real customer".
 */
export async function internalVisitorIds(): Promise<string[]> {
  if (_internalCache && Date.now() - _internalCache.at < 60_000) return _internalCache.ids
  const { rows } = await pool.query(
    `SELECT DISTINCT visitor_id FROM app_events
      WHERE visitor_id IS NOT NULL AND (
        lower(user_email) = ANY($1::text[])
        OR lower(user_email) IN (SELECT lower(email) FROM lt_agents WHERE email IS NOT NULL)
        OR lower(user_email) IN (SELECT lower(email) FROM user_profiles
                                   WHERE role IS NOT NULL AND role <> 'buyer')
      )`,
    [INTERNAL_EMAILS]
  )
  const ids = rows.map((r) => r.visitor_id as string)
  _internalCache = { ids, at: Date.now() }
  return ids
}

/** Headline counters for the selected window (real customers only — internal excluded). */
export async function getOverview({ from, to }: Range) {
  const internal = await internalVisitorIds()
  const { rows } = await pool.query(
    `SELECT
        COUNT(*)                                   AS events,
        COUNT(DISTINCT visitor_id)                 AS visitors,
        COUNT(*) FILTER (WHERE event_type = 'search')        AS searches,
        COUNT(*) FILTER (WHERE event_type = 'property_view') AS property_views,
        COUNT(*) FILTER (WHERE event_type = 'luna_open')     AS luna_opens,
        COUNT(*) FILTER (WHERE event_type = 'favorite_toggle' AND payload->>'action' = 'add') AS favorites,
        COUNT(*) FILTER (WHERE event_type = 'contact_attempt') AS contacts
       FROM app_events
      WHERE created_at >= $1 AND created_at < $2
        AND visitor_id <> ALL($3::text[])`,
    [from, to, internal]
  )
  const leads = await pool.query(
    `SELECT COUNT(*) AS total,
            COUNT(*) FILTER (WHERE created_at >= $1 AND created_at < $2) AS new_in_range
       FROM leads
      WHERE visitor_id <> ALL($3::text[])`,
    [from, to, internal]
  )
  const luna = await pool.query(
    `SELECT COUNT(*) AS sessions
       FROM luna_sessions
      WHERE created_at >= $1 AND created_at < $2
        AND (visitor_id IS NULL OR visitor_id <> ALL($3::text[]))`,
    [from, to, internal]
  )
  const r = rows[0]
  return {
    events: Number(r.events),
    visitors: Number(r.visitors),
    searches: Number(r.searches),
    property_views: Number(r.property_views),
    luna_opens: Number(r.luna_opens),
    favorites: Number(r.favorites),
    contacts: Number(r.contacts),
    luna_sessions: Number(luna.rows[0].sessions),
    leads_total: Number(leads.rows[0].total),
    leads_new: Number(leads.rows[0].new_in_range),
  }
}

/** Distinct visitors + events per day, for the trend chart. */
export async function getDailyVisitors({ from, to }: Range) {
  const internal = await internalVisitorIds()
  const { rows } = await pool.query(
    `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
            COUNT(DISTINCT visitor_id) AS visitors,
            COUNT(*)                   AS events
       FROM app_events
      WHERE created_at >= $1 AND created_at < $2
        AND visitor_id <> ALL($3::text[])
      GROUP BY 1 ORDER BY 1`,
    [from, to, internal]
  )
  return rows.map((r) => ({ day: r.day, visitors: Number(r.visitors), events: Number(r.events) }))
}

const GRANULARITIES = new Set(['day', 'week', 'month'])
const TIMESERIES_EVENTS = new Set(['search', 'property_view', 'page_view', 'luna_open'])

/** Event counts bucketed by day/week/month — for the volume chart. */
export async function getTimeseries(
  { from, to }: Range,
  eventType: string,
  granularity: string
) {
  const gran = GRANULARITIES.has(granularity) ? granularity : 'day'
  const evt = TIMESERIES_EVENTS.has(eventType) ? eventType : 'search'
  const internal = await internalVisitorIds()
  const { rows } = await pool.query(
    `SELECT to_char(date_trunc($3, created_at), 'YYYY-MM-DD') AS bucket,
            COUNT(*) AS count
       FROM app_events
      WHERE event_type = $4 AND created_at >= $1 AND created_at < $2
        AND visitor_id <> ALL($5::text[])
      GROUP BY 1 ORDER BY 1`,
    [from, to, gran, evt, internal]
  )
  return { event: evt, granularity: gran, points: rows.map((r) => ({ bucket: r.bucket, count: Number(r.count) })) }
}

/** Individual recent searches (what was actually searched + when + who). */
export async function getRecentSearches({ from, to }: Range, limit = 60) {
  const internal = await internalVisitorIds()
  const { rows } = await pool.query(
    `SELECT created_at, payload->>'query' AS query, payload->>'kind' AS kind, visitor_id
       FROM app_events
      WHERE event_type = 'search'
        AND created_at >= $1 AND created_at < $2
        AND COALESCE(payload->>'query','') <> ''
        AND visitor_id <> ALL($4::text[])
      ORDER BY created_at DESC LIMIT $3`,
    [from, to, limit, internal]
  )
  return rows
}

/** Top committed search terms. */
export async function getTopSearches({ from, to }: Range, limit = 20) {
  const internal = await internalVisitorIds()
  const { rows } = await pool.query(
    `SELECT lower(payload->>'query') AS term, COUNT(*) AS count
       FROM app_events
      WHERE event_type = 'search'
        AND created_at >= $1 AND created_at < $2
        AND COALESCE(payload->>'query','') <> ''
        AND visitor_id <> ALL($4::text[])
      GROUP BY 1 ORDER BY count DESC LIMIT $3`,
    [from, to, limit, internal]
  )
  return rows.map((r) => ({ label: r.term, count: Number(r.count) }))
}

/** Most-viewed projects (joins project name). */
export async function getTopProjects({ from, to }: Range, limit = 20) {
  const internal = await internalVisitorIds()
  const { rows } = await pool.query(
    `SELECT e.project_id,
            COALESCE(rp.project_name, e.payload->>'project_name', 'Unknown') AS label,
            COUNT(*) AS count
       FROM app_events e
       LEFT JOIN residential_projects rp ON rp.id = e.project_id
      WHERE e.event_type = 'property_view'
        AND e.created_at >= $1 AND e.created_at < $2
        AND e.visitor_id <> ALL($4::text[])
      GROUP BY e.project_id, label
      ORDER BY count DESC LIMIT $3`,
    [from, to, limit, internal]
  )
  return rows.map((r) => ({ id: r.project_id, label: r.label, count: Number(r.count) }))
}

/** Luna usage stats for the window. */
export async function getLunaStats({ from, to }: Range) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)                          AS sessions,
            COALESCE(ROUND(AVG(duration_ms)),0)     AS avg_duration_ms,
            COALESCE(ROUND(AVG(turn_count)),0)      AS avg_turns,
            COALESCE(SUM(tool_call_count),0)        AS total_tool_calls,
            COUNT(*) FILTER (WHERE had_error)       AS error_sessions
       FROM luna_sessions
      WHERE created_at >= $1 AND created_at < $2`,
    [from, to]
  )
  const r = rows[0]
  return {
    sessions: Number(r.sessions),
    avg_duration_ms: Number(r.avg_duration_ms),
    avg_turns: Number(r.avg_turns),
    total_tool_calls: Number(r.total_tool_calls),
    error_sessions: Number(r.error_sessions),
  }
}

/** Tutorial funnel: reach count per step (works once tutorial_step is emitted). */
export async function getTutorialFunnel({ from, to }: Range) {
  const internal = await internalVisitorIds()
  const { rows } = await pool.query(
    `SELECT payload->>'step' AS step, COUNT(DISTINCT visitor_id) AS visitors
       FROM app_events
      WHERE event_type = 'tutorial_step'
        AND created_at >= $1 AND created_at < $2
        AND payload->>'step' IS NOT NULL
        AND visitor_id <> ALL($3::text[])
      GROUP BY 1 ORDER BY MIN(created_at)`,
    [from, to, internal]
  )
  return rows.map((r) => ({ step: r.step, visitors: Number(r.visitors) }))
}

/** Leads, hottest first. Excludes non-customers (internal + registered agents). */
export async function getLeads(limit = 100) {
  const internal = await internalVisitorIds()
  const { rows } = await pool.query(
    `SELECT id, created_at, visitor_id, name, email, phone, whatsapp,
            source, intent, lead_score, status, last_seen_at
       FROM leads
      WHERE visitor_id <> ALL($2::text[])
      ORDER BY lead_score DESC, created_at DESC
      LIMIT $1`,
    [limit, internal]
  )
  return rows
}

// ── Per-visitor drill-down (who they are + what they did + a prediction) ─────

// Lead-style intent score from raw counts (mirrors services/leadScoring weights).
// Now intent-aware: a saved project or a contact tap weighs far more than a view,
// and deep data research (api_calls hits the visitor never explicitly "did") adds
// a smaller signal. All inputs optional so older callers keep working.
interface ScoreInput {
  views: number; searches: number; luna: number; hasContact: boolean
  favorites?: number; contacts?: number; reports?: number; research?: number
}
function quickScore(i: ScoreInput): number {
  let s = 0
  if (i.hasContact) s += 25
  s += Math.min(i.views, 5) * 6
  if (i.luna > 0) s += 12
  s += Math.min(i.searches, 5) * 4
  s += Math.min(i.contacts ?? 0, 3) * 18   // contact_attempt = the strongest intent
  s += Math.min(i.favorites ?? 0, 5) * 8    // saved a project = strong
  s += Math.min(i.reports ?? 0, 2) * 8      // generated / shared a report
  s += Math.min(i.research ?? 0, 10) * 1.5  // deep data research (insights/market api_calls)
  return Math.round(s)
}
// hot / warm / cooling / cold / lost from score + recency. 'lost' = a visitor who
// HAD real intent (warm+) but has since gone quiet for weeks — the ones worth
// winning back, surfaced by getLostCustomers.
function stageFrom(score: number, lastSeen: string): 'hot' | 'warm' | 'cooling' | 'cold' | 'lost' {
  const ageDays = (Date.now() - new Date(lastSeen).getTime()) / 86_400_000
  if (score >= 40 && ageDays <= 7) return 'hot'
  if (score >= 18) {
    if (ageDays > 30) return 'lost'
    return ageDays <= 14 ? 'warm' : 'cooling'
  }
  return 'cold'
}

/** One row per UNIQUE visitor in the window, with an intent score + stage. */
export async function getVisitors({ from, to }: Range, limit = 200) {
  // Merge by IDENTITY = COALESCE(user_email, visitor_id): one logged-in person
  // browsing from several devices/browsers used to show up as several rows with
  // the same email. We collapse those into a single row (summing activity) and
  // report how many browsers it spans. Anonymous visitors (no email) stay keyed
  // by their own visitor_id. `identity` is what the drill-down is fetched by.
  const internal = await internalVisitorIds()
  const { rows } = await pool.query(
    `WITH per_visitor AS (
        SELECT
          e.visitor_id,
          MAX(e.user_email)                                                   AS user_email,
          MIN(e.created_at)                                                   AS first_seen,
          MAX(e.created_at)                                                   AS last_seen,
          COUNT(*)                                                            AS events,
          COUNT(*) FILTER (WHERE e.event_type = 'property_view')              AS views,
          COUNT(*) FILTER (WHERE e.event_type = 'search')                     AS searches,
          COUNT(*) FILTER (WHERE e.event_type = 'luna_open')                  AS luna_opens,
          COUNT(*) FILTER (WHERE e.event_type = 'favorite_toggle' AND e.payload->>'action' = 'add') AS favorites,
          COUNT(*) FILTER (WHERE e.event_type = 'contact_attempt')            AS contacts,
          COUNT(*) FILTER (WHERE e.event_type = 'report_action')              AS reports,
          COUNT(DISTINCT e.project_id) FILTER (WHERE e.project_id IS NOT NULL) AS distinct_projects
         FROM app_events e
        WHERE e.created_at >= $1 AND e.created_at < $2
          AND e.visitor_id IS NOT NULL
          AND e.visitor_id <> ALL($3::text[])
        GROUP BY e.visitor_id
      )
      SELECT
        COALESCE(user_email, visitor_id)                       AS identity,
        MAX(user_email)                                        AS user_email,
        (ARRAY_AGG(visitor_id ORDER BY last_seen DESC))[1]     AS visitor_id,
        MIN(first_seen)                                        AS first_seen,
        MAX(last_seen)                                         AS last_seen,
        SUM(events)                                            AS events,
        SUM(views)                                             AS views,
        SUM(searches)                                          AS searches,
        SUM(luna_opens)                                        AS luna_opens,
        SUM(favorites)                                         AS favorites,
        SUM(contacts)                                          AS contacts,
        SUM(reports)                                           AS reports,
        SUM(distinct_projects)                                 AS distinct_projects,
        COUNT(*)                                               AS browser_count
       FROM per_visitor
      GROUP BY COALESCE(user_email, visitor_id)`,
    [from, to, internal]
  )
  return rows
    .map((r) => {
      const views = Number(r.views), searches = Number(r.searches), luna = Number(r.luna_opens)
      const favorites = Number(r.favorites), contacts = Number(r.contacts), reports = Number(r.reports)
      const score = quickScore({ views, searches, luna, hasContact: !!r.user_email || contacts > 0, favorites, contacts, reports })
      return {
        identity: r.identity as string,
        visitor_id: r.visitor_id as string,
        user_email: (r.user_email as string) || null,
        browser_count: Number(r.browser_count),
        first_seen: r.first_seen,
        last_seen: r.last_seen,
        events: Number(r.events),
        views, searches, luna_opens: luna,
        favorites, contacts,
        distinct_projects: Number(r.distinct_projects),
        score,
        stage: stageFrom(score, r.last_seen),
      }
    })
    .sort((a, b) => b.score - a.score || new Date(b.last_seen).getTime() - new Date(a.last_seen).getTime())
    .slice(0, limit)
}

/** Full per-visitor profile: ordered timeline + a derived intent prediction. */
export async function getVisitorDetail(visitorId: string) {
  const [ev, lunaRes, leadRes, apiRes] = await Promise.all([
    pool.query(
      // Match by identity: $1 is either an email (merge all the person's
      // browsers) or a single anonymous visitor_id. The OR makes both work.
      `SELECT e.created_at, e.event_type, e.project_id, e.payload, e.path, e.session_id, e.user_email,
              rp.project_name, rp.area AS project_area, rp.min_price, rp.max_price
         FROM app_events e
         LEFT JOIN residential_projects rp ON rp.id = e.project_id
        WHERE (e.visitor_id = $1 OR e.user_email = $1)
        ORDER BY e.created_at ASC
        LIMIT 1000`,
      [visitorId]
    ),
    pool.query(
      `SELECT session_id, created_at, duration_ms, turn_count, tool_call_count, had_error, summary
         FROM luna_sessions WHERE (visitor_id = $1 OR user_email = $1) ORDER BY created_at DESC LIMIT 20`,
      [visitorId]
    ),
    pool.query(
      `SELECT name, email, phone, whatsapp, source, lead_score, status, last_seen_at
         FROM leads WHERE (visitor_id = $1 OR email = $1) ORDER BY lead_score DESC LIMIT 1`,
      [visitorId]
    ),
    // Server-side attribution: the data this person actually fetched. Folded into
    // the timeline (intent layer wins) but the calls with no matching intent event
    // surface as "implicit research" — the silent high-intent signal app_events misses.
    pool.query(
      `SELECT created_at, method, path, status, duration_ms
         FROM api_calls WHERE (visitor_id = $1 OR user_email = $1)
        ORDER BY created_at ASC LIMIT 1000`,
      [visitorId]
    ),
  ])

  const rows = ev.rows
  if (!rows.length) return null

  // Aggregate the behaviour into a prediction profile.
  const viewedMap = new Map<string, { id: string; name: string; area: string | null; minPrice: number | null; maxPrice: number | null; count: number }>()
  const areaCount = new Map<string, number>()
  const searchTerms: string[] = []
  let views = 0, searches = 0, luna = 0, favorites = 0, contacts = 0, reports = 0
  let userEmail: string | null = null

  for (const r of rows) {
    if (r.user_email) userEmail = r.user_email
    if (r.event_type === 'property_view') {
      views++
      if (r.project_id) {
        const key = r.project_id
        const prev = viewedMap.get(key)
        const name = r.project_name || r.payload?.project_name || 'Unknown'
        const area = r.project_area || r.payload?.area || null
        if (prev) prev.count++
        else viewedMap.set(key, { id: key, name, area, minPrice: r.min_price != null ? Number(r.min_price) : null, maxPrice: r.max_price != null ? Number(r.max_price) : null, count: 1 })
        if (area) areaCount.set(area, (areaCount.get(area) || 0) + 1)
      }
    } else if (r.event_type === 'search') {
      searches++
      const q = r.payload?.query
      if (typeof q === 'string' && q.trim()) searchTerms.push(q.trim())
      const a = r.payload?.area
      if (typeof a === 'string' && a.trim()) areaCount.set(a.trim(), (areaCount.get(a.trim()) || 0) + 1)
    } else if (r.event_type === 'luna_open') {
      luna++
    } else if (r.event_type === 'favorite_toggle') {
      if (r.payload?.action === 'add') favorites++
    } else if (r.event_type === 'contact_attempt') {
      contacts++
    } else if (r.event_type === 'report_action') {
      reports++
    }
  }

  // "Implicit research" = business-data api_calls (insights/market/compare) that
  // have NO matching intent event within a 2s window → folded out of the noise,
  // kept as a signal of how deep this person dug without leaving an explicit mark.
  const apiRows = apiRes.rows as Array<{ created_at: string; method: string; path: string; status: number; duration_ms: number }>
  const eventTimes = rows.map((r) => new Date(r.created_at).getTime())
  const FOLD_MS = 2000
  const isBusinessRead = (p: string) => /\/api\/(market\/|compare|residential-projects\/[0-9a-f-]{36})/.test(p)
  const implicitApi = apiRows.filter((a) => {
    if (a.method !== 'GET' || !isBusinessRead(a.path)) return false  // actions already have intent rows
    const t = new Date(a.created_at).getTime()
    return !eventTimes.some((et) => Math.abs(et - t) <= FOLD_MS)       // fold those behind a tracked action
  })
  const research = implicitApi.length

  const viewedProjects = [...viewedMap.values()].sort((a, b) => b.count - a.count)
  const topAreas = [...areaCount.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
  const prices = viewedProjects.map((p) => p.minPrice).filter((n): n is number => n != null && n > 0).sort((a, b) => a - b)
  const budget = prices.length
    ? { min: prices[0], max: viewedProjects.map((p) => p.maxPrice ?? p.minPrice).filter((n): n is number => n != null).sort((a, b) => a - b).slice(-1)[0] ?? prices[prices.length - 1], median: prices[Math.floor(prices.length / 2)] }
    : null

  const hasContact = !!(leadRes.rows[0]?.email || leadRes.rows[0]?.phone || leadRes.rows[0]?.whatsapp || userEmail || contacts > 0)
  const score = quickScore({ views, searches, luna, hasContact, favorites, contacts, reports, research })
  const lastSeen = rows[rows.length - 1].created_at
  const stage = stageFrom(score, lastSeen)

  // A human label for an implicit (folded-out) api_call.
  const apiLabel = (p: string): string => {
    if (/\/insights/.test(p)) return '研究项目投资数据'
    if (/\/transactions/.test(p)) return '查看成交记录'
    if (/\/market\//.test(p)) return '查看区域行情'
    if (/\/compare/.test(p)) return '对比房源'
    if (/\/residential-projects\/[0-9a-f-]{36}/.test(p)) return '调取项目详情'
    return '数据请求'
  }
  // Unified, smart-folded timeline: explicit intent events + the implicit api
  // research that had no matching intent event. Same shape (null-filled) so the
  // client renders one stream; `source` tells intent ('做了什么') from api ('查了什么').
  const intentTimeline = rows.map((r) => ({
    at: r.created_at as string, source: 'intent' as const, type: r.event_type as string,
    projectId: r.project_id || null,
    projectName: r.project_name || r.payload?.project_name || null,
    area: r.project_area || r.payload?.area || null,
    query: r.payload?.query || null,
    kind: r.payload?.kind || null,
    action: r.payload?.action || null,            // favorite add/remove · report generate · tab name
    contactType: r.payload?.contact_type || null, // whatsapp / phone / form_request
    path: r.path || null, label: null as string | null, method: null as string | null, status: null as number | null,
  }))
  const apiTimeline = implicitApi.map((a) => ({
    at: a.created_at, source: 'api' as const, type: 'api_access',
    projectId: null, projectName: null, area: null, query: null, kind: null, action: null, contactType: null,
    path: a.path, label: apiLabel(a.path), method: a.method, status: a.status,
  }))
  const timeline = [...intentTimeline, ...apiTimeline]
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())

  return {
    visitor_id: visitorId,
    user_email: userEmail,
    first_seen: rows[0].created_at,
    last_seen: lastSeen,
    counts: { events: rows.length, views, searches, luna, favorites, contacts, reports, research },
    contact: leadRes.rows[0] || null,
    score,
    stage,
    prediction: {
      budget,
      topAreas: topAreas.slice(0, 6),
      viewedProjects: viewedProjects.slice(0, 12),
      searchTerms: [...new Set(searchTerms)].slice(0, 12),
      usedLuna: luna > 0,
      hasContact,
    },
    lunaSessions: lunaRes.rows,
    timeline,
  }
}

/**
 * Customers we are losing / have lost — visitors who showed real intent but have
 * since gone quiet. Lifetime aggregates (not windowed) keyed by identity; each
 * carries WHY we're likely losing them so the owner knows how to win them back:
 *   • bug_hit   — hit an api_error/auth_failure right before going silent ⭐ the
 *                 actionable one: a failure (e.g. the area-insights 500) drove
 *                 them off. Fix + reach out.
 *   • no_contact — researched deeply (views/favorites) but never tried to contact
 *                 → the funnel broke at the last step.
 *   • cooling    — simply went quiet.
 */
export async function getLostCustomers(limit = 100) {
  const internal = await internalVisitorIds()
  const { rows } = await pool.query(
    `WITH per AS (
        SELECT visitor_id,
          MAX(user_email)                                                          AS user_email,
          MIN(created_at)                                                          AS first_seen,
          MAX(created_at)                                                          AS last_seen,
          COUNT(*) FILTER (WHERE event_type='property_view')                       AS views,
          COUNT(*) FILTER (WHERE event_type='search')                              AS searches,
          COUNT(*) FILTER (WHERE event_type='luna_open')                           AS luna,
          COUNT(*) FILTER (WHERE event_type='favorite_toggle' AND payload->>'action'='add') AS favorites,
          COUNT(*) FILTER (WHERE event_type='contact_attempt')                     AS contacts,
          COUNT(*) FILTER (WHERE event_type IN ('api_error','auth_failure'))       AS errors,
          MAX(created_at) FILTER (WHERE event_type IN ('api_error','auth_failure')) AS last_error_at
         FROM app_events
        WHERE visitor_id IS NOT NULL
          AND visitor_id <> ALL($1::text[])
        GROUP BY visitor_id
      )
      SELECT
        COALESCE(user_email, visitor_id)                   AS identity,
        MAX(user_email)                                    AS user_email,
        (ARRAY_AGG(visitor_id ORDER BY last_seen DESC))[1] AS visitor_id,
        MIN(first_seen)                                    AS first_seen,
        MAX(last_seen)                                     AS last_seen,
        SUM(views) AS views, SUM(searches) AS searches, SUM(luna) AS luna,
        SUM(favorites) AS favorites, SUM(contacts) AS contacts, SUM(errors) AS errors,
        MAX(last_error_at)                                 AS last_error_at
       FROM per
      GROUP BY COALESCE(user_email, visitor_id)
      HAVING MAX(last_seen) < now() - interval '7 days'`,  // silent ≥ 7 days
    [internal]
  )

  const out = rows
    .map((r) => {
      const views = Number(r.views), searches = Number(r.searches), luna = Number(r.luna)
      const favorites = Number(r.favorites), contacts = Number(r.contacts), errors = Number(r.errors)
      const score = quickScore({ views, searches, luna, hasContact: !!r.user_email || contacts > 0, favorites, contacts })
      const lastSeen = new Date(r.last_seen).getTime()
      const daysSilent = Math.floor((Date.now() - lastSeen) / 86_400_000)
      // Did a failure happen right before they vanished (within 1h of last activity)?
      const bugHit = errors > 0 && r.last_error_at != null &&
        Math.abs(lastSeen - new Date(r.last_error_at).getTime()) <= 3_600_000
      const reasons: string[] = []
      if (bugHit) reasons.push('bug_hit')
      if ((views >= 3 || favorites > 0) && contacts === 0) reasons.push('no_contact')
      if (reasons.length === 0) reasons.push('cooling')
      return {
        identity: r.identity as string,
        visitor_id: r.visitor_id as string,
        user_email: (r.user_email as string) || null,
        first_seen: r.first_seen, last_seen: r.last_seen,
        days_silent: daysSilent,
        views, searches, luna_opens: luna, favorites, contacts, errors,
        score, reasons,
      }
    })
    // Only those who actually showed intent — not every one-page bounce.
    .filter((v) => v.score >= 18 || v.views >= 2 || v.favorites > 0 || v.contacts > 0)
    .sort((a, b) => b.score - a.score || a.days_silent - b.days_silent)
  return out.slice(0, limit)
}

// Resolve identity for a session: prefer the row's own user_email, else the most
// recent email this visitor ever stamped on app_events (via /identify). Rescues
// historically anonymous sessions (voice-session is posted via sendBeacon, which
// can't carry an Authorization header → user_email is almost always NULL).
const EMAIL_JOIN = `LEFT JOIN LATERAL (
  SELECT user_email FROM app_events
   WHERE visitor_id = ls.visitor_id AND user_email IS NOT NULL
   ORDER BY created_at DESC LIMIT 1
) ae ON true`

// Last 6 of visitor_id, uppercase — the human-facing short handle (mirrors
// frontend Visitors.tsx shortId styling but keyed differently: last 6, not first 8).
const SHORT_ID = `UPPER(RIGHT(ls.visitor_id, 6))`

export interface LunaSessionFilters {
  errored?: boolean
  visitorId?: string
  q?: string
  tool?: string
}

/** Luna session list (no transcript — light) + resolved identity + summary. */
export async function getLunaSessions(limit = 50, offset = 0, filters: LunaSessionFilters = {}) {
  const where: string[] = []
  const params: unknown[] = []
  if (filters.errored) where.push('ls.had_error = true')
  if (filters.visitorId) {
    params.push(filters.visitorId)
    where.push(`ls.visitor_id = $${params.length}`)
  }
  if (filters.q && filters.q.trim()) {
    params.push(`%${filters.q.trim()}%`)
    where.push(`(ls.summary ILIKE $${params.length} OR ls.transcript::text ILIKE $${params.length})`)
  }
  if (filters.tool && filters.tool.trim()) {
    params.push(`%"name":"${filters.tool.trim()}"%`)
    where.push(`ls.transcript::text ILIKE $${params.length}`)
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  params.push(limit, offset)

  const { rows } = await pool.query(
    `SELECT ls.id, ls.session_id, ls.created_at, ls.visitor_id,
            COALESCE(ls.user_email, ae.user_email) AS email,
            ${SHORT_ID} AS short_id,
            ls.duration_ms, ls.turn_count, ls.tool_call_count, ls.had_error, ls.summary
       FROM luna_sessions ls
       ${EMAIL_JOIN}
      ${whereSql}
      ORDER BY ls.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  )
  return rows
}

/** Full transcript for one session (the conversation viewer) + resolved identity. */
export async function getLunaSession(sessionId: string) {
  const { rows } = await pool.query(
    `SELECT ls.id, ls.session_id, ls.created_at, ls.visitor_id,
            COALESCE(ls.user_email, ae.user_email) AS email,
            ${SHORT_ID} AS short_id,
            ls.user_email, ls.user_id,
            ls.started_at, ls.ended_at, ls.duration_ms, ls.turn_count, ls.tool_call_count,
            ls.had_error, ls.summary, ls.transcript
       FROM luna_sessions ls
       ${EMAIL_JOIN}
      WHERE ls.session_id = $1 LIMIT 1`,
    [sessionId]
  )
  return rows[0] || null
}

/** Persist a generated summary (best-effort; caller ignores failures). */
export async function saveLunaSummary(sessionId: string, summary: string): Promise<void> {
  await pool.query(
    `UPDATE luna_sessions SET summary = $1, summary_at = now() WHERE session_id = $2`,
    [summary, sessionId]
  )
}

/**
 * Backfill AI summaries for up to `limit` sessions that have none yet but carry
 * summarizable transcript content. Owner-triggered. Returns how many were written.
 */
export async function backfillLunaSummaries(limit = 30): Promise<number> {
  const { rows } = await pool.query(
    `SELECT session_id, transcript
       FROM luna_sessions
      WHERE summary IS NULL
        AND transcript IS NOT NULL
        AND transcript <> '{}'::jsonb
      ORDER BY created_at DESC
      LIMIT $1`,
    [Math.max(1, Math.min(30, limit))]
  )
  let generated = 0
  for (const row of rows) {
    try {
      const summary = await summarizeLunaSession(row.transcript)
      if (summary) {
        await saveLunaSummary(row.session_id, summary)
        generated++
      }
    } catch {
      /* skip this one, keep going */
    }
  }
  return generated
}

// ── Error monitoring (auth_failure + api_error) ─────────────────────────────
// All three read app_events filtered to the two error event_types. The frontend
// (lib/track.ts + lib/errorCapture.ts) stamps diagnostic fields into `payload`:
//   auth_failure: { provider, reason, code, has_hash, has_code, storage, origin }
//   api_error:    { url, endpoint, status, kind: 'network'|'http'|'timeout', method }

/** Headline error counters + a small daily trend for the window. */
export async function getErrorOverview({ from, to }: Range) {
  const internal = await internalVisitorIds()
  const { rows } = await pool.query(
    `SELECT
        COUNT(*) FILTER (WHERE event_type = 'auth_failure')                       AS auth_failures,
        COUNT(*) FILTER (WHERE event_type = 'api_error')                          AS api_errors,
        COUNT(DISTINCT visitor_id) FILTER (WHERE event_type = 'auth_failure')     AS affected_auth_visitors,
        COUNT(DISTINCT visitor_id) FILTER (WHERE event_type = 'api_error')        AS affected_api_visitors
       FROM app_events
      WHERE event_type IN ('auth_failure','api_error')
        AND created_at >= $1 AND created_at < $2
        AND COALESCE(payload->>'url', payload->>'endpoint', '') NOT LIKE '%/admin/analytics/%'
        AND visitor_id <> ALL($3::text[])`,
    [from, to, internal]
  )
  const daily = await pool.query(
    `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
            COUNT(*) FILTER (WHERE event_type = 'auth_failure') AS auth_failures,
            COUNT(*) FILTER (WHERE event_type = 'api_error')    AS api_errors
       FROM app_events
      WHERE event_type IN ('auth_failure','api_error')
        AND created_at >= $1 AND created_at < $2
        AND COALESCE(payload->>'url', payload->>'endpoint', '') NOT LIKE '%/admin/analytics/%'
        AND visitor_id <> ALL($3::text[])
      GROUP BY 1 ORDER BY 1`,
    [from, to, internal]
  )
  const r = rows[0]
  return {
    auth_failures: Number(r.auth_failures),
    api_errors: Number(r.api_errors),
    affected_auth_visitors: Number(r.affected_auth_visitors),
    affected_api_visitors: Number(r.affected_api_visitors),
    daily: daily.rows.map((d) => ({
      day: d.day,
      auth_failures: Number(d.auth_failures),
      api_errors: Number(d.api_errors),
    })),
  }
}

/**
 * Grouped error signatures — "the same broken thing" collapsed into one row so
 * a handful of recurring failures don't drown in noise. Signature:
 *   auth_failure → reason (or provider)
 *   api_error    → "METHOD endpoint → status" (path only, query stripped client-side)
 */
export async function getErrorGroups({ from, to }: Range, limit = 40) {
  const internal = await internalVisitorIds()
  const { rows } = await pool.query(
    `SELECT
        event_type,
        CASE WHEN event_type = 'auth_failure'
             THEN COALESCE(NULLIF(payload->>'reason',''), NULLIF(payload->>'provider',''), 'unknown')
             ELSE COALESCE(payload->>'method','GET') || ' '
                  || COALESCE(NULLIF(payload->>'endpoint',''), NULLIF(payload->>'url',''), '?')
                  || ' → ' || COALESCE(payload->>'status', payload->>'kind', '?')
        END AS signature,
        COUNT(*)                   AS count,
        COUNT(DISTINCT visitor_id) AS visitors,
        MAX(created_at)            AS last_seen,
        (ARRAY_AGG(payload->>'message' ORDER BY created_at DESC) FILTER (WHERE payload->>'message' IS NOT NULL))[1] AS sample_message
       FROM app_events
      WHERE event_type IN ('auth_failure','api_error')
        AND created_at >= $1 AND created_at < $2
        AND COALESCE(payload->>'url', payload->>'endpoint', '') NOT LIKE '%/admin/analytics/%'
        AND visitor_id <> ALL($4::text[])
      GROUP BY event_type, signature
      ORDER BY count DESC, last_seen DESC
      LIMIT $3`,
    [from, to, limit, internal]
  )
  return rows.map((r) => ({
    event_type: r.event_type as 'auth_failure' | 'api_error',
    signature: r.signature as string,
    count: Number(r.count),
    visitors: Number(r.visitors),
    last_seen: r.last_seen,
    sample_message: r.sample_message ?? null,
  }))
}

/** Most recent raw error events (the drill-down feed). */
export async function getRecentErrors({ from, to }: Range, limit = 100) {
  const internal = await internalVisitorIds()
  const { rows } = await pool.query(
    `SELECT id, created_at, event_type, visitor_id, user_email, path, ua, payload
       FROM app_events
      WHERE event_type IN ('auth_failure','api_error')
        AND created_at >= $1 AND created_at < $2
        AND COALESCE(payload->>'url', payload->>'endpoint', '') NOT LIKE '%/admin/analytics/%'
        AND visitor_id <> ALL($4::text[])
      ORDER BY created_at DESC
      LIMIT $3`,
    [from, to, limit, internal]
  )
  return rows.map((r) => ({
    id: Number(r.id),
    created_at: r.created_at,
    event_type: r.event_type as 'auth_failure' | 'api_error',
    visitor_id: r.visitor_id ?? null,
    user_email: r.user_email ?? null,
    path: r.path ?? null,
    ua: r.ua ?? null,
    payload: r.payload ?? {},
  }))
}

/**
 * Fault-recovery closed loop (策略 C2): the REAL customers who hit an error in the
 * last N hours, with their intent score + which bug they hit + contact info —
 * i.e. "reach out to these people NOW, before they churn". Distinct from
 * getLostCustomers (already gone, silent ≥7d): this is the act-now window so a
 * failure like the area-insights 500 doesn't silently cost us a hot lead.
 * Internal/test traffic + dashboard self-noise excluded.
 */
export async function getErrorImpact(hours = 48) {
  const internal = await internalVisitorIds()
  const { rows } = await pool.query(
    `WITH hit AS (
        SELECT DISTINCT visitor_id
          FROM app_events
         WHERE event_type IN ('api_error','auth_failure')
           AND created_at >= now() - make_interval(hours => $1)
           AND visitor_id IS NOT NULL
           AND visitor_id <> ALL($2::text[])
           AND COALESCE(payload->>'url', payload->>'endpoint', '') NOT LIKE '%/admin/analytics/%'
           AND COALESCE(payload->>'url', payload->>'endpoint', '') NOT LIKE '%/admin/insights/%'
      )
      SELECT e.visitor_id,
             MAX(e.user_email)                                                       AS user_email,
             MAX(e.created_at)                                                        AS last_seen,
             COUNT(*) FILTER (WHERE e.event_type='property_view')                     AS views,
             COUNT(*) FILTER (WHERE e.event_type='search')                            AS searches,
             COUNT(*) FILTER (WHERE e.event_type='luna_open')                         AS luna,
             COUNT(*) FILTER (WHERE e.event_type='favorite_toggle' AND e.payload->>'action'='add') AS favorites,
             COUNT(*) FILTER (WHERE e.event_type='contact_attempt')                   AS contacts,
             MAX(e.created_at) FILTER (WHERE e.event_type IN ('api_error','auth_failure')) AS last_error_at,
             (ARRAY_AGG(DISTINCT COALESCE(e.payload->>'url', e.payload->>'endpoint'))
                FILTER (WHERE e.event_type IN ('api_error','auth_failure')
                        AND COALESCE(e.payload->>'url', e.payload->>'endpoint','') <> ''))[1:3] AS error_urls
        FROM app_events e
        JOIN hit ON hit.visitor_id = e.visitor_id
       GROUP BY e.visitor_id`,
    [hours, internal]
  )
  return rows
    .map((r) => {
      const views = Number(r.views), searches = Number(r.searches), luna = Number(r.luna)
      const favorites = Number(r.favorites), contacts = Number(r.contacts)
      const score = quickScore({ views, searches, luna, hasContact: !!r.user_email || contacts > 0, favorites, contacts })
      return {
        identity: (r.user_email as string) || (r.visitor_id as string),
        visitor_id: r.visitor_id as string,
        user_email: (r.user_email as string) || null,
        last_seen: r.last_seen,
        last_error_at: r.last_error_at,
        error_urls: ((r.error_urls as string[]) || []).filter(Boolean),
        views, favorites, contacts, score,
      }
    })
    .sort((a, b) => b.score - a.score || new Date(b.last_error_at).getTime() - new Date(a.last_error_at).getTime())
}
