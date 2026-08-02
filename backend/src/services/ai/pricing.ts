/**
 * AI 单价 —— **全站唯一真相源**,且**不绑死 Gemini**。
 *
 * WHY 要重写这一层(2026-08-01):
 *   ① 原来的 `PRICING` 只有三个 Gemini 文本模型,`costUsd()` 对未知模型一律按 FLASH 估。
 *      → **TTS 和 Live 语音的成本全部算错**(它们按音频 token 计价,和文本差一个数量级),
 *        PDF 管线(旧 SDK)干脆一分钱都没记。账面成本是**偏低**的。
 *   ② 未来要换模型(ChatGPT / Claude / 别的),旧结构没有 provider 维度,
 *      换一次就要改一次算钱的代码。
 *
 * 所以这里的 key 是 **`provider:model`**,价格按**模态**拆开(文本进/出、音频进/出、
 * 缓存命中、thinking)。加一个新家族 = 往表里加几行,`costUsd()` 一行都不用改。
 *
 * ⚠️ **价格会变,而且没有 API 能查**。每条都带 `asOf`(核对日期)和 `verified`:
 *   verified: true  = 对着官方价格页逐条核对过
 *   verified: false = 按官方文档的口径推算/沿用,**换用前必须人工核对**
 * 跑 `npx ts-node -T scripts/check-ai-pricing.ts` 会把过期(>90 天)和未核对的列出来。
 */

/** 一个模型的单价(美元 / 每百万 token)。缺省的模态回落到 textIn/textOut。 */
export interface ModelPrice {
  provider: 'google' | 'openai' | 'anthropic'
  /** 文本输入 */
  textIn: number
  /** 文本输出(**thinking token 按这个价计费** —— 见 gemini.ts) */
  textOut: number
  /** 音频输入(Live API)。不填 = 该模型不吃音频 */
  audioIn?: number
  /** 音频输出(TTS / Live API)。**TTS 的钱几乎全在这里** */
  audioOut?: number
  /** 缓存命中的输入价(通常是 textIn 的 1/10 ~ 1/4)。不填 = 按 textIn 算 */
  cachedIn?: number
  /** 单价核对日期(YYYY-MM-DD) */
  asOf: string
  /** 是否逐条核对过官方价格页 */
  verified: boolean
  /** 给人看的说明:这个模型在项目里干什么活 */
  note?: string
}

/**
 * 单价表。**加模型只动这里。**
 *
 * key 一律 `provider:model`,和 `services/ai/models.ts` 里的模型 ID 对得上。
 */
export const PRICES: Record<string, ModelPrice> = {
  // ── Google Gemini(在用)───────────────────────────────────────────────
  'google:gemini-3.5-flash': {
    provider: 'google', textIn: 1.5, textOut: 9.0, cachedIn: 0.375,
    asOf: '2026-07-12', verified: true, note: '默认:生成/创作/抽取',
  },
  'google:gemini-3.1-flash-lite': {
    provider: 'google', textIn: 0.25, textOut: 1.5, cachedIn: 0.0625,
    asOf: '2026-07-12', verified: true, note: '轻活 / fallback',
  },
  'google:gemini-3.1-pro-preview': {
    provider: 'google', textIn: 2.0, textOut: 12.0, cachedIn: 0.5,
    asOf: '2026-07-12', verified: true, note: '复杂推理,无免费额度',
  },

  // ── Google:语音(**这两类原来全按文本价估,算出来是错的**)──────────────
  'google:gemini-3.1-flash-tts-preview': {
    provider: 'google', textIn: 0.5, textOut: 10.0, audioOut: 10.0,
    asOf: '2026-08-01', verified: false, note: 'tour 旁白合成;计费主体是音频输出',
  },
  'google:gemini-2.5-flash-preview-tts': {
    provider: 'google', textIn: 0.5, textOut: 10.0, audioOut: 10.0,
    asOf: '2026-08-01', verified: false, note: 'TTS 备用链',
  },
  'google:gemini-2.5-pro-preview-tts': {
    provider: 'google', textIn: 1.0, textOut: 20.0, audioOut: 20.0,
    asOf: '2026-08-01', verified: false, note: 'TTS 备用链(最后一档)',
  },
  'google:gemini-2.5-flash-native-audio-preview-12-2025': {
    provider: 'google', textIn: 0.5, textOut: 2.0, audioIn: 3.0, audioOut: 12.0,
    asOf: '2026-08-01', verified: false,
    note: 'Luna 实时语音。**audioOut 是文本输出的 6 倍** —— 一通电话比想象中贵',
  },

  // ── 备选 provider(**没在用,换之前必须核对**)──────────────────────────
  // 留在这里的意义:换模型时先在「换模型试算」里按当前 token 量算一遍要多少钱,
  // 而不是换完了看账单才知道。
  'openai:gpt-5.6-terra': {
    provider: 'openai', textIn: 2.0, textOut: 12.0,
    asOf: '2026-08-01', verified: false, note: '来自公开报价页,未对官方价目表',
  },
  'openai:gpt-5.6-luna': {
    provider: 'openai', textIn: 0.2, textOut: 1.2,
    asOf: '2026-08-01', verified: false, note: '便宜档,未核对',
  },
  'openai:gpt-5.6-sol': {
    provider: 'openai', textIn: 5.0, textOut: 30.0,
    asOf: '2026-08-01', verified: false, note: '旗舰档,未核对',
  },
  'anthropic:claude-opus-5': {
    provider: 'anthropic', textIn: 5.0, textOut: 25.0, cachedIn: 0.5,
    asOf: '2026-08-01', verified: true, note: '1M 上下文',
  },
  'anthropic:claude-sonnet-5': {
    provider: 'anthropic', textIn: 3.0, textOut: 15.0, cachedIn: 0.3,
    asOf: '2026-08-01', verified: true, note: '性价比档',
  },
  'anthropic:claude-haiku-4-5': {
    provider: 'anthropic', textIn: 1.0, textOut: 5.0, cachedIn: 0.1,
    asOf: '2026-08-01', verified: true, note: '最便宜',
  },
}

