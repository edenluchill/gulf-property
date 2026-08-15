/**
 * 从 `luna_turns` 重建丢失的 `luna_sessions` —— **别指望浏览器在被杀掉之前发善心。**
 *
 * ## 这个文件存在的原因（2026-08-14 实锤）
 *
 * owner：「为啥我看不到任何记录了，但是合伙人却说昨天有聊天效果不错？」
 *
 * 合伙人那通对话**确实发生了**，13 轮，内容还很好（JVC 年化 10.9%、
 * 中位价 103 万那一场）。它在 `luna_turns` 里一轮不缺，
 * 但 `/admin/analytics` 的「Luna 对话」读的是 `luna_sessions` —— **那里没有。**
 *
 * 因为 `luna_sessions` 只在会话**正常结束**时由浏览器
 * `navigator.sendBeacon` 上报**一次**：
 *   · 手机上切走 App → `pagehide` 不一定开火
 *   · 后台标签页 → 5 分钟 idle 定时器被浏览器节流，永远不开火
 *   · 进程被系统杀掉 → 什么都不开火
 * 这一次上报没发生，整场对话就在看板上**不存在**。
 *
 * 实测 30 天 8 场对话丢了 **6 场（75%）**：
 *   8-13 → 真实 1 场，表里 0 场   8-11 → 真实 6 场，表里 2 场
 *
 * ## 为什么是服务端重建，而不是把前端上报修得更结实
 *
 * 修不结实。进程被杀掉时**没有任何代码能跑** —— 这是浏览器给的保证边界，
 * 不是我们能加固的东西。而 `luna_turns` 是**每轮**落库的（服务端写一条、
 * 前端写一条），会话中途死掉最多丢最后一轮，前面全在。
 * 所以正确的姿势是：**把会话表当成 turns 的派生物**，上报只是快路径。
 *
 * ## 边界
 *
 * · `ON CONFLICT DO NOTHING` —— 浏览器上报的那条永远赢。
 *   它带着真实 metrics / 错误列表 / 打断次数，比重建的富。
 * · 只处理**最后一轮已经超过 `SETTLE_MS`** 的会话 —— 否则会把正在进行的
 *   对话提前封档，然后浏览器上报时撞 conflict 被丢掉。
 * · `source='rebuilt'` 写在脸上。看板上分不清来源的话，
 *   下次再出问题又要重新查一遍「这条是怎么来的」。
 */
import pool from '../db/pool'
import { summarizeLunaSession, hasSummarizableContent } from './lunaSummary'

/**
 * 最后一轮之后静默多久才认为「这场结束了」。
 * 前端 idle 是 5 分钟，这里留一倍余量：宁可晚一点补，
 * 也不要抢在浏览器正常上报之前把位置占掉。
 */
const SETTLE_MS = 10 * 60 * 1000

/** 往回补多久。够覆盖任何一次部署间隔 + 手动回填历史。 */
const LOOKBACK_DAYS = 60

/** 一轮最多补几场 —— 每场要烧一次 AI 摘要，别让一次回填打爆额度。 */
const MAX_PER_TICK = 20

const SWEEP_MS = 10 * 60 * 1000

/**
 * 只补**真实浏览器会话**。
 *
 * `luna_turns` 是所有调用方共用的账本,里面混着测试脚本造的 id
 * (实测 90 天内:`toolstat_corir` / `toolstat_up6wa` / `toolstat_xxlgg` / `track_r14rs`,
 * 全是单轮残渣)。而 `luna_sessions` 61 行**全是 `voice_`** —— 看板上的
 * 「Luna 对话」一直只有真人对话这一种东西,不能因为要补录就把它掺脏:
 * 假会话进去 = 数出来的「有几个人聊过」直接失真,而且每条还白烧一次 AI 摘要。
 *
 * 真实 id 由 `frontend/.../debugLogger.ts` 生成,格式恒为
 * `voice_${Date.now()}_${rand}` —— 前缀是稳定的,可以当判据。
 */
const REAL_SESSION_PREFIX = 'voice\\_%'

