/**
 * Luna **逐轮追踪** —— 每一轮对话落一行，不等会话结束。
 *
 * ## 为什么必须有
 *
 * 2026-08-10 owner 报「AI 还在说自己能卖二手房」「说完话等一分钟才开口」，
 * 而我**查不到任何证据**：
 *
 *   · `luna_sessions` 12 小时内 **0 行** —— 它只在 `endSession()` 时上报，
 *     用户直接关标签页/会话还开着，就永远不落库
 *   · 服务端埋点只有计数（`luna.brain{result}`），看不到**说了什么**
 *   · 于是「Luna 到底怎么答的」只能靠猜
 *
 * 更要命的是这个盲区:**Live 层不调 `ask_luna` 直接自己编的那些轮次,
 * 后端完全不知道它们存在。** 所有护栏(数据边界、诚实规则、澄清出路)
 * 都在 Brain 里 —— Live 绕过 Brain 时,护栏一条都不生效,而且不留痕迹。
 * 二手房那句就是这么冒出来的。
 *
 * ## 两个来源，差值就是答案
 *
 *   source='brain' —— 服务端在 `/ask` 里写。**Live 问了 Brain 的轮次。**
 *   source='live'  —— 前端每轮结束写。**Luna 实际开口的所有轮次。**
 *
 * `live` 有而 `brain` 没有的轮次 = **Luna 没查就自己说了** = 幻觉高危区。
 * 这个差值是现在唯一能量化「Live 层有多不听话」的指标。
 *
 * ⚠️ 写失败**绝不能影响对话** —— 这是观测，不是业务。全程 catch 吞掉。
 */
import pool from '../db/pool'

export interface TurnLog {
  sessionId?: string
  visitorId?: string
  /** 'brain' = 服务端记的（Live 问了 Brain）；'live' = 前端记的（Luna 开口了） */
  source: 'brain' | 'live'
  question?: string
  speech?: string
  tools?: string[]
  ms?: number
  /** 这一轮 Live 有没有问过 Brain。前端上报时才有意义。 */
  askedBrain?: boolean
  degraded?: boolean
  outOfScope?: string
  clarifying?: boolean
}

/** 落一行。**永不抛、永不阻塞对话** —— 失败只打一条 warn。 */
export function logTurn(t: TurnLog): void {
  // 故意不 await：观测不该给语音链路加一次 DB 往返的延迟。
  pool.query(
    `INSERT INTO luna_turns
      (session_id, visitor_id, source, question, speech, tools, ms, asked_brain, degraded, out_of_scope, clarifying)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      t.sessionId || null,
      t.visitorId || null,
      t.source,
      t.question?.slice(0, 2000) || null,
      t.speech?.slice(0, 4000) || null,
      t.tools && t.tools.length ? t.tools : null,
      t.ms ?? null,
      t.askedBrain ?? null,
      t.degraded ?? null,
      t.outOfScope || null,
      t.clarifying ?? null,
    ]
  ).catch(e => console.warn('[LunaTurnLog] insert failed (ignored):', e?.message))
}
