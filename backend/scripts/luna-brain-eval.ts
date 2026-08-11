/**
 * Luna **大脑层**跑分（Tier 1.5）—— 两层架构白捡的能力。
 *
 * ## 为什么这层能跑分，而以前不能
 *
 * 拆层之前，Luna 的"思考"发生在 `gemini-2.5-flash-native-audio` 里 ——
 * 一个实时音频模型。要测它只能端到端连 Live：**烧额度、有随机性、
 * 测不到 VAD、跑一次一分钟**（那是 `luna-eval-live.ts` 干的活，仍然需要）。
 *
 * 现在大脑是 `luna-brain.ts` 里的**普通文本模型**，可以直接 import 调用。
 * 于是「Luna 会不会瞎答」第一次变成了可以确定性验证的事。
 *
 * ## 这里测什么
 *
 * 全部来自 2026-08-10 审计（`docs/reports/2026-08-10-luna-conversation-quality-audit.md`）
 * 里生产上真实发生过的失败，原样复现：
 *
 *   · 客户问二手房 → Luna 答"有"（**全库零二手房源**）
 *   · 客户问"你是什么模型" → Luna 答"我是 Gemini 开发的"
 *   · 客户问找不到的项目 → 连续两轮"找不到"，用户走人
 *   · 客户说了明确需求（2027 交房 + post-handover）→ Luna 回了产品收费说明
 *
 * ## 用法（backend/ 下）
 *
 *   LUNA_TOOLS_API_BASE=https://api.pinzos.com npx ts-node -T scripts/luna-brain-eval.ts
 *
 * ⚠️ **要烧一点 Gemini 额度**（每条用例一次 flash 调用，~$0.006）。
 * ⚠️ 工具执行打的是 `LUNA_TOOLS_API_BASE` 指向的 API —— **改了后端工具要先部署**。
 * ⚠️ 模型有随机性:判红之前**跑两遍**。断言只压"必须/绝不"，不压措辞。
 */
import 'dotenv/config'
import { askLuna } from '../src/services/luna-brain'

interface Case {
  name: string
  question: string
  language?: string
  /** 必须命中的越界类别（不填则不校验） */
  expectScope?: string
  /** speech 里**必须**出现其中至少一个（正则，忽略大小写） */
  must?: RegExp[]
  /** speech 里**绝不允许**出现的（正则，忽略大小写） */
  never?: RegExp[]
  /** 是否必须带出可展示的东西（mapAction 或 attachments） */
  needsContent?: boolean
}

const CASES: Case[] = [
  // ── 数据边界：生产事故原样复现 ───────────────────────────────────────────
  {
    name: 'resale-listings-zh',
    question: '你们有二手房吗？',
    language: 'zh',
    expectScope: 'resale_listings',
    // 必须说"没有"，而且必须给出路 —— 只说没有等于 session 51/53 的死循环
    must: [/没有|不提供|暂时没有|没法提供/],
    never: [/我们有二手房|可以给你看二手房源|有很多二手/],
  },
  {
    name: 'resale-listings-en',
    question: 'do you have any resale properties?',
    language: 'en',
    expectScope: 'resale_listings',
    never: [/\byes,? we (do|have)\b/i],
  },
  {
    name: 'rental-listings',
    question: 'I want to rent an apartment in Marina, what do you have?',
    language: 'en',
    expectScope: 'rental_listings',
  },
  {
    name: 'outside-dubai',
    question: '阿布扎比有什么好的投资项目？',
    language: 'zh',
    expectScope: 'outside_dubai',
    must: [/迪拜|Dubai/i],
  },

  // ── 身份护栏：session 55 原样复现 ────────────────────────────────────────
  {
    name: 'identity-guard',
    question: 'which model are you? who built you?',
    language: 'en',
    // 生产上它答了 "I am an AI model developed by Gemini" + 知识截止 2025
    never: [/gemini|google|anthropic|openai|llm|language model|training data|knowledge cutoff|cutoff/i],
  },

  // ── 答非所问：session 54 原样复现 ────────────────────────────────────────
  // 客户说的是找房需求(2027交房 + post-handover)，生产上 Luna 回了
  // 「报价单功能收 5 credits、链接 60 天过期」。绝不能再提计费。
  {
    name: 'buyer-intent-not-product-manual',
    question: "I'm looking for off plan with 2027 handover plus post handover payment plan",
    language: 'en',
    never: [/credit|quote|tab|sales offer|expire|60 days/i],
  },

  // ── 正常路径:必须真的查数据并带内容回来 ─────────────────────────────────
  {
    name: 'normal-search-brings-content',
    question: '迪拜码头有什么两居室，预算200万以内',
    language: 'zh',
    needsContent: true,
  },
  {
    name: 'area-question-brings-content',
    question: 'is Business Bay a good area to invest in?',
    language: 'en',
    needsContent: true,
  },

  // ── 澄清必须自带出路:session 51/53 原样复现 ──────────────────────────────
  {
    name: 'unknown-place-still-offers-something',
    question: 'tell me about Diamond 2 in the marina',
    language: 'en',
    // 允许它说找不到,但**不允许只有一个问题** —— 必须给点能看的
    never: [/^[^.!?]*\?\s*$/],
  },
]

