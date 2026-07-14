/**
 * Collab 带看后意向报告 —— 读 collab_rooms 的事件日志,派生结构化事实,再让
 * Gemini 写一段「买家意向 + 跟进话术」叙述(best-effort,失败仍返回结构化部分)。
 *
 * 数字/事实全在这里确定性派生(看了哪些区/项目、聊了什么、问了 Luna 什么、谁
 * 何时进出),模型只负责叙述、不编造。范式同 luna-tour/auto-report.ts。
 *
 * 隐私:events 含客户聊天逐句(PII)。所有读取路由都挂 requireOwner(见
 * routes/admin-analytics.ts)。
 */
import { callGemini } from './ai/gemini'
import pool from '../db/pool'

export interface CollabSessionRow {
  code: string
  name: string | null
  created_at: string
  first_event_at: string | null
  last_event_at: string | null
  peak_participants: number
  chat_count: number
  event_count: number
}

export interface CollabChatMsg { from: string; name: string; text: string; at: number | null }
export interface CollabParticipant { name: string; role: string; joinedAt: number | null; leftAt: number | null }
export interface CollabAi {
  summary: string
  interest_level: '高' | '中' | '低' | '未知'
  signals: string[]
  follow_up: string
}
export interface CollabReport {
  code: string
  name: string | null
  created_at: string
  duration_ms: number | null
  peak_participants: number
  participants: CollabParticipant[]
  areas_visited: string[]
  projects: { id: string; name: string | null; area: string | null }[]
  luna_actions: { type: string; count: number }[]
  chat: CollabChatMsg[]
  /** 客户进带看时自报的称呼 + 选填联系方式(S2 身份门)—— 供经纪跟进有兴趣的人。 */
  contacts: { name: string; phone?: string; whatsapp?: string }[]
  truncated: boolean
  ai: CollabAi | null
}

function stripFence(t: string): string {
  return t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
}

/** 列表:供 dashboard 列出最近带看会话(不含 events 大字段)。 */
export async function getCollabSessions(limit = 50, offset = 0): Promise<CollabSessionRow[]> {
  const { rows } = await pool.query(
    `SELECT code, name, created_at, first_event_at, last_event_at,
            peak_participants, chat_count, event_count
       FROM collab_rooms
      ORDER BY COALESCE(last_event_at, created_at) DESC
      LIMIT $1 OFFSET $2`,
    [limit, offset]
  )
  return rows as CollabSessionRow[]
}

/** 从一个 mapAction 事件里尽力抠出一个动作类型标签。 */
function actionType(action: any): string {
  if (!action || typeof action !== 'object') return 'unknown'
  return String(action.type || action.action || action.kind || action.tool || 'action')
}

/**
 * 生成一份带看意向报告。无此房返回 null。
 * 结构化事实确定性派生;AI 叙述 best-effort。
 */
export async function getCollabReport(code: string): Promise<CollabReport | null> {
  const { rows } = await pool.query(
    `SELECT code, name, created_at, first_event_at, last_event_at,
            peak_participants, events
       FROM collab_rooms WHERE code = $1 LIMIT 1`,
    [code]
  )
  const row = rows[0]
  if (!row) return null

  const events: any[] = Array.isArray(row.events) ? row.events : []
  const truncated = !Array.isArray(row.events) // events 超限时存成 {truncated:true}

  // ── 确定性派生 ────────────────────────────────────
  const chat: CollabChatMsg[] = []
  const contacts: CollabReport['contacts'] = []
  const areas: string[] = []
  const projectIds: string[] = []
  const lunaCount = new Map<string, number>()
  const byConn = new Map<string, CollabParticipant>()

  for (const e of events) {
    switch (e?.k) {
      case 'chat':
        chat.push({
          from: String(e.from || 'viewer'),
          name: String(e.name || ''),
          text: String(e.text || ''),
          at: typeof e.at === 'number' ? e.at : null,
        })
        break
      case 'identify':
        contacts.push({
          name: String(e.name || '客户'),
          ...(e.phone ? { phone: String(e.phone) } : {}),
          ...(e.whatsapp ? { whatsapp: String(e.whatsapp) } : {}),
        })
        break
      case 'goto':
        if (e.label && !areas.includes(String(e.label))) areas.push(String(e.label))
        break
      case 'select':
        // non-empty project id only (empty id = a close/deselect broadcast)
        if (e.kind === 'project' && typeof e.id === 'string' && e.id && !projectIds.includes(e.id)) {
          projectIds.push(e.id)
        }
        break
      case 'mapAction': {
        const t = actionType(e.action)
        // skip internal collab broadcasts (e.g. __collab_landmark) — not Luna data
        if (!t.startsWith('__')) lunaCount.set(t, (lunaCount.get(t) || 0) + 1)
        break
      }
      case 'join':
        if (e.who?.connId) {
          byConn.set(String(e.who.connId), {
            name: String(e.who.name || '访客'),
            role: String(e.who.role || 'viewer'),
            joinedAt: typeof e.at === 'number' ? e.at : null,
            leftAt: null,
          })
        }
        break
      case 'leave':
        if (e.connId && byConn.has(String(e.connId))) {
          byConn.get(String(e.connId))!.leftAt = typeof e.at === 'number' ? e.at : null
        }
        break
    }
  }

  // 项目 id → 名称/区(报告可读性)
  let projects: CollabReport['projects'] = projectIds.map((id) => ({ id, name: null, area: null }))
  if (projectIds.length) {
    try {
      const { rows: pr } = await pool.query(
        `SELECT id::text, project_name, area FROM residential_projects WHERE id = ANY($1::uuid[])`,
        [projectIds]
      )
      const byId = new Map(pr.map((p: any) => [p.id, p]))
      projects = projectIds.map((id) => {
        const p = byId.get(id)
        return { id, name: p?.project_name ?? null, area: p?.area ?? null }
      })
    } catch {
      /* uuid 解析失败等:保留 id-only */
    }
  }

  const firstAt = row.first_event_at ? new Date(row.first_event_at).getTime() : null
  const lastAt = row.last_event_at ? new Date(row.last_event_at).getTime() : null
  const report: CollabReport = {
    code: row.code,
    name: row.name ?? null,
    created_at: row.created_at,
    duration_ms: firstAt && lastAt ? Math.max(0, lastAt - firstAt) : null,
    peak_participants: row.peak_participants ?? 0,
    participants: Array.from(byConn.values()),
    areas_visited: areas,
    projects,
    luna_actions: Array.from(lunaCount.entries()).map(([type, count]) => ({ type, count })),
    chat,
    contacts,
    truncated,
    ai: null,
  }

  report.ai = await generateNarrative(report)
  return report
}

