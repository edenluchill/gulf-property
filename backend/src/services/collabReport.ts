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
  /** 开这场的经纪邮箱;null = 未登录建的房(压测/调试) */
  agent_email?: string | null
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
    // agent_email:这场是**谁**开的。以前列表里只有一个房号和「名字」(经纪自填的
    // 显示名,可空可重复),owner 根本认不出哪场是外部经纪、哪场是自己测的。
    `SELECT r.code, r.name, r.created_at, r.first_event_at, r.last_event_at,
            r.peak_participants, r.chat_count, r.event_count, a.email AS agent_email
       FROM collab_rooms r
       LEFT JOIN lt_agents a ON a.id = r.agent_id
      ORDER BY COALESCE(r.last_event_at, r.created_at) DESC
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
            peak_participants, event_count, events, ai_report, ai_report_events
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

  /**
   * 🔴 **AI 叙述必须缓存。**
   *
   * 2026-07-27 生产实测:`GET /api/admin/insights/collab/:code` 平均 **6.3 秒**、
   * 最慢 8.2 秒,而且是**每打开一次就重来一次** —— 同一场已经结束的带看,事件
   * 一个字都不会再变,却每次都重新调一遍 Gemini:经纪每次点开都干等 6 秒,
   * token 也白烧一次。它还会把 HIGH_LATENCY 告警顶起来(2026-07-24 那条就是它)。
   *
   * 失效判据用 `event_count` 而不是时间:带看**还在进行中**时事件在涨,报告就该
   * 重算;一旦结束,数字定住,缓存永远有效。
   *
   * 写回 fire-and-forget —— 缓存写失败绝不能让经纪看不到报告。
   */
  const eventCount: number = Number(row.event_count ?? events.length)
  const cachedAi = row.ai_report as CollabAi | null
  if (cachedAi && Number(row.ai_report_events) === eventCount) {
    report.ai = cachedAi
    return report
  }

  report.ai = await generateNarrative(report)
  if (report.ai) {
    pool.query(
      `UPDATE collab_rooms SET ai_report = $2, ai_report_events = $3, ai_report_at = now() WHERE code = $1`,
      [code, JSON.stringify(report.ai), eventCount]
    ).catch((err) => console.error('[collab-report] cache write failed (ignored):', err?.message ?? err))
  }
  return report
}

/**
 * 带看一结束就把报告先算好(落进 ai_report 缓存)。
 *
 * 为什么值得:经纪结束带看后**几乎必然**会去看这场的意向报告。在这里花的 6 秒
 * 没人在等;等他点开时再花,他就干看 6 秒转圈。总成本一样(每场一次 Gemini),
 * 只是把等待挪到没人看着的时候。
 *
 * best-effort:失败什么也不做 —— 读路径仍会按需生成(只是慢一次)。
 */
export async function precomputeCollabReport(code: string): Promise<void> {
  try {
    await getCollabReport(code)
  } catch (err) {
    console.error('[collab-report] precompute failed (ignored):', err instanceof Error ? err.message : err)
  }
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