interface TurnRow {
  created_at: Date
  source: string
  question: string | null
  speech: string | null
  user_said: string | null
  tools: string[] | null
  degraded: boolean | null
  ms: number | null
  total_ms: number | null
}

/**
 * 同一轮的 brain 行和 live 行最多隔多久。
 *
 * 实测这个间隔就是「Luna 把话说完」所用的时间：brain 22:40:49 → live 22:41:12 = 23 秒。
 * 给到 2 分钟，比最长的一次回答还宽得多。
 */
const SAME_TURN_MS = 2 * 60 * 1000

/**
 * 把 turns 拼成 SessionViewer / lunaSummary 认识的 messages。
 *
 * ## ⚠️ 同一次问答在库里是**两行**
 *
 * `brain`（服务端在 /ask 里写）和 `live`（前端每轮说完写），两行的 `user_said` 一模一样。
 * 不配对的话，回看页面上客户每句话都出现两遍。
 *
 * 第一版按 `speech` 去重，**不够**：第一轮的 live 行 speech 是空的
 * （实测 `voice_1786660799654_8qoieo` 就是），两行 speech 不相等 → 用户那句照样重复。
 * 所以改成按**轮次**配对：`user_said` 一字不差 + 来源不同 + 紧挨着 + 在
 * `SAME_TURN_MS` 内 = 同一轮的两半。
 *
 * ## 为什么不能直接按 user_said 全局去重
 *
 * **客户重复提问是要保留的信号** —— 同一句问两遍 = 第一次没答上（`luna-rules`
 * 的质检就是靠这个痕迹判的）。全局去重会把它抹掉，看板上就再也看不出
 * 「她答砸了所以客户又问了一遍」。
 *
 * 靠 `paired` 标记来区分这两件事：一轮只吸收一个对家。真的问了两遍时
 * （brain,live,brain,live 四行），第 3 行看到 prev 已配对 → 老老实实新起一轮。
 *
 * 单边的轮次原样保留：Live 把话说完之前页面就死了的轮次只有 brain 那一半，
 * 那恰恰是最该看见的（客户问完就走 = 大概率是被气走的）。
 */
export function buildMessages(turns: TurnRow[]): Array<{ role: string; content: string; timestamp: number }> {
  interface Merged { at: number; said: string; spoke: string; source: string; paired: boolean }
  const merged: Merged[] = []

  for (const t of turns) {
    const at = new Date(t.created_at).getTime()
    const said = (t.user_said || t.question || '').trim()
    const spoke = (t.speech || '').trim()
    const prev = merged[merged.length - 1]

    if (prev && !prev.paired && said && prev.said === said &&
        prev.source !== t.source && at - prev.at < SAME_TURN_MS) {
      // live 那句优先 —— 它是**真播出去的**。brain 写完但没播出去的不算数。
      if (t.source === 'live' && spoke) prev.spoke = spoke
      else if (!prev.spoke) prev.spoke = spoke
      prev.at = Math.min(prev.at, at)
      prev.paired = true
      continue
    }
    merged.push({ at, said, spoke, source: t.source, paired: false })
  }

  const msgs: Array<{ role: string; content: string; timestamp: number }> = []
  for (const m of merged) {
    if (m.said) msgs.push({ role: 'user', content: m.said, timestamp: m.at })
    if (m.spoke) msgs.push({ role: 'assistant', content: m.spoke, timestamp: m.at })
  }
  return msgs
}

