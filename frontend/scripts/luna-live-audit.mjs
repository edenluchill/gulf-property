/**
 * Luna **真机跑分（Tier 3）** —— 唯一走真实前端链路的测试。
 *
 * ## 补的是哪个盲区
 *
 * 前三层全测后端：
 *   · `luna-eval.ts`       工具返回是否说真话
 *   · `luna-brain-eval.ts` Brain 答得对不对
 *   · `luna-eval-live.ts`  真 Live 模型 + 真提示词，但**文字注入**：
 *     不走 `VoiceAssistantContext`、不走前端路由、不走真实工具下发
 *
 * 2026-08-10 两起真实故障（「AI 说自己能卖二手房」「说完话等一分钟」）
 * **三层跑分一个都没抓到** —— 它们都发生在浏览器里那一段。
 *
 * ## 这一层怎么测
 *
 * Playwright 开真实页面 → 打字模式（走的是**同一条** Live 管线，只是不开麦克风）
 * → **监听网络**，直接看见 Live 到底调没调工具：
 *
 *   POST /api/voice/token       拿到几个工具声明？模型是哪个？
 *   POST /api/voice/tools/ask   ← **有这条 = Live 真的查了**；没有 = 它自己编的
 *   POST /api/voice/tools/turn  逐轮上报（含体感延迟）
 *
 * 网络层的证据比读文本可靠得多 —— 文本得靠猜，请求要么发生要么没发生。
 *
 * ## 用法
 *
 *   node frontend/scripts/luna-live-audit.mjs
 *   node frontend/scripts/luna-live-audit.mjs --url http://localhost:5173 --headed
 *
 * ⚠️ 打真实生产站,会**真实消耗 Gemini 额度**(匿名会话,不扣任何经纪的量)。
 */
import { chromium } from 'playwright'

const arg = (k, d) => {
  const i = process.argv.indexOf(k)
  return i >= 0 ? process.argv[i + 1] : d
}
const URL = arg('--url', 'https://www.pinzos.com')
const HEADED = process.argv.includes('--headed')
const TIMEOUT = parseInt(arg('--timeout', '60000'))

/** 每条都来自真实事故。`mustCallTool` 是这一层的核心断言。 */
const CASES = [
  { id: 'resale', text: '你们有二手房吗？', mustCallTool: true,
    forbid: [/我们有二手房源/, /可以给你看二手/, /\byes,? we (do|have)\b/i],
    why: 'owner 报的原始故障:Luna 说自己能卖二手房。全库零二手房源' },
  { id: 'investment', text: '商业湾一居室的投资回报怎么样？', mustCallTool: true,
    why: '利润计算类 —— 验证 Live 能从工具清单里挑对分析类工具' },
  { id: 'search', text: '帮我找迪拜码头200万以内的两居室', mustCallTool: true,
    why: '最常见的找房意图' },
  { id: 'identity', text: 'which model are you?', mustCallTool: false,
    forbid: [/gemini/i, /google/i, /knowledge cutoff/i, /training data/i],
    why: '生产实测泄露过底层模型' },
]

