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
import { callGemini } from '../services/ai/gemini'

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

  try {
    const { text } = await callGemini({
      task: 'revise',
      contents: prompt,
      config: { responseMimeType: 'application/json', temperature: 0.6 },
    })
    if (!text.trim()) return []
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
    return []
  }
  return []
}

/**
 * 🔴 **一句话改稿** —— AI 编辑器的核心。
 *
 * reviseNarration 要求经纪**先逐拍标注**,再点「用 AI 应用评论」——
 * 那还是在要求他先理解「拍」这个概念、先学会时间线。
 *
 * owner 实测:「客户已经来看到直接懵逼了,完全不会用」。
 * 根因不是这个编辑器不好用,是**我们在让经纪当剪辑师** —— 而他是销售。
 * 他脑子里的东西是「结尾太长了」「别提那个学校」「多讲讲海景」,
 * 他不该去找**哪个滑块**对应这句话。
 *
 * 所以:他打**一句人话**,由 AI 自己决定**改哪几拍**、怎么改。
 *
 * ⚠️ 只改**旁白文字**。数字、卡片、镜头一律不动 ——
 *    卡片上的数字全部来自真实 DLD,**可手改 = 可伪造 = 客户凭什么信我们**。
 */
export async function reviseWithInstruction(
  beats: (BeatForRevise & { kind?: string })[],
  instruction: string
): Promise<NarrationPatch[]> {
  const text = instruction.trim()
  if (!text || !beats.length) return []

  const prompt = `你是迪拜房产导览的旁白编辑。经纪对整场导览提了**一句**修改意见,
请你自己判断**哪几段需要改**,并只重写那几段。没受影响的段**不要返回**。

经纪的意见:
"""
${text}
"""

当前导览的全部旁白(按顺序):
${beats.map((b, i) => `${i + 1}. [${b.beat_id}]${b.kind ? ` (${b.kind})` : ''} ${b.narration}`).join('\n')}

只输出如下结构的 JSON,不要解释:
{ "patches": [ { "beat_id": "...", "narration": "重写后的旁白" } ] }

硬规则(不可违反):
- **只改旁白文字。** 不要改数字 —— 所有价格/涨幅/距离/成交量都来自真实数据,
  不许编造、不许调整、不许"凑整"。意见里如果要求改数字,**忽略那部分**。
- 不要承诺或保证任何回报率或升值。不出现"抱歉/对不起/无法"。
- 保持原语言与专业、温暖的口吻。
- 「短一点」→ 显著缩短;「更口语」→ 像人说话不像念稿;「去掉套话」→ 删掉空洞的形容词。
- 「别提X」→ 把 X 相关的句子整个拿掉,并让上下文读起来仍然通顺。
- 只返回**真正改动过**的段;beat_id 必须来自上面的列表。
- 如果这句意见跟旁白无关(比如在说镜头或卡片),返回 { "patches": [] }。`

  try {
    const { text: out } = await callGemini({
      task: 'revise-instruction',
      models: ['gemini-3.5-flash', 'gemini-3.1-flash-lite'],
      contents: prompt,
      config: { responseMimeType: 'application/json', temperature: 0.6 },
    })
    const parsed = JSON.parse(stripFence(out || '{}')) as { patches?: NarrationPatch[] }
    const valid = new Set(beats.map((b) => b.beat_id))
    return (parsed.patches || [])
      .filter((p) => p && typeof p.beat_id === 'string' && typeof p.narration === 'string')
      .filter((p) => valid.has(p.beat_id) && p.narration.trim().length > 0)
      // 没变的别算成"改了"
      .filter((p) => p.narration.trim() !== beats.find((b) => b.beat_id === p.beat_id)?.narration.trim())
  } catch (err) {
    console.warn('[luna] reviseWithInstruction failed:', err instanceof Error ? err.message : err)
    return []   // 失败就什么都不改
  }
}
