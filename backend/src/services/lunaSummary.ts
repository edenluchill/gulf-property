/**
 * Luna 会话 AI 中文摘要 —— 把一场语音会话压成 2–4 句人能读的中文。
 *
 * 原始 transcript 的人类侧是 Gemini Live inputAudioTranscription,中英混识别质量
 * 很差、几乎没法直接读。但工具调用(name+params+result)和 Luna 回复是可靠的,
 * 所以让模型「即使人类转录残缺,也结合工具调用 + Luna 回复推断意图」。
 *
 * best-effort:任何失败(无 key / 模型报错 / 空输出)返回 null,绝不抛进请求路径。
 * 范式同 services/collabReport.ts / luna-tour/auto-report.ts。
 */
import { callGemini } from './ai/gemini'

interface TranscriptMessage { role?: string; content?: string }
interface TranscriptToolCall { name?: string; params?: unknown; result?: unknown; error?: string }
interface TranscriptError { message?: string; error?: string }
export interface LunaTranscript {
  messages?: TranscriptMessage[]
  toolCalls?: TranscriptToolCall[]
  errors?: unknown[]
}

/** 把一个 value 压成一行紧凑 JSON(截断超长,防止 prompt 爆炸)。 */
function compact(v: unknown, max = 300): string {
  if (v == null) return ''
  let s: string
  try {
    s = typeof v === 'string' ? v : JSON.stringify(v)
  } catch {
    s = String(v)
  }
  return s.length > max ? s.slice(0, max) + '…' : s
}

/** transcript 有没有值得摘要的内容(否则不浪费一次模型调用)。 */
export function hasSummarizableContent(t: LunaTranscript | null | undefined): boolean {
  if (!t) return false
  const msgs = Array.isArray(t.messages) ? t.messages : []
  const tools = Array.isArray(t.toolCalls) ? t.toolCalls : []
  const hasMsg = msgs.some((m) => typeof m?.content === 'string' && m.content.trim())
  return hasMsg || tools.length > 0
}

/** 把 transcript 压成给模型的紧凑文本:用户/Luna 逐句 + 每个工具 name(params)->result + errors。 */
function buildTranscriptText(t: LunaTranscript): string {
  const lines: string[] = []
  const msgs = Array.isArray(t.messages) ? t.messages : []
  for (const m of msgs) {
    const content = typeof m?.content === 'string' ? m.content.trim() : ''
    if (!content) continue
    const who = m.role === 'user' ? '客户' : 'Luna'
    lines.push(`[${who}] ${compact(content, 400)}`)
  }

  const tools = Array.isArray(t.toolCalls) ? t.toolCalls : []
  if (tools.length) {
    lines.push('工具调用:')
    for (const tc of tools) {
      const name = tc?.name || 'unknown'
      const params = tc?.params != null ? compact(tc.params) : ''
      const result = tc?.error ? `报错: ${compact(tc.error)}` : compact(tc?.result)
      lines.push(`  ${name}(${params}) -> ${result || '无结果'}`)
    }
  }

  const errors = Array.isArray(t.errors) ? t.errors : []
  if (errors.length) {
    lines.push('会话错误:')
    for (const e of errors) {
      const msg = typeof e === 'string' ? e : (e as TranscriptError)?.message || (e as TranscriptError)?.error || compact(e)
      if (msg) lines.push(`  ${compact(msg)}`)
    }
  }

  return lines.join('\n')
}

/**
 * 生成一场会话的中文摘要。无可摘要内容或全部失败返回 null。
 */
export async function summarizeLunaSession(transcript: LunaTranscript | null | undefined): Promise<string | null> {
  if (!hasSummarizableContent(transcript)) return null

  const body = buildTranscriptText(transcript as LunaTranscript).slice(0, 12_000)

  const prompt = `你是迪拜房产团队的分析助理。下面是一场 Luna 语音助手与客户的会话记录。

注意:人类侧的文字是语音识别结果,中英混说识别质量差、可能残缺甚至像乱码。请不要被残缺文字困住 —— 结合 Luna 的回复和工具调用(调了什么工具、传了什么参数、返回了什么结果)来推断客户到底想要什么。

会话记录:
${body}

用「与上面会话相同的语言」写 2–4 句摘要(自动跟随对话语言:中/英/阿/俄/法…),依次说清:
1. 客户意图 —— 客户想找/想了解什么(结合工具参数推断,如 search_projects{developer:"Emaar"} 说明想找 Emaar 的项目)。
2. Luna 做了什么 —— 调用了哪些工具、结果如何(如搜索返回 0 条 = 没找到)。
3. 有没有帮上、有没有问题 —— 是否满足了客户、有无出错或空结果导致体验不好。

只输出这段摘要本身,不要标题、不要编号、不要 markdown、不要多余解释。`

  try {
    const { text } = await callGemini({
      task: 'luna-summary',
      contents: prompt,
      config: { temperature: 0.4 },
    })
    const out = text.trim()
    if (out) return out.slice(0, 800)
  } catch {
    return null
  }
  return null
}
