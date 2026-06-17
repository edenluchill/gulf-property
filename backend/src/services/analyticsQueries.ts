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
