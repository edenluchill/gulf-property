/**
 * agent_runs — record + read what an autonomous agent (cx-guardian) did each
 * patrol, so the owner dashboard can show it. See db/agent-runs.sql.
 *
 * The agent calls recordAgentRun() at the end of every round; the dashboard reads
 * getAgentRuns(). Best-effort writes — logging a run must never break a patrol.
 */
import pool from '../db/pool'

export interface AgentRunInput {
  agent?: string
  status?: 'clean' | 'fixed' | 'needs_attention'
  summary?: string
  blocked_count?: number
  lost_count?: number
  actions?: unknown[]      // [{type, detail, commit?, deploy_tag?, verify?}]
  flagged?: unknown[]      // [{identity, score, reason}]
  needs_human?: unknown[]  // [{detail, suggestion}]
}

export async function recordAgentRun(run: AgentRunInput): Promise<number | null> {
  try {
    const { rows } = await pool.query(
      `INSERT INTO agent_runs (agent, status, summary, blocked_count, lost_count, actions, flagged, needs_human)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb)
       RETURNING id`,
      [
        run.agent || 'cx-guardian',
        run.status || 'clean',
        run.summary || null,
        run.blocked_count || 0,
        run.lost_count || 0,
        JSON.stringify(run.actions || []),
        JSON.stringify(run.flagged || []),
        JSON.stringify(run.needs_human || []),
      ]
    )
    return Number(rows[0].id)
  } catch (err) {
    console.error('[agentRuns] record failed (ignored):', err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * Owner-only cross-agent view of every agent's clients (the "admin can see it too"
 * requirement). Read-only roll-up: agent → their clients with heat/stage/last
 * activity. Agents themselves are still isolated to their own via /clients.
 */
export async function getAgentClientsOverview(limit = 500) {
  const { rows } = await pool.query(
    `SELECT a.display_name AS agent_name, a.email AS agent_email,
            c.id AS client_id, c.name AS client_name, c.pipeline_stage, c.created_at,
            COALESCE(h.heat,0)::int AS heat, h.last_activity_at,
            (SELECT COUNT(*) FROM lt_client_interactions i WHERE i.client_id=c.id) AS interactions
       FROM lt_clients c
       JOIN lt_agents a ON a.id = c.agent_id
       LEFT JOIN (
         SELECT client_id, SUM(lead_score) AS heat, MAX(last_seen_at) AS last_activity_at
           FROM lt_session_lead_scores WHERE client_id IS NOT NULL GROUP BY client_id
       ) h ON h.client_id = c.id
      ORDER BY COALESCE(h.heat,0) DESC, c.created_at DESC
      LIMIT $1`,
    [limit]
  )
  return rows.map((r) => ({
    agent_name: r.agent_name as string | null,
    agent_email: r.agent_email as string | null,
    client_id: r.client_id as string,
    client_name: r.client_name as string,
    pipeline_stage: r.pipeline_stage as string,
    heat: Number(r.heat),
    last_activity_at: r.last_activity_at,
    interactions: Number(r.interactions),
    created_at: r.created_at,
  }))
}

export async function getAgentRuns(limit = 50) {
  const { rows } = await pool.query(
    `SELECT id, created_at, agent, status, summary, blocked_count, lost_count, actions, flagged, needs_human
       FROM agent_runs ORDER BY created_at DESC LIMIT $1`,
    [limit]
  )
  return rows.map((r) => ({
    id: Number(r.id),
    created_at: r.created_at,
    agent: r.agent as string,
    status: r.status as string,
    summary: r.summary as string | null,
    blocked_count: Number(r.blocked_count),
    lost_count: Number(r.lost_count),
    actions: (r.actions || []) as unknown[],
    flagged: (r.flagged || []) as unknown[],
    needs_human: (r.needs_human || []) as unknown[],
  }))
}