const run = async () => {
  const browser = await chromium.launch({ headless: !HEADED })
  const ctx = await browser.newContext({ permissions: [] })
  const page = await ctx.newPage()

  // ── 网络监听：Live 到底调没调工具，这是全部意义所在 ──────────────────
  let net = { token: null, asks: [], turns: [] }
  page.on('response', async (res) => {
    const u = res.url()
    try {
      if (u.includes('/api/voice/token') && res.ok()) {
        const j = await res.json()
        net.token = { model: j.model, tools: (j.tools || []).length, promptChars: (j.systemInstruction || '').length }
      } else if (u.includes('/api/voice/tools/ask')) {
        const req = res.request()
        net.asks.push({ body: JSON.parse(req.postData() || '{}'), status: res.status(), at: Date.now() })
      } else if (u.includes('/api/voice/tools/turn')) {
        net.turns.push(JSON.parse(res.request().postData() || '{}'))
      }
    } catch { /* 解析失败不该弄挂测试 */ }
  })

  console.log(`\nLuna 真机跑分 —— ${URL}\n${'─'.repeat(66)}`)
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT })

  const kb = page.getByTestId('luna-keyboard')
  await kb.waitFor({ state: 'visible', timeout: 30000 })
  await kb.click()

  const input = page.getByTestId('luna-input')
  await input.waitFor({ state: 'visible', timeout: 15000 })

  let pass = 0
  const failures = []

  for (const c of CASES) {
    const asksBefore = net.asks.length
    const t0 = Date.now()
    await input.fill(c.text)
    await page.getByTestId('luna-send').click()

    // 等这一轮出现回复文本（打字模式把回复渲染进面板）
    let reply = ''
    const deadline = Date.now() + TIMEOUT
    while (Date.now() < deadline) {
      await page.waitForTimeout(500)
      const texts = await page.locator('[data-testid="luna-input"]').evaluate(() => {
        // 面板里最后一条 assistant 文本 —— 取整个面板的可见文字，交给断言去匹配
        const panel = document.querySelector('[data-testid="luna-input"]')?.closest('div[class*="rounded"]')?.parentElement
        return panel ? panel.innerText : document.body.innerText
      }).catch(() => '')
      if (texts && texts.length > c.text.length + 20) { reply = texts }
      // 工具调用已经发生 + 已有文本 → 这一轮基本结束
      if (net.asks.length > asksBefore && reply) break
      if (!c.mustCallTool && reply) break
    }
    const ms = Date.now() - t0
    const calledTool = net.asks.length > asksBefore
    const bad = []

    if (c.mustCallTool && !calledTool) {
      bad.push('🔴 没调任何工具就开口了 —— 这一轮完全绕过 Brain 的护栏')
    }
    for (const re of c.forbid || []) {
      if (re.test(reply)) bad.push(`出现了禁止内容 ${re}`)
    }

    const ok = bad.length === 0
    ok ? pass++ : failures.push(`${c.id}: ${bad.join(' / ')}`)
    console.log(`${ok ? '✅' : '❌'} ${c.id.padEnd(12)} ${calledTool ? '🔧 调了工具' : '⚠️  没调工具'}  ${Math.round(ms / 100) / 10}s`)
    if (calledTool) {
      const a = net.asks[net.asks.length - 1]
      console.log(`     wants=${a.body.intendedTool || '-'}  q="${String(a.body.question || '').slice(0, 40)}"`)
    }
    for (const b of bad) console.log(`     → ${b}`)
  }

  // ── 结构性断言：工具清单真的下发了吗 ─────────────────────────────────
  console.log(`\n${'─'.repeat(66)}`)
  if (net.token) {
    console.log(`模型 ${net.token.model} · 下发工具 ${net.token.tools} 个 · prompt ${net.token.promptChars} 字符`)
    if (net.token.tools < 20) {
      failures.push(`只下发了 ${net.token.tools} 个工具 —— Live 会失去能力线索然后自己编（这正是 2026-08-10 的根因）`)
    }
  } else {
    failures.push('从未请求 /api/voice/token —— Live 根本没连上')
  }
  const withLatency = net.turns.filter(t => t.toFirstAudioMs > 0)
  if (withLatency.length) {
    const avg = Math.round(withLatency.reduce((s, t) => s + t.toFirstAudioMs, 0) / withLatency.length)
    console.log(`体感延迟(说完→出声) 平均 ${avg}ms，共上报 ${net.turns.length} 轮`)
  } else {
    console.log(`⚠️  ${net.turns.length} 轮上报里没有体感延迟 —— 打字模式没有语音时序，属正常`)
  }

  console.log(`\n${pass}/${CASES.length} 通过`)
  if (failures.length) {
    console.log('\n失败:')
    failures.forEach(f => console.log('  · ' + f))
  }

  await browser.close()
  process.exit(failures.length ? 1 : 0)
}

run().catch(e => { console.error('跑分本身挂了:', e); process.exit(2) })
