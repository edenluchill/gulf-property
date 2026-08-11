/**
 * 经纪产品教练 —— **教经纪怎么用这个产品**，不是房产顾问。
 *
 * ## 为什么单独做一个
 *
 * 2026-08-11 owner 在真实会话里看到经纪问 Luna：
 * 「我怎么样联系客人，我怎么样把这个软件发给客人。」
 *
 * Luna 答得不算错（走了 `explain_feature`），但这件事本身是错位的：
 *   · **Luna 是房产顾问**，主职是带客户看房。产品教学做成它的副业，
 *     就会变成 2026-08-10 那个故障：客户问房子，她背产品手册。
 *   · `explain_feature` 是**关键词匹配 + 一次一条**。经纪的真实问题是
 *     目标导向的（「我想让客户看到资料」），需要串起好几个功能给步骤。
 *   · 经纪问的是**操作**问题 —— 要边看边点。**文字比语音合适。**
 *
 * ## 三条设计决定（都来自 owner 对第一版的反馈）
 *
 * 1. **结构化输出，不是 markdown。** 第一版让模型吐 markdown，而前端没有
 *    渲染库，结果满屏 `**粗体**` 和裸星号 —— owner 一句「感觉不好看」。
 *    改成 `{lead, steps[], caveats[]}`：前端能画成真正的步骤卡，
 *    还能**逐条淡入**（owner：「这个 guide 没有 animation 感觉很难 follow」）。
 *
 * 2. **standard 的问题不该每次问 AI。** owner：「每次都要等一会几秒，
 *    是触发 API call 了吗？为啥？这些不是 standard 的吗」——**他是对的**。
 *    「怎么用 AI 导览」的答案永远一样，凭什么每次烧一次 LLM 还让人等 4 秒。
 *    现在：命中某个功能 → **直接用 product-guide 组装**（<5ms，零 token）；
 *    只有真正开放式的问题（「客户看不到我发的导览」这种诊断题）才走模型。
 *
 * 3. **模型结果也缓存。** 同一个问法第二个人问就该秒回。
 *
 * ## 和 Luna 的分工
 *
 *   Luna  → 客户 · 房产 · 语音 · 只念 Brain 写好的话
 *   Coach → 经纪 · 产品 · 文字 · 目标导向，串功能给步骤
 *
 * 知识库共用 `product-guide.ts`（**唯一真相源**）—— 加功能只改那一处。
 */
import { FLASH, FLASH_LITE } from './ai/models'
import { callGemini } from './ai/gemini'
import { counter, histogram } from '../telemetry'
import { allFeatures, findFeatures, describeFeature, type Feature } from './product-guide'

export interface CoachAsk {
  question: string
  language?: string
  /** 他现在在哪个页面 —— 能说出「你现在这个页面上…」 */
  path?: string
}

export interface CoachStep {
  /** 做什么 */
  text: string
  /** 点哪里 —— 前端单独画成灰字。含糊的指路等于没指 */
  where: string | null
}

export interface CoachAnswer {
  /** 一句话结论 */
  lead: string
  steps: CoachStep[]
  /** 坑 —— 前端单独用琥珀色画，这部分比功能介绍值钱 */
  caveats: string[]
  features: Array<{
    id: string
    name: string
    where: string
    caveat?: string
    cost?: string
    href?: string
  }>
  debug: { ms: number; source: 'preset' | 'cache' | 'model' | 'fallback' }
}

/** 功能 id → 站内直达路径。有就给按钮，让他一步点过去，别自己找。 */
const FEATURE_HREF: Record<string, string> = {
  'live-tour': '/agent',
  'ai-tour': '/agent/tour',
  'sales-offer': '/agent',
  'client-report': '/agent/report',
  'branded-report': '/agent/report',
  crm: '/agent/clients',
  'roi-simulator': '/agent/roi',
  referral: '/agent/promo',
  'map-timeline': '/',
  'map-measure': '/',
  favorites: '/',
  'upload-brochure': '/agent',
  billing: '/agent/billing',
}

function zhLike(q: string, ui?: string) {
  if (/[一-鿿]/.test(q)) return true
  if (/[a-zA-Z]/.test(q)) return false
  return !!ui?.startsWith('zh')
}