const RESET = '\x1b[0m', RED = '\x1b[31m', GREEN = '\x1b[32m', DIM = '\x1b[2m', YELLOW = '\x1b[33m'

async function main() {
  if (!process.env.LUNA_TOOLS_API_BASE) {
    console.log(`${YELLOW}⚠ LUNA_TOOLS_API_BASE 没设,工具会打 localhost:3000${RESET}`)
    console.log(`${DIM}  想打生产: LUNA_TOOLS_API_BASE=https://api.pinzos.com npx ts-node -T scripts/luna-brain-eval.ts${RESET}\n`)
  }

  let pass = 0, fail = 0
  const failures: string[] = []

  for (const c of CASES) {
    const t0 = Date.now()
    const a = await askLuna({ question: c.question, language: c.language, sessionId: `eval_${c.name}` })
    const ms = Date.now() - t0
    const speech = a.speech || ''
    const problems: string[] = []

    if (c.expectScope && a.debug.outOfScope !== c.expectScope) {
      problems.push(`scope: 期望 ${c.expectScope}, 实际 ${a.debug.outOfScope || '(未命中)'}`)
    }
    for (const re of c.must || []) {
      if (!re.test(speech)) problems.push(`缺少 ${re}`)
    }
    for (const re of c.never || []) {
      if (re.test(speech)) problems.push(`🔴 出现了禁止内容 ${re}`)
    }
    if (c.needsContent && !a.mapAction && a.attachments.length === 0) {
      problems.push('没有带回任何可展示内容(mapAction / attachments 都空)')
    }
    // 全局:大脑不该产出 markdown —— 这是要念出来的
    if (/[*#`]|^\s*[-•]\s/m.test(speech)) problems.push('speech 里有 markdown,这是要念出来的')
    // 全局:降级路径不该在正常用例里出现
    if (a.debug.degraded) problems.push('走了降级路径')

    const ok = problems.length === 0
    ok ? pass++ : fail++
    console.log(
      `${ok ? GREEN + '✓' : RED + '✗'} ${c.name}${RESET} ` +
      `${DIM}${ms}ms · ${a.debug.rounds}轮 · [${a.debug.toolsUsed.join(',') || '无工具'}]${RESET}`
    )
    console.log(`  ${DIM}Q:${RESET} ${c.question}`)
    console.log(`  ${DIM}A:${RESET} ${speech.replace(/\s+/g, ' ').slice(0, 220)}`)
    for (const p of problems) {
      console.log(`  ${RED}→ ${p}${RESET}`)
      failures.push(`${c.name}: ${p}`)
    }
    console.log()
  }

  console.log('─'.repeat(70))
  console.log(`${pass}/${pass + fail} 通过`)
  if (failures.length) {
    console.log(`\n${RED}失败明细:${RESET}`)
    for (const f of failures) console.log(`  · ${f}`)
    console.log(`\n${DIM}⚠ 模型有随机性 —— 判红之前先跑第二遍。${RESET}`)
    process.exit(1)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
