/**
 * Luna 对话质量的质检规则。
 *
 * 之前只知道「工具调用成功/失败」。但一场对话的质量是:
 * **客户问的东西,Luna 到底答上了没有?**
 *
 * 这些规则从真实 transcript 里找「答得不好」的行为痕迹 —— 都是可判定的,
 * 不需要再叫一个 AI 来打分(那样又贵又不可靠,而且循环论证)。
 *
 * 真实结构(从 luna_sessions.transcript 实测):
 *   messages:  [{ role: 'user'|'assistant'|'model', content: string, timestamp }]
 *   toolCalls: [{ name, params, result, duration, startTime, endTime }]
 *   errors:    []
 */
import type { Rule } from './index'

interface Message { role?: string; content?: string; timestamp?: number }
interface ToolCall { name?: string; params?: unknown; result?: any; duration?: number }
export interface LunaSession {
  messages?: Message[]
  toolCalls?: ToolCall[]
  errors?: unknown[]
  duration?: number
}

const userMsgs = (s: LunaSession) => (s?.messages || []).filter((m) => m.role === 'user')
const aiMsgs = (s: LunaSession) =>
  (s?.messages || []).filter((m) => m.role === 'assistant' || m.role === 'model')

/** 工具是不是"成功了但什么都没查到"。 */
function isEmptyResult(r: any): boolean {
  if (r === null || r === undefined) return true
  if (typeof r.count === 'number' && r.count === 0) return true
  if (Array.isArray(r) && r.length === 0) return true
  for (const k of ['projects', 'areas', 'results', 'items', 'units']) {
    if (Array.isArray(r[k]) && r[k].length === 0) return true
  }
  return false
}

/** 粗糙但够用的相似度(去标点后的字符集重合率)。 */
function similar(a: string, b: string): number {
  const norm = (x: string) => x.replace(/[^一-龥a-z0-9]/gi, '').toLowerCase()
  const [x, y] = [norm(a), norm(b)]
  if (x.length < 4 || y.length < 4) return 0
  const short = x.length < y.length ? x : y
  const long = x.length < y.length ? y : x
  const set = new Set(short)
  let hit = 0
  for (const ch of set) if (long.includes(ch)) hit++
  return hit / set.size
}

