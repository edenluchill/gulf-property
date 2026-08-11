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
/**
 * 登录态文件（Playwright storageState）。
 *
 * ⚠️ **生产站有匿名额度墙**：跑几次之后会弹「今天的免费探索先到这里」，
 * 一个 z-[600] 的全屏遮罩把所有点击都吃掉 —— 第二版就栽在这，
 * 表现是 click 一直 retry 到超时，看不出原因。
 *
 * 存一次登录态：
 *   npx playwright open --save-storage=luna-auth.json https://www.pinzos.com
 * 然后：
 *   node frontend/scripts/luna-live-audit.mjs --storage luna-auth.json
 */
const STORAGE = arg('--storage', null)

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
  const ctx = await browser.newContext({ permissions: [], ...(STORAGE ? { storageState: STORAGE } : {}) })
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
        // 服务端自己报的耗时才是 Brain 的真实延迟 —— 墙钟里混着浏览器和轮询
        let serverMs = null
        try { serverMs = (await res.json())?.debug?.ms ?? null } catch { /* ignore */ }
        net.asks.push({ body: JSON.parse(req.postData() || '{}'), status: res.status(), serverMs, at: Date.now() })
      } else if (u.includes('/api/voice/tools/turn')) {
        net.turns.push(JSON.parse(res.request().postData() || '{}'))
      }
    } catch { /* 解析失败不该弄挂测试 */ }
  })

  console.log(`\nLuna 真机跑分 —— ${URL}\n${'─'.repeat(66)}`)
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT })

  /**
   * ⚠️ **必须等地图稳定下来再操作。**
   * 首屏地图会把相机状态写进 URL（`?v=10.12_25.019_55.089`），
   * Playwright 的 auto-wait 会一直卡在「等导航完成」上，
   * locator 直接超时 —— 第一版就栽在这。
   */
  await page.waitForTimeout(6000)

  // ── 额度墙检测：不识别它的话，下面所有点击都会静默超时 ──────────────
  const wall = await page.evaluate(() => {
    const el = [...document.querySelectorAll('div')].find(d => {
      const cs = getComputedStyle(d)
      return parseInt(cs.zIndex || '0') >= 600 && cs.pointerEvents === 'auto'
        && d.getBoundingClientRect().width > 500 && /登录|Sign in|免费探索/.test(d.innerText || '')
    })
    return el ? (el.innerText || '').slice(0, 80).replace(/\s+/g, ' ') : null
  })
  if (wall) {
    console.log(`
❌ 被额度墙挡住了：「${wall}」`)
    console.log('   匿名额度用尽。存一份登录态再跑：')
    console.log('   npx playwright open --save-storage=luna-auth.json https://www.pinzos.com')
    console.log('   node frontend/scripts/luna-live-audit.mjs --storage luna-auth.json')
    await browser.close()
    process.exit(3)
  }

  const kb = page.getByTestId('luna-keyboard')
  await kb.waitFor({ state: 'visible', timeout: 30000 })
  await kb.click({ noWaitAfter: true })

  const input = page.getByTestId('luna-input')
  await input.waitFor({ state: 'visible', timeout: 20000 })
  await page.waitForTimeout(800)   // 面板滑入动画

  let pass = 0
  const failures = []

  for (const c of CASES) {
    const asksBefore = net.asks.length
    /**
     * ⚠️ **用 `/tools/turn` 上报当「这一轮真结束」的信号。**
     *
     * 第一版看到 `/tools/ask` 就 break，然后立刻打下一条 —— 上一轮还没
     * `turnComplete`，Live 于是把每个问题**答了两遍**（生产埋点里能看到
     * 每题两次 turn 上报）。那是测试制造的假象，不是产品问题，
     * 但它会让所有延迟数字失真（实测 Brain 真实耗时 2.5-6s，
     * 脚本却报 20-29s）。
     */
    const turnsBefore = net.turns.length
    const t0 = Date.now()
    await input.click({ noWaitAfter: true })
    await page.keyboard.type(c.text, { delay: 10 })
    await page.getByTestId('luna-send').click({ noWaitAfter: true })

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
      // 前端每轮结束会 POST /tools/turn —— 那才是真正的 turnComplete
      if (net.turns.length > turnsBefore) break
    }
    // 让音频/状态落定，再打下一条
    await page.waitForTimeout(1200)
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
    const brainMs = net.asks.length > asksBefore ? (net.asks[net.asks.length - 1].serverMs ?? null) : null
    console.log(`${ok ? '✅' : '❌'} ${c.id.padEnd(12)} ${calledTool ? '🔧 调了工具' : '⚠️  没调工具'}  ` +
      `墙钟 ${Math.round(ms / 100) / 10}s${brainMs ? ` · Brain ${(brainMs / 1000).toFixed(1)}s` : ''}`)
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