/** 补一场。返回是否真的写了行。 */
async function rebuildOne(sessionId: string): Promise<boolean> {
  const [{ rows: turns }, { rows: calls }] = await Promise.all([
    pool.query<TurnRow>(
      `SELECT created_at, source, question, speech, user_said, tools, degraded, ms, total_ms
         FROM luna_turns WHERE session_id = $1 ORDER BY created_at`,
      [sessionId]
    ),
    pool.query(
      `SELECT tool, params, outcome, ms, summary FROM luna_tool_calls
        WHERE session_id = $1 ORDER BY created_at`,
      [sessionId]
    ),
  ])
  if (!turns.length) return false

  const visitor = await pool.query<{ visitor_id: string }>(
    `SELECT visitor_id FROM luna_turns
      WHERE session_id = $1 AND visitor_id IS NOT NULL LIMIT 1`,
    [sessionId]
  )

  const messages = buildMessages(turns)
  const toolCalls = calls.map(c => ({
    name: c.tool,
    params: c.params ?? null,
    result: c.summary ?? c.outcome,
    duration: c.ms ?? null,
    // outcome 的口径同 classifyOutcome()：只有 'error' 算真出错，
    // empty/not_found 是「查了没有」，不是故障。
    ...(c.outcome === 'error' ? { error: '工具报错' } : {}),
  }))

  const startMs = new Date(turns[0].created_at).getTime()
  const endMs = new Date(turns[turns.length - 1].created_at).getTime()
  const hadError = turns.some(t => t.degraded) || calls.some(c => c.outcome === 'error')

  const transcript = {
    sessionId,
    // 写在 transcript 里，导出/排查时一眼看出这条不是浏览器报的
    rebuiltFrom: 'luna_turns',
    startTime: startMs,
    endTime: endMs,
    duration: endMs - startMs,
    messages,
    toolCalls,
    errors: [],
  }

  const { rowCount } = await pool.query(
    `INSERT INTO luna_sessions
       (session_id, visitor_id, created_at, started_at, ended_at, duration_ms,
        turn_count, tool_call_count, had_error, transcript, source)
     VALUES ($1,$2,$3,$3,$4,$5,$6,$7,$8,$9::jsonb,'rebuilt')
     ON CONFLICT (session_id) DO NOTHING`,
    [
      sessionId,
      visitor.rows[0]?.visitor_id ?? null,
      new Date(startMs),
      new Date(endMs),
      endMs - startMs,
      messages.length,
      toolCalls.length,
      hadError,
      JSON.stringify(transcript),
    ]
  )
  if (!rowCount) return false // 浏览器在这中间把它报上来了 —— 它赢

  if (hasSummarizableContent(transcript)) {
    const summary = await summarizeLunaSession(transcript).catch(() => null)
    if (summary) {
      await pool
        .query(`UPDATE luna_sessions SET summary = $1, summary_at = now() WHERE session_id = $2`,
          [summary, sessionId])
        .catch(() => { /* 摘要是锦上添花，失败不影响会话本身已经补上了 */ })
    }
  }
  return true
}

/** 扫一遍，补齐所有已结束但没上报的会话。返回补了几场。 */
export async function rebuildMissingLunaSessions(): Promise<number> {
  const { rows } = await pool.query<{ session_id: string }>(
    `SELECT t.session_id
       FROM (
         SELECT session_id, max(created_at) last_at
           FROM luna_turns
          WHERE session_id IS NOT NULL
            AND session_id LIKE $4
            AND created_at > now() - ($1 || ' days')::interval
          GROUP BY session_id
       ) t
       LEFT JOIN luna_sessions ls ON ls.session_id = t.session_id
      WHERE ls.session_id IS NULL
        AND t.last_at < now() - ($2 || ' milliseconds')::interval
      ORDER BY t.last_at DESC
      LIMIT $3`,
    [LOOKBACK_DAYS, SETTLE_MS, MAX_PER_TICK, REAL_SESSION_PREFIX]
  )

  let n = 0
  for (const { session_id } of rows) {
    try {
      if (await rebuildOne(session_id)) n++
    } catch (e) {
      console.error('[luna-rebuild] failed for', session_id, e instanceof Error ? e.message : e)
    }
  }
  if (n) console.log(`[luna-rebuild] 从 luna_turns 补回 ${n} 场丢失的会话`)
  return n
}

export function startLunaSessionRebuild(): void {
  // 同款生产门:本地 dev 连的是**生产库**,后台写库任务不许在本地跑
  // (见 memory local-dev-ghost-processes)。
  if (process.env.NODE_ENV !== 'production') {
    console.log('[luna-rebuild] disabled (NODE_ENV !== production)')
    return
  }
  const tick = () => {
    rebuildMissingLunaSessions().catch(e => console.error('[luna-rebuild] sweep failed:', e))
  }
  tick()
  setInterval(tick, SWEEP_MS).unref()
}
