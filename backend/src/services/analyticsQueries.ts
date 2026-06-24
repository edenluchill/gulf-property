/**
 * Analytics queries — pure read functions for the owner dashboard.
 *
 * No req/res here; the route (routes/admin-analytics.ts) stays thin and just
 * maps HTTP → these functions. Every function takes an explicit [from, to]
 * window (ISO strings) so the route owns defaulting. See analytics spec §4.3.
 */
import pool from '../db/pool'

export interface Range {
  from: string
  to: string
}

/** Headline counters for the selected window. */
export async function getOverview({ from, to }: Range) {
  const { rows } = await pool.query(
    `SELECT
        COUNT(*)                                   AS events,
        COUNT(DISTINCT visitor_id)                 AS visitors,
        COUNT(*) FILTER (WHERE event_type = 'search')        AS searches,
        COUNT(*) FILTER (WHERE event_type = 'property_view') AS property_views,
        COUNT(*) FILTER (WHERE event_type = 'luna_open')     AS luna_opens
       FROM app_events
      WHERE created_at >= $1 AND created_at < $2`,
    [from, to]
  )
  const leads = await pool.query(
    `SELECT COUNT(*) AS total,
            COUNT(*) FILTER (WHERE created_at >= $1 AND created_at < $2) AS new_in_range
       FROM leads`,
    [from, to]
  )
  const luna = await pool.query(
    `SELECT COUNT(*) AS sessions
       FROM luna_sessions
      WHERE created_at >= $1 AND created_at < $2`,
    [from, to]
  )
  const r = rows[0]
  return {
    events: Number(r.events),
    visitors: Number(r.visitors),
    searches: Number(r.searches),
    property_views: Number(r.property_views),
    luna_opens: Number(r.luna_opens),
    luna_sessions: Number(luna.rows[0].sessions),
    leads_total: Number(leads.rows[0].total),
    leads_new: Number(leads.rows[0].new_in_range),
  }
}

