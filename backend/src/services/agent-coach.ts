/**
 * 经纪产品教练 —— **教经纪怎么用这个产品**，不是房产顾问。
 *
 * ## 为什么单独做一个
 *
 * 2026-08-11 owner 在真实会话里看到经纪问 Luna：
 * 「我怎么样联系客人，我怎么样把这个软件发给客人。」
 *
 * Luna 答得不算错（走了 `explain_feature`），但这件事本身是错位的：
 *   · **Luna 是房产顾问**，主职是带客户看房。产品教学是它的副业，
 *     而副业做多了就会变成 2026-08-10 那个故障：客户问房子，她背产品手册。
 *   · `explain_feature` 是**关键词匹配 + 一次一条**。经纪的真实问题是
 *     目标导向的（「我想让客户看到资料」），需要串起好几个功能给步骤。
 *   · 经纪问的是**操作**问题 —— 要边看边做、要能复制链接。
 *     **文字比语音合适**，听完就忘的语音教学反而更差。
 *
 * ## 和 Luna 的分工
 *
 *   Luna         → 客户 · 房产 · 语音 · 只念 Brain 写好的话
 *   Coach（这里）→ 经纪 · 产品 · 文字 · 目标导向，串功能给步骤
 *
 * 知识库共用 `product-guide.ts`（**唯一真相源**，13 个功能）——
 * 加功能只改那一处，两边同时生效。
 *
 * ⚠️ `product-guide` 里**只有能对外说的功能**（admin/* 和已下架的都不在），
 * 所以这里可以放心把全量喂给模型。
 */
import { FLASH, FLASH_LITE } from './ai/models'
import { callGemini } from './ai/gemini'
import { counter, histogram } from '../telemetry'
import { allFeatures, findFeatures, describeFeature } from './product-guide'

export interface CoachAsk {
  question: string
  /** 界面语言，只在问题看不出语种时兜底 */
  language?: string
  /** 他现在在哪个页面，帮模型给出「你现在这个页面上…」这种指路 */
  path?: string
}

export interface CoachAnswer {
  /** 面向经纪的回答，markdown（这是**看**的，不是念的 —— 跟 Luna 相反） */
  answer: string
  /** 相关功能卡：名字 / 在哪点 / 坑 / 直达链接 */
  features: Array<{
    id: string
    name: string
    where: string
    caveat?: string
    cost?: string
    href?: string
  }>
  debug: { ms: number; model: string; degraded: boolean }
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

function systemPrompt(lang: 'zh' | 'en', path?: string): string {
  // 全量喂进去 —— 只有 13 条，而且经纪的问题经常要串好几个功能。
  const catalog = allFeatures()
    .map(f => {
      const d = describeFeature(f, lang)
      return `### ${f.id} · ${d.feature}\n` +
        `解决: ${d.solves}\n在哪: ${d.where}\n面向: ${d.who_can_use}` +
        (d.cost ? `\n花费: ${d.cost}` : '') +
        (d.caveat ? `\n⚠️ 坑: ${d.caveat}` : '')
    })
    .join('\n\n')

  return lang === 'zh'
    ? `你是 Pinzos 的产品教练，教**房产经纪**怎么用这个系统。你的用户是忙碌的一线经纪，不是工程师。

${path ? `他现在在页面 \`${path}\`。如果答案就在这个页面上，先说「你现在这个页面上…」。\n` : ''}
## 你只能讲下面这些功能，一个字都不许发明

${catalog}

## 怎么回答

- **先给一句结论**，再给编号步骤。经纪要照着点，不要读散文。
- 步骤必须具体到**点哪里**——上面每条都写了「在哪」，照抄，别含糊成「在设置里」。
- **主动说坑**。上面标 ⚠️ 的地方是人最容易栽的（比如导览默认是草稿、不发布客户看不到），
  他没问也要提。
- 一个目标经常要串几个功能（"想让客户看资料" = 生成导览 → 发布 → 复制链接）。串起来讲。
- 上面标「agent-pro」的功能**要说明属于专业版**。他自己知道有没有买 —— 我们只要别让他白点一个用不了的按钮。
- **不知道就说不知道**，然后告诉他去问真人。编一个不存在的按钮，他会找到放弃为止。
- 简短。3-6 句话或 3-5 个步骤，别写说明书。`
    : `You are the product coach for Pinzos. You teach **real-estate agents** how to use this system. Your users are busy agents, not engineers.

${path ? `They are currently on \`${path}\`. If the answer is on this very page, lead with that.\n` : ''}
## These are the only features you may describe. Invent nothing.

${catalog}

## How to answer

- **Lead with the one-line answer**, then numbered steps. They will follow along by clicking.
- Steps must say **where to click** — each entry above has a "where"; copy it. Never vague ("in settings").
- **Volunteer the caveats.** The ⚠️ items are what people actually get wrong (e.g. a tour is a draft until published). Mention them unasked.
- One goal often spans several features (want the client to see something = build tour → publish → copy link). Connect them.
- Features marked agent-pro **must be flagged as Pro**. They know whether they bought it — we just must not send them hunting for a button they cannot use.
- **Say when you don't know**, then point them at a human. A button you invent is one they will hunt for until they give up.
- Keep it short: 3-6 sentences or 3-5 steps.`
}

export async function askCoach(ask: CoachAsk): Promise<CoachAnswer> {
  const t0 = Date.now()
  const lang: 'zh' | 'en' = zhLike(ask.question, ask.language) ? 'zh' : 'en'

  // 相关功能卡：用关键词匹配挑 3 条给 UI —— 模型讲道理，卡片给直达。
  const hits = findFeatures(ask.question, 3)
  const features = hits.map(h => {
    const d = describeFeature(h.feature, lang)
    return {
      id: h.feature.id,
      name: d.feature,
      where: d.where,
      caveat: d.caveat,
      cost: d.cost,
      href: FEATURE_HREF[h.feature.id],
    }
  })

  try {
    const r = await callGemini({
      task: 'agent-coach',
      models: [FLASH, FLASH_LITE],
      contents: [{ role: 'user', parts: [{ text: ask.question }] }],
      config: {
        systemInstruction: systemPrompt(lang, ask.path),
        thinkingConfig: { thinkingLevel: 'low' },
      },
    })
    const ms = Date.now() - t0
    counter('agent.coach', { result: 'ok' }).inc()
    histogram('agent.coach.ms', {}).observe(ms)
    return { answer: r.text.trim(), features, debug: { ms, model: r.model, degraded: false } }
  } catch (e) {
    counter('agent.coach', { result: 'error' }).inc()
    console.error('[AgentCoach] failed:', e)
    // 兜底：模型挂了也要给点有用的 —— 关键词匹配到的功能卡本身就是答案的一半。
    return {
      answer: lang === 'zh'
        ? '这个我暂时答不上来。下面是可能相关的功能，或者直接在「建议板」问一句，我们看得到。'
        : "I can't answer that right now. Here are the features that look related — or drop a note on the requests board, we read those.",
      features,
      debug: { ms: Date.now() - t0, model: 'none', degraded: true },
    }
  }
}