export const LUNA_RULES: Rule<LunaSession>[] = [
  {
    id: 'tool_returned_empty',
    severity: 'critical',
    why: '**工具"成功"了但什么都没查到**(count:0)—— 比报错更隐蔽。Luna 拿不到数据,只能凭印象瞎聊,而监控上一切正常。实测真有:客户问 Al Ghadeer Gardens,search_projects 返回 count:0。多半是**匹配口径**的问题(名字对不上库里的写法),不是数据没有。',
    check: (s) => {
      const calls = s?.toolCalls || []
      const empty = calls.filter((c) => isEmptyResult(c.result))
      if (!empty.length) return null
      const names = [...new Set(empty.map((c) => c.name || '?'))]
      return `${empty.length}/${calls.length} 次工具调用查不到东西(${names.join(', ')})—— Luna 只能瞎聊`
    },
  },
  {
    id: 'user_repeated_question',
    severity: 'critical',
    why: '**客户把同一个问题问了两遍 = Luna 第一次没答上。** 这是「答得不好」最可靠的信号 —— 比任何 AI 打分都准,因为它是客户的真实反应。',
    check: (s) => {
      const qs = userMsgs(s).map((m) => String(m.content || '')).filter((t) => t.length > 5)
      for (let i = 1; i < qs.length; i++) {
        for (let j = 0; j < i; j++) {
          if (similar(qs[i], qs[j]) > 0.85) {
            return `客户重复问了同一件事:「${qs[i].slice(0, 40)}」(第一次没答上)`
          }
        }
      }
      return null
    },
  },
  {
    id: 'session_had_error',
    severity: 'critical',
    why: '会话里有错误 = 客户当场撞到了故障(音频断了/工具挂了/模型报错)。',
    check: (s) => {
      const n = (s?.errors || []).length
      return n === 0 ? null : `会话里有 ${n} 个错误`
    },
  },
  {
    id: 'absurd_price_spoken',
    severity: 'critical',
    why:
      '**Luna 对客户报了一个荒谬的价格。**\n' +
      '实测(2026-07-13):她说「Al Safouh First 中位价约 **2321万**迪拉姆」——\n' +
      '真实值是 232 万。根因:`Math.round(aed / 1000)` 后面跟着「万」' +
      '(**该除 10000**),全站 10 处,**每一个金额都放大了 10 倍**;\n' +
      '连客户自己说的预算也是:客户说「300万」,她复述成「3000万内」。\n' +
      '已修(voice-assistant-tools 的 wan() helper)。这条规则留着当哨兵。\n' +
      '判据:迪拜公寓中位价现实区间约 50万–800万 AED。她嘴里出现「1000万以上的中位价」' +
      '几乎一定是单位算错了(真正的豪宅报价会带项目名,不会是"中位价")。',
    check: (s) => {
      const bad: string[] = []
      for (const m of aiMsgs(s)) {
        const text = String(m.content || '')
        // 「中位价约 2321万」「中位约 2600万」
        const re = /中位[价]?\s*(?:约|为|确实为)?\s*([\d,]+)\s*万/g
        let hit: RegExpExecArray | null
        while ((hit = re.exec(text))) {
          const wan = Number(hit[1].replace(/,/g, ''))
          if (Number.isFinite(wan) && wan >= 1000) bad.push(`${wan}万`)   // ≥1000万 的"中位价"
        }
      }
      return bad.length === 0 ? null
        : `Luna 报了荒谬的中位价:${bad.slice(0, 3).join('、')}(迪拜公寓中位价现实区间 50–800万,多半是单位算错了)`
    },
  },
  {
    id: 'ai_apologized',
    severity: 'major',
    why: 'Luna 的人设是**顾问**,不是客服。系统提示词里明确禁了「抱歉/对不起/无法」,出现说明模型没守住 —— 而且通常意味着她被问倒了。',
    check: (s) => {
      const banned = ['抱歉', '对不起', '无法提供', '我不能', '不清楚', 'sorry', "I can't", 'I cannot']
      const bad = aiMsgs(s).filter((m) =>
        banned.some((w) => String(m.content || '').toLowerCase().includes(w.toLowerCase())))
      return bad.length === 0 ? null : `Luna 说了 ${bad.length} 次禁用词(抱歉/无法)`
    },
  },
  {
    id: 'transcript_lost_user_speech',
    severity: 'critical',
    why:
      '**客户说了话,但他的话没被记进 transcript。**\n' +
      '判据:**Luna 不可能凭空调工具** —— 有工具调用(或 AI 回复里带着只有客户能提供的参数),' +
      '却没有任何 user 消息,那就一定是**转录丢了**,不是客户没说话。\n' +
      '实测(2026-07-13):一场"客户零发言"的会话里,Luna 调了 ' +
      'recommend_by_budget({budget: 3000000}) 并回复「根据您的300万迪拉姆预算…」—— ' +
      '客户明明说了预算,那句话就是没被记下来。\n' +
      '⚠️ 这个 bug **2026-07-03 已修**(finalizeUserMessage),历史数据里还有 16 场。' +
      '这条规则留着当哨兵:它一旦再响,就是转录又丢了。\n' +
      '后果:Admin 看对话记录只看到 Luna 单方面在说话,**根本不知道客户问了什么**。',
    check: (s) => {
      const users = userMsgs(s).length
      const calls = (s?.toolCalls || []).length
      if (users > 0) return null
      if (calls === 0) return null   // 没工具调用 → 交给 no_user_turn 判(可能真的没说话)
      return `Luna 调了 ${calls} 次工具却没有任何客户发言 —— **客户的话丢了**(她不可能凭空调工具)`
    },
  },
  {
    id: 'no_user_turn',
    severity: 'major',
    why: '会话建起来、Luna 也没调任何工具、客户一句话没说 —— **麦克风没权限?Luna 没出声?** ' +
      '这是纯技术故障的信号。(有工具调用的情况归 transcript_lost_user_speech —— 那是记录丢了,不是没说话。)',
    check: (s) => {
      if ((s?.messages || []).length === 0) return null   // 空会话另算
      if ((s?.toolCalls || []).length > 0) return null    // 有工具调用 = 客户说过话,只是没记下来
      return userMsgs(s).length === 0
        ? '整场对话客户一句话都没说,Luna 也没调任何工具(麦克风/音频可能坏了)' : null
    },
  },
  {
    id: 'session_too_short',
    severity: 'minor',
    why: '客户开口不到两轮就走 = 第一印象没抓住。',
    check: (s) => {
      const n = userMsgs(s).length
      if (n === 0) return null   // no_user_turn 已经报了
      return n >= 2 ? null : `客户只说了 ${n} 轮就结束了`
    },
  },
  {
    id: 'ai_never_used_tools',
    severity: 'minor',
    why: 'Luna 的价值在于**她能查真数据**。聊了好几轮一次工具都不调 = 她在凭印象说话,内容可能是编的。',
    check: (s) => {
      const calls = (s?.toolCalls || []).length
      const n = userMsgs(s).length
      if (n < 3) return null      // 太短的对话不苛求
      return calls > 0 ? null : `客户说了 ${n} 轮,Luna 一次工具都没调(可能在编)`
    },
  },
]
