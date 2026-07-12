/**
 * Luna Tour — E2 AI revise (comment-driven editing).
 *
 * Given the current beats (id + narration) and the agent's comments anchored to
 * specific beats ("这段太长 / 强调海景 / 这个数字应是X"), ask Gemini to rewrite
 * ONLY the commented beats' narration per the feedback, keeping the language and
 * tone. Returns a list of {beat_id, narration} patches — the caller validates,
 * snapshots a version, applies them, and regenerates only those beats' audio.
 *
 * Conservative by design: narration-only (no structural edits — those are E3),
 * the compliance floor is restated so a comment can't push it to over-promise,
 * and any failure returns [] so nothing is changed.
 */
import { GoogleGenAI } from '@google/genai'

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
const MODELS = ['gemini-3.5-flash', 'gemini-3.1-flash-lite']  // ⚠️ gemini-3.5-flash = GA 旗舰(2026-05)。别写 gemini-3-flash(404)/3-flash-preview(已废弃)

function stripFence(t: string): string {
  return t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
}

export interface BeatForRevise {
  beat_id: string
  narration: string
}
export interface CommentForRevise {
  beat_id: string
  body: string
}
export interface NarrationPatch {
  beat_id: string
  narration: string
}

/**
 * Rewrite the narration of the commented beats. `beats` is the full ordered list
 * (for context); `comments` are the feedback notes keyed to beat_id. Only beats
 * that have at least one comment may be rewritten.
 */
export async function reviseNarration(
  beats: BeatForRevise[],
  comments: CommentForRevise[]
): Promise<NarrationPatch[]> {
  const commented = new Set(comments.map((c) => c.beat_id))
  if (!commented.size) return []
  const byBeat = new Map<string, string[]>()
  for (const c of comments) {
    if (!byBeat.has(c.beat_id)) byBeat.set(c.beat_id, [])
    byBeat.get(c.beat_id)!.push(c.body)
  }

  const targets = beats
    .filter((b) => commented.has(b.beat_id))
    .map((b) => ({ beat_id: b.beat_id, current: b.narration, feedback: byBeat.get(b.beat_id) ?? [] }))

  const prompt = `你是迪拜房产导览的旁白编辑。下面是导览里若干段旁白,以及经纪对每一段的修改意见。
请**只重写这些段**的旁白文字,严格执行修改意见,保持原语言与专业、温暖的口吻。

待修改的段(JSON):
${JSON.stringify(targets, null, 2)}

完整导览顺序(仅供上下文参考,不要改未列出的段):
${beats.map((b, i) => `${i + 1}. [${b.beat_id}] ${b.narration}`).join('\n')}

只输出如下结构的 JSON,不要解释:
{ "patches": [ { "beat_id": "...", "narration": "重写后的旁白" } ] }

硬规则(不可违反):
- 不要承诺或保证任何回报率或升值;只陈述已有的数字,不要编造价格/坐标/距离。
- 不出现"抱歉/对不起/无法"。
- 「短一点」→ 显著缩短;「详细一点」→ 适度扩展但不堆砌;「强调X」→ 自然突出 X。
- 只返回有改动的段;beat_id 必须来自待修改列表。`

  for (const model of MODELS) {
    try {
      const resp = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: 'application/json', temperature: 0.6 },
      })
      const text = resp.text ?? ''
      if (!text.trim()) continue
      const raw = JSON.parse(stripFence(text)) as { patches?: { beat_id?: unknown; narration?: unknown }[] }
      const patches: NarrationPatch[] = []
      for (const p of raw.patches ?? []) {
        const id = String(p.beat_id ?? '')
        const narration = String(p.narration ?? '').trim()
        // only accept patches for beats that actually had a comment
        if (id && narration && commented.has(id)) patches.push({ beat_id: id, narration })
      }
      if (patches.length) return patches
    } catch {
      /* try next model */
    }
  }
  return []
}
