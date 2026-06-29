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