/** Distinct visitors + events per day, for the trend chart. */
export async function getDailyVisitors({ from, to }: Range) {
  const { rows } = await pool.query(
    `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
            COUNT(DISTINCT visitor_id) AS visitors,
            COUNT(*)                   AS events
       FROM app_events
      WHERE created_at >= $1 AND created_at < $2
      GROUP BY 1 ORDER BY 1`,
    [from, to]
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
  const { rows } = await pool.query(
    `SELECT to_char(date_trunc($3, created_at), 'YYYY-MM-DD') AS bucket,
            COUNT(*) AS count
       FROM app_events
      WHERE event_type = $4 AND created_at >= $1 AND created_at < $2
      GROUP BY 1 ORDER BY 1`,
    [from, to, gran, evt]
  )
  return { event: evt, granularity: gran, points: rows.map((r) => ({ bucket: r.bucket, count: Number(r.count) })) }
}

/** Individual recent searches (what was actually searched + when + who). */
export async function getRecentSearches({ from, to }: Range, limit = 60) {
  const { rows } = await pool.query(
    `SELECT created_at, payload->>'query' AS query, payload->>'kind' AS kind, visitor_id
       FROM app_events
      WHERE event_type = 'search'
        AND created_at >= $1 AND created_at < $2
        AND COALESCE(payload->>'query','') <> ''
      ORDER BY created_at DESC LIMIT $3`,
    [from, to, limit]
  )
  return rows
}

/** Top committed search terms. */
export async function getTopSearches({ from, to }: Range, limit = 20) {
  const { rows } = await pool.query(
    `SELECT lower(payload->>'query') AS term, COUNT(*) AS count
       FROM app_events
      WHERE event_type = 'search'
        AND created_at >= $1 AND created_at < $2
        AND COALESCE(payload->>'query','') <> ''
      GROUP BY 1 ORDER BY count DESC LIMIT $3`,
    [from, to, limit]
  )
  return rows.map((r) => ({ label: r.term, count: Number(r.count) }))
}

/** Most-viewed projects (joins project name). */
export async function getTopProjects({ from, to }: Range, limit = 20) {
  const { rows } = await pool.query(
    `SELECT e.project_id,
            COALESCE(rp.project_name, e.payload->>'project_name', 'Unknown') AS label,
            COUNT(*) AS count
       FROM app_events e
       LEFT JOIN residential_projects rp ON rp.id = e.project_id
      WHERE e.event_type = 'property_view'
        AND e.created_at >= $1 AND e.created_at < $2
      GROUP BY e.project_id, label
      ORDER BY count DESC LIMIT $3`,
    [from, to, limit]
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
  const { rows } = await pool.query(
    `SELECT payload->>'step' AS step, COUNT(DISTINCT visitor_id) AS visitors
       FROM app_events
      WHERE event_type = 'tutorial_step'
        AND created_at >= $1 AND created_at < $2
        AND payload->>'step' IS NOT NULL
      GROUP BY 1 ORDER BY MIN(created_at)`,
    [from, to]
  )
  return rows.map((r) => ({ step: r.step, visitors: Number(r.visitors) }))
}

/** Leads, hottest first. */
export async function getLeads(limit = 100) {
  const { rows } = await pool.query(
    `SELECT id, created_at, visitor_id, name, email, phone, whatsapp,
            source, intent, lead_score, status, last_seen_at
       FROM leads
      ORDER BY lead_score DESC, created_at DESC
      LIMIT $1`,
    [limit]
  )
  return rows
}

// ── Per-visitor drill-down (who they are + what they did + a prediction) ─────

// Lead-style intent score from raw counts (mirrors services/leadScoring weights).
function quickScore(views: number, searches: number, luna: number, hasContact: boolean): number {
  let s = 0
  if (hasContact) s += 25
  s += Math.min(views, 5) * 6
  if (luna > 0) s += 12
  s += Math.min(searches, 5) * 4
  return s
}
// hot / warm / cooling / cold from score + recency.
function stageFrom(score: number, lastSeen: string): 'hot' | 'warm' | 'cooling' | 'cold' {
  const ageDays = (Date.now() - new Date(lastSeen).getTime()) / 86_400_000
  if (score >= 40 && ageDays <= 7) return 'hot'
  if (score >= 18) return ageDays <= 14 ? 'warm' : 'cooling'
  return 'cold'
}

/** One row per UNIQUE visitor in the window, with an intent score + stage. */
export async function getVisitors({ from, to }: Range, limit = 200) {
  const { rows } = await pool.query(
    `SELECT
        e.visitor_id,
        MAX(e.user_email)                                                   AS user_email,
        MIN(e.created_at)                                                   AS first_seen,
        MAX(e.created_at)                                                   AS last_seen,
        COUNT(*)                                                            AS events,
        COUNT(*) FILTER (WHERE e.event_type = 'property_view')              AS views,
        COUNT(*) FILTER (WHERE e.event_type = 'search')                     AS searches,
        COUNT(*) FILTER (WHERE e.event_type = 'luna_open')                  AS luna_opens,
        COUNT(DISTINCT e.project_id) FILTER (WHERE e.project_id IS NOT NULL) AS distinct_projects
       FROM app_events e
      WHERE e.created_at >= $1 AND e.created_at < $2
        AND e.visitor_id IS NOT NULL
      GROUP BY e.visitor_id`,
    [from, to]
  )
  return rows
    .map((r) => {
      const views = Number(r.views), searches = Number(r.searches), luna = Number(r.luna_opens)
      const score = quickScore(views, searches, luna, !!r.user_email)
      return {
        visitor_id: r.visitor_id as string,
        user_email: (r.user_email as string) || null,
        first_seen: r.first_seen,
        last_seen: r.last_seen,
        events: Number(r.events),
        views, searches, luna_opens: luna,
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
  const [ev, lunaRes, leadRes] = await Promise.all([
    pool.query(
      `SELECT e.created_at, e.event_type, e.project_id, e.payload, e.path, e.session_id,
              rp.project_name, rp.area AS project_area, rp.min_price, rp.max_price
         FROM app_events e
         LEFT JOIN residential_projects rp ON rp.id = e.project_id
        WHERE e.visitor_id = $1
        ORDER BY e.created_at ASC
        LIMIT 1000`,
      [visitorId]
    ),
    pool.query(
      `SELECT session_id, created_at, duration_ms, turn_count, tool_call_count, had_error
         FROM luna_sessions WHERE visitor_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [visitorId]
    ),
    pool.query(
      `SELECT name, email, phone, whatsapp, source, lead_score, status, last_seen_at
         FROM leads WHERE visitor_id = $1 LIMIT 1`,
      [visitorId]
    ),
  ])

  const rows = ev.rows
  if (!rows.length) return null

  // Aggregate the behaviour into a prediction profile.
  const viewedMap = new Map<string, { id: string; name: string; area: string | null; minPrice: number | null; maxPrice: number | null; count: number }>()
  const areaCount = new Map<string, number>()
  const searchTerms: string[] = []
  let views = 0, searches = 0, luna = 0
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
    }
  }

  const viewedProjects = [...viewedMap.values()].sort((a, b) => b.count - a.count)
  const topAreas = [...areaCount.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
  const prices = viewedProjects.map((p) => p.minPrice).filter((n): n is number => n != null && n > 0).sort((a, b) => a - b)
  const budget = prices.length
    ? { min: prices[0], max: viewedProjects.map((p) => p.maxPrice ?? p.minPrice).filter((n): n is number => n != null).sort((a, b) => a - b).slice(-1)[0] ?? prices[prices.length - 1], median: prices[Math.floor(prices.length / 2)] }
    : null

  const hasContact = !!(leadRes.rows[0]?.email || leadRes.rows[0]?.phone || leadRes.rows[0]?.whatsapp || userEmail)
  const score = quickScore(views, searches, luna, hasContact)
  const lastSeen = rows[rows.length - 1].created_at
  const stage = stageFrom(score, lastSeen)

  return {
    visitor_id: visitorId,
    user_email: userEmail,
    first_seen: rows[0].created_at,
    last_seen: lastSeen,
    counts: { events: rows.length, views, searches, luna },
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
    timeline: rows.map((r) => ({
      at: r.created_at,
      type: r.event_type,
      projectId: r.project_id || null,
      projectName: r.project_name || r.payload?.project_name || null,
      area: r.project_area || r.payload?.area || null,
      query: r.payload?.query || null,
      kind: r.payload?.kind || null,
      path: r.path || null,
    })),
  }
}

/** Luna session list (no transcript — light). */
export async function getLunaSessions(limit = 50, offset = 0) {
  const { rows } = await pool.query(
    `SELECT id, session_id, created_at, visitor_id, user_email,
            duration_ms, turn_count, tool_call_count, had_error
       FROM luna_sessions
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2`,
    [limit, offset]
  )
  return rows
}

/** Full transcript for one session (the conversation viewer). */
export async function getLunaSession(sessionId: string) {
  const { rows } = await pool.query(
    `SELECT id, session_id, created_at, visitor_id, user_email, user_id,
            started_at, ended_at, duration_ms, turn_count, tool_call_count,
            had_error, transcript
       FROM luna_sessions WHERE session_id = $1 LIMIT 1`,
    [sessionId]
  )
  return rows[0] || null
}

// ── Error monitoring (auth_failure + api_error) ─────────────────────────────
// All three read app_events filtered to the two error event_types. The frontend
// (lib/track.ts + lib/errorCapture.ts) stamps diagnostic fields into `payload`:
//   auth_failure: { provider, reason, code, has_hash, has_code, storage, origin }
//   api_error:    { url, endpoint, status, kind: 'network'|'http'|'timeout', method }

/** Headline error counters + a small daily trend for the window. */
export async function getErrorOverview({ from, to }: Range) {
  const { rows } = await pool.query(
    `SELECT
        COUNT(*) FILTER (WHERE event_type = 'auth_failure')                       AS auth_failures,
        COUNT(*) FILTER (WHERE event_type = 'api_error')                          AS api_errors,
        COUNT(DISTINCT visitor_id) FILTER (WHERE event_type = 'auth_failure')     AS affected_auth_visitors,
        COUNT(DISTINCT visitor_id) FILTER (WHERE event_type = 'api_error')        AS affected_api_visitors
       FROM app_events
      WHERE event_type IN ('auth_failure','api_error')
        AND created_at >= $1 AND created_at < $2`,
    [from, to]
  )
  const daily = await pool.query(
    `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
            COUNT(*) FILTER (WHERE event_type = 'auth_failure') AS auth_failures,
            COUNT(*) FILTER (WHERE event_type = 'api_error')    AS api_errors
       FROM app_events
      WHERE event_type IN ('auth_failure','api_error')
        AND created_at >= $1 AND created_at < $2
      GROUP BY 1 ORDER BY 1`,
    [from, to]
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
      GROUP BY event_type, signature
      ORDER BY count DESC, last_seen DESC
      LIMIT $3`,
    [from, to, limit]
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
  const { rows } = await pool.query(
    `SELECT id, created_at, event_type, visitor_id, user_email, path, ua, payload
       FROM app_events
      WHERE event_type IN ('auth_failure','api_error')
        AND created_at >= $1 AND created_at < $2
      ORDER BY created_at DESC
      LIMIT $3`,
    [from, to, limit]
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