/** Gemini 叙述:买家意向判断 + 跟进话术。best-effort,失败返回 null。 */
async function generateNarrative(r: CollabReport): Promise<CollabAi | null> {
  // 没有任何客户互动信号就不浪费一次调用
  if (r.chat.length === 0 && r.projects.length === 0 && r.areas_visited.length === 0) return null

  const facts = [
    `带看时长: ${r.duration_ms ? Math.round(r.duration_ms / 60000) + ' 分钟' : '未知'}`,
    `在场峰值: ${r.peak_participants} 人`,
    `去过的区域: ${r.areas_visited.join('、') || '无'}`,
    `看过的项目: ${r.projects.map((p) => p.name || p.id).join('、') || '无'}`,
    `Luna 数据查询: ${r.luna_actions.map((a) => `${a.type}×${a.count}`).join('、') || '无'}`,
    `聊天记录(${r.chat.length} 条):`,
    ...r.chat.map((c) => `  [${c.from === 'agent' ? '经纪' : '客户'}${c.name ? ' ' + c.name : ''}] ${c.text}`),
  ].join('\n')

  const prompt = `你是迪拜房产经纪团队的销售助理。下面是一次「实时带看」会话的真实记录(经纪带海外客户在线看地图)。请基于记录判断买家意向并给出跟进建议。不得编造记录里没有的事实。

会话记录:
${facts}

只输出 JSON,不要任何额外解释:
{
  "summary": "120字以内,这次带看发生了什么、客户关注什么",
  "interest_level": "高 | 中 | 低 | 未知 (基于停留、提问、聊天热度判断)",
  "signals": ["买家意向信号1", "信号2"],
  "follow_up": "给经纪的下一步跟进话术草稿(中文,可直接发给客户,亲切专业,150字内)"
}

规则:
- 只用记录里的事实;聊天为空就老实说信息有限、interest_level 给「未知」。
- follow_up 要具体引用客户看过的区/项目,不要空话。`

  try {
    const { text } = await callGemini({
      task: 'collab-report',
      contents: prompt,
      config: { responseMimeType: 'application/json', temperature: 0.5 },
    })
    if (!text.trim()) return null
    const raw = JSON.parse(stripFence(text)) as Partial<CollabAi>
    const lvl = raw.interest_level
    return {
      summary: String(raw.summary || '').trim(),
      interest_level: lvl === '高' || lvl === '中' || lvl === '低' ? lvl : '未知',
      signals: Array.isArray(raw.signals) ? raw.signals.map(String).slice(0, 5) : [],
      follow_up: String(raw.follow_up || '').trim(),
    }
  } catch {
    return null
  }
}

/**
 * 保留期清理:删 created_at 早于 RETENTION_DAYS 的房间(含客户 PII)。
 * 返回删除行数。best-effort,自己吞错。
 */
export async function purgeOldCollabRooms(retentionDays: number): Promise<number> {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM collab_rooms WHERE created_at < now() - ($1 || ' days')::interval`,
      [String(retentionDays)]
    )
    return rowCount ?? 0
  } catch (err) {
    console.error('[collab-report] purge failed (ignored):', err instanceof Error ? err.message : err)
    return 0
  }
}
