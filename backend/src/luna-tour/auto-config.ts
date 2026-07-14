/**
 * Luna Tour — AI auto-config (§5: 一句话 → 生效配置).
 *
 * Given a client profile + an optional one-liner brief, ask Gemini for a small
 * config fragment (language / narrative_focus / target_seconds / tone). The
 * brokerage guardrails + banned phrases are always force-merged AFTER, so a
 * loose brief can never bypass compliance.
 *
 * Best-effort: any failure returns undefined so createSession falls back to the
 * platform default config — never blocks tour generation.
 */
import { callGemini } from '../services/ai/gemini'
import { TourConfig } from './tour-script.types'

// Platform guardrails that always win (compliance floor).
const LOCKED_GUARDRAILS = [
  '不要承诺或保证任何回报率或升值',
  '只陈述提供的数字,不要编造任何价格、坐标或距离',
  '距离和配套来自真实地图数据,可直接、自然地陈述',
]
const LOCKED_BANNED = ['抱歉', '对不起', '无法']

function stripFence(t: string): string {
  return t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
}

/**
 * Draft a TourConfig from a client profile + one-liner. Returns a partial config
 * (caller merges over platform defaults), or undefined on any failure.
 */
export async function draftConfig(
  client: Record<string, unknown>,
  oneLiner: string
): Promise<Partial<TourConfig> | undefined> {
  const prompt = `你是迪拜房产导览的配置助手。根据「客户档案」和「经纪的一句话」,输出一份导览配置 JSON。

客户档案: ${JSON.stringify(client)}
经纪一句话: ${oneLiner || '(无)'}

只输出如下结构的 JSON,不要解释:
{
  "language": "zh" | "en" | "ar" | "ru",          // 客户母语优先
  "narrative_focus": "investment" | "lifestyle" | "family" | "value",
  "target_seconds": 120-200 之间的整数,
  "tone": "professional" | "warm" | "energetic"
}

规则:
- 投资客/重回报 → narrative_focus=investment;自住/家庭 → lifestyle 或 family。
- 一句话提到"快/简短" → target_seconds 偏小(120-150);"详细" → 偏大(180-200)。
- 拿不准就用 language=zh, narrative_focus=investment, target_seconds=165, tone=professional。`

  try {
    const { text } = await callGemini({
      task: 'auto-config',
      contents: prompt,
      config: { responseMimeType: 'application/json', temperature: 0.4 },
    })
    if (!text.trim()) return undefined
    const raw = JSON.parse(stripFence(text)) as Record<string, unknown>

    const language = ['zh', 'en', 'ar', 'ru'].includes(String(raw.language)) ? String(raw.language) : 'zh'
    const focus = String(raw.narrative_focus || 'investment')
    let seconds = Number(raw.target_seconds)
    if (!Number.isFinite(seconds)) seconds = 165
    seconds = Math.max(120, Math.min(200, Math.round(seconds)))

    return {
      language,
      narrative_focus: focus,
      target_seconds: seconds,
      // compliance floor — always applied, brief cannot override
      banned_phrases: LOCKED_BANNED,
      guardrails: LOCKED_GUARDRAILS,
    }
  } catch {
    return undefined
  }
}