function toCard(f: Feature, lang: 'zh' | 'en') {
  const d = describeFeature(f, lang)
  return { id: f.id, name: d.feature, where: d.where, caveat: d.caveat, cost: d.cost, href: FEATURE_HREF[f.id] }
}

/**
 * 🔴 **预置答案 —— 命中某个功能就直接组装，不过模型。**
 *
 * owner 的质疑成立：「怎么用 X」的答案是**固定的**，product-guide 里
 * 已经写着「解决什么 / 在哪点 / 什么坑 / 多少钱」。每次拿去问一遍 LLM，
 * 既烧 token 又让人等 4 秒，答出来的还是同一段话。
 *
 * 判据**保守**：只有匹配分明显领先才走预置。意图不明确、或者是诊断类问题
 * （「客户看不到我发的导览」），仍然交给模型 —— 那里模型有真正的增量价值。
 */
function preset(question: string, lang: 'zh' | 'en'): CoachAnswer | null {
  const hits = findFeatures(question, 3)
  if (!hits.length) return null
  const top = hits[0]
  // 第二名分数接近 = 意图不明确，交给模型
  if (hits[1] && hits[1].score > top.score * 0.7) return null

  const f = top.feature
  const d = describeFeature(f, lang)

  const steps: CoachStep[] = [
    { text: lang === 'zh' ? `打开「${d.feature}」` : `Open ${d.feature}`, where: d.where },
    { text: d.solves, where: null },
  ]
  if (d.cost) {
    steps.push({ text: lang === 'zh' ? `费用：${d.cost}` : `Cost: ${d.cost}`, where: null })
  }

  const caveats: string[] = []
  if (d.caveat) caveats.push(d.caveat)
  if (f.audience === 'agent-pro') {
    caveats.push(lang === 'zh' ? '这个功能属于专业版套餐。' : 'This feature is part of the Pro plan.')
  }

  return {
    lead: lang === 'zh' ? `${d.feature}：${d.solves}` : `${d.feature} — ${d.solves}`,
    steps,
    caveats,
    features: hits.map(h => toCard(h.feature, lang)),
    debug: { ms: 0, source: 'preset' },
  }
}

/**
 * 模型答案缓存。同一个问法第二个人问就该秒回 —— 产品手册不会变，
 * 真变了也是我们改代码的时候（重启即失效，正好）。
 */
const cache = new Map<string, { at: number; answer: CoachAnswer }>()
const CACHE_TTL_MS = 12 * 60 * 60 * 1000
const CACHE_MAX = 300

function cacheKey(q: string, lang: string, path?: string) {
  return `${lang}|${path || ''}|${q.toLowerCase().replace(/\s+/g, ' ').trim()}`
}

/**
 * 结构化输出 schema。
 * ⚠️ **每个字段都必须 required 且允许 null** —— optional 字段模型可以合法地
 * 「不填」，明说了的信息也会静默消失（memory `gemini-model-and-schema-traps`）。
 */
const SCHEMA = {
  type: 'object',
  properties: {
    lead: { type: 'string', description: 'One-sentence answer. No markdown.' },
    steps: {
      type: 'array',
      description: '2-5 numbered steps. Each says what to do; `where` says exactly where to click.',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          where: { type: 'string', nullable: true, description: 'Where to click. null if this step needs no location.' },
        },
        required: ['text', 'where'],
      },
    },
    caveats: {
      type: 'array',
      description: 'The gotchas they would otherwise hit. Empty array if none.',
      items: { type: 'string' },
    },
  },
  required: ['lead', 'steps', 'caveats'],
}

function systemPrompt(lang: 'zh' | 'en', path?: string): string {
  const catalog = allFeatures()
    .map(f => {
      const d = describeFeature(f, lang)
      return `### ${f.id} · ${d.feature}\n解决: ${d.solves}\n在哪: ${d.where}\n面向: ${d.who_can_use}` +
        (d.cost ? `\n花费: ${d.cost}` : '') + (d.caveat ? `\n⚠️ 坑: ${d.caveat}` : '')
    })
    .join('\n\n')

  return lang === 'zh'
    ? `你是 Pinzos 的产品教练，教**房产经纪**怎么用这个系统。用户是忙碌的一线经纪，不是工程师。

${path ? `他现在在页面 \`${path}\`。答案就在这个页面上的话，lead 里先说「你现在这个页面上…」。\n` : ''}
## 你只能讲下面这些功能，一个字都不许发明