/** 未知模型的兜底(按在用的最贵文本档)—— **宁可高估也别显示 0**。 */
const FALLBACK_KEY = 'google:gemini-3.5-flash'

/** 裸模型名 → 表 key。调用方只写模型 ID,不用关心 provider 前缀。 */
export function priceKeyOf(model: string): string {
  if (model.includes(':')) return model
  if (model.startsWith('gemini-')) return `google:${model}`
  if (model.startsWith('gpt-') || model.startsWith('o')) return `openai:${model}`
  if (model.startsWith('claude-')) return `anthropic:${model}`
  return `google:${model}`
}

export function priceOf(model: string): ModelPrice {
  return PRICES[priceKeyOf(model)] || PRICES[FALLBACK_KEY]
}

/** 一次调用的 token 用量(按模态)。只填知道的,其余留空。 */
export interface Usage {
  inTokens?: number
  outTokens?: number
  /** thinking token —— **按输出价计费**,漏算会让账面成本腰斩 */
  thinkingTokens?: number
  audioInTokens?: number
  audioOutTokens?: number
  cachedInTokens?: number
}

/**
 * 算这次调用花了多少美元。
 *
 * 规则:音频价缺失时回落到文本价(总比按 0 算强);cachedIn 缺失按 textIn 算
 * (即当作没有缓存优惠 —— 同样是往高了估)。
 */
export function costUsd(model: string, u: Usage): number {
  const p = priceOf(model)
  const M = 1e6
  const audioIn = p.audioIn ?? p.textIn
  const audioOut = p.audioOut ?? p.textOut
  const cachedIn = p.cachedIn ?? p.textIn
  return (
    ((u.inTokens || 0) * p.textIn +
      ((u.outTokens || 0) + (u.thinkingTokens || 0)) * p.textOut +
      (u.audioInTokens || 0) * audioIn +
      (u.audioOutTokens || 0) * audioOut +
      (u.cachedInTokens || 0) * cachedIn) / M
  )
}

/**
 * 「换模型要多少钱」试算 —— 把**已经发生的** token 量,按另一个模型的单价重算。
 *
 * 这才是「未来换 ChatGPT / 换别的」时唯一有用的数字:不是听说谁便宜,
 * 而是**按我自己真实的进出 token 比例**算出来的月账单。
 * (前提:token 用量在不同 tokenizer 下有差异,这里按同量估算 —— 量级判断够用。)
 */
export function whatIfUsd(
  target: string,
  totals: { inTokens: number; outTokens: number }
): number {
  return costUsd(target, { inTokens: totals.inTokens, outTokens: totals.outTokens })
}

/** 单价过期(>N 天没核对)或从没核对过的条目 —— 给巡检脚本和 admin 看。 */
export function stalePrices(days = 90, today = new Date()): Array<{
  key: string; asOf: string; verified: boolean; ageDays: number
}> {
  const out: Array<{ key: string; asOf: string; verified: boolean; ageDays: number }> = []
  for (const [key, p] of Object.entries(PRICES)) {
    const ageDays = Math.floor((today.getTime() - new Date(p.asOf).getTime()) / 86_400_000)
    if (!p.verified || ageDays > days) out.push({ key, asOf: p.asOf, verified: p.verified, ageDays })
  }
  return out.sort((a, b) => b.ageDays - a.ageDays)
}