${catalog}

## 规则

- \`lead\` 一句话给结论。**不要 markdown、不要星号** —— 输出会被直接渲染成卡片。
- \`steps\` 每条只说一个动作；\`where\` 照抄上面的「在哪」，**具体到点哪里**，
  别含糊成「在设置里」。这一步不需要位置就填 null。
- \`caveats\` 放上面标 ⚠️ 的坑（比如导览默认是草稿、不发布客户看不到）。
  他没问也要放 —— 那才是真正值钱的部分。标 agent-pro 的功能在这里说明属于专业版。
- 不知道就在 lead 里直说，并让他去建议板问真人。编一个不存在的按钮，
  他会找到放弃为止。
- 简短：2-5 步。`
    : `You are the product coach for Pinzos, teaching **real-estate agents** how to use this system. Busy agents, not engineers.

${path ? `They are on \`${path}\`. If the answer is on this very page, open the lead with that.\n` : ''}
## These are the only features you may describe. Invent nothing.

${catalog}

## Rules

- \`lead\`: one sentence. **No markdown, no asterisks** — this renders straight into a card.
- \`steps\`: one action each; \`where\` copies the "where" above and must say exactly where to click. null when a step needs no location.
- \`caveats\`: the gotchas marked ⚠️ (e.g. a tour stays a draft until published). Include them unasked — that is the valuable part. Flag agent-pro features as Pro here.
- If you don't know, say so in the lead and point them at the requests board. A button you invent is one they will hunt for until they give up.
- Keep it to 2-5 steps.`
}

export async function askCoach(ask: CoachAsk): Promise<CoachAnswer> {
  const t0 = Date.now()
  const lang: 'zh' | 'en' = zhLike(ask.question, ask.language) ? 'zh' : 'en'

  // ① 预置 —— 「怎么用 X」这类固定答案，零 LLM、零等待
  const p = preset(ask.question, lang)
  if (p) {
    counter('agent.coach', { result: 'preset' }).inc()
    return { ...p, debug: { ms: Date.now() - t0, source: 'preset' } }
  }

  // ② 缓存 —— 同一个问法第二个人问秒回
  const key = cacheKey(ask.question, lang, ask.path)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    counter('agent.coach', { result: 'cache' }).inc()
    return { ...hit.answer, debug: { ms: Date.now() - t0, source: 'cache' } }
  }

  const features = findFeatures(ask.question, 3).map(h => toCard(h.feature, lang))

  // ③ 真正开放式的问题才问模型
  try {
    const r = await callGemini({
      task: 'agent-coach',
      models: [FLASH, FLASH_LITE],
      contents: [{ role: 'user', parts: [{ text: ask.question }] }],
      config: {
        systemInstruction: systemPrompt(lang, ask.path),
        responseMimeType: 'application/json',
        responseSchema: SCHEMA,
        thinkingConfig: { thinkingLevel: 'low' },
      },
    })
    const j = JSON.parse(r.text)
    const answer: CoachAnswer = {
      lead: String(j.lead || ''),
      steps: Array.isArray(j.steps)
        ? j.steps.map((s: { text?: unknown; where?: unknown }) => ({
            text: String(s.text || ''),
            where: s.where ? String(s.where) : null,
          }))
        : [],
      caveats: Array.isArray(j.caveats) ? j.caveats.map(String) : [],
      features,
      debug: { ms: Date.now() - t0, source: 'model' },
    }
    if (cache.size >= CACHE_MAX) cache.clear()   // 简单粗暴够用：手册不常变
    cache.set(key, { at: Date.now(), answer })
    counter('agent.coach', { result: 'model' }).inc()
    histogram('agent.coach.ms', {}).observe(answer.debug.ms)
    return answer
  } catch (e) {
    counter('agent.coach', { result: 'error' }).inc()
    console.error('[AgentCoach] failed:', e)
    // 模型挂了也要给点有用的 —— 匹配到的功能卡本身就是答案的一半。
    return {
      lead: lang === 'zh'
        ? '这个我暂时答不上来。下面是可能相关的功能，或者去建议板问一句，我们看得到。'
        : "I can't answer that right now. Here are the features that look related — or ask on the requests board, we read those.",
      steps: [],
      caveats: [],
      features,
      debug: { ms: Date.now() - t0, source: 'fallback' },
    }
  }
}
