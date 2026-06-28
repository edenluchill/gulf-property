// Headless buyer-journey test for Luna — drives the REAL deployed app by TEXT
// (no mic/voice), screenshots each turn, captures tool calls + reply latency from
// the console, and flags turns that get stuck. Requires the ?lunatest=1 hook
// (__lunaTest) to be deployed.
//
//   node frontend/scripts/luna-flow-test.mjs
//   SHOT_DIR=... URL=... node frontend/scripts/luna-flow-test.mjs
//
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const URL = process.env.URL || 'https://pinzos.com/?lunatest=1'
const OUT = process.env.SHOT_DIR ||
  'C:/Users/lzp65/AppData/Local/Temp/claude/C--Users-lzp65-Desktop-projects-gulf-property/7f4876a1-d971-4b65-89a3-1981ce97eabc/scratchpad/luna-test'
mkdirSync(OUT, { recursive: true })

// Two journeys (Mandarin). Each turn notes the tool we EXPECT Luna to call.
// Pick with JOURNEY=buyer (default) or JOURNEY=tools.
const JOURNEYS = {
  buyer: [
    { say: '你好,我有大概300万迪拉姆,想在迪拜投资买房,推荐哪些区域?', expect: 'recommend_by_budget' },
    { say: '带我看看 Al Safouh First 这个区怎么样。', expect: 'present_place' },
    { say: '这个区生活方便吗?离地铁、学校、医院远不远?', expect: 'analyze_area_amenities' },
    { say: '在我的预算内有哪些具体的项目?', expect: 'search_projects' },
    { say: '带我去看第一个项目的详情。', expect: 'navigate_to_project' },
    { say: '这个项目五年回报怎么样?值得投资吗?', expect: '(investment talk)' },
  ],
  tools: [
    { say: '我手上有200万现金,大概能在迪拜买哪里的房?', expect: 'check_affordability' },
    { say: 'Dubai Marina 和 JVC 这两个区,哪个更适合投资?对比一下。', expect: 'compare_market' },
    { say: '帮我分析一下 Business Bay 的投资回报怎么样。', expect: 'area_investment_report' },
    { say: 'Downtown Dubai 这个区现在市场行情如何?', expect: 'get_area_info' },
    { say: '这附近有没有学校?在地图上显示一下。', expect: 'show_nearby_pois' },
    { say: '在迪拜,我到底该租房还是买房?', expect: 'rent_vs_buy' },
    { say: '买一套200万的房子,一共要花多少钱,有哪些费用?', expect: 'purchase_costs' },
    { say: '带我飞到 Palm Jumeirah 看看。', expect: 'fly_to_area' },
  ],
  // Reliability probe: 4 present_place requests for different areas in one session.
  tourprobe: [
    { say: '带我看看 Dubai Marina 这个区。', expect: 'present_place' },
    { say: '那 JVC 呢,也带我看看。', expect: 'present_place' },
    { say: '帮我介绍一下 Business Bay。', expect: 'present_place' },
    { say: 'Downtown Dubai 怎么样,带我看看。', expect: 'present_place' },
  ],
}
const TURNS = JOURNEYS[process.env.JOURNEY || 'buyer'] || JOURNEYS.buyer

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await chromium.launch({
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
})
const ctx = await browser.newContext({
  viewport: { width: 1366, height: 900 },
  deviceScaleFactor: 1,
  permissions: ['microphone'],
})
const page = await ctx.newPage()

// Collect console lines per turn (tool calls, [VoiceTiming], closes, errors).
let bucket = []
page.on('console', (m) => {
  const t = m.text()
  if (/\[Voice\]|\[VoiceTiming\]|Tool call|GoAway|CONNECTION_CLOSED|error/i.test(t)) bucket.push(t)
})
page.on('pageerror', (e) => bucket.push('PAGEERROR: ' + e.message))

const report = []
console.log('→ goto', URL)
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
// Persist the test flag so it survives navigate_to_project dropping the ?lunatest query.
await page.evaluate(() => { try { localStorage.setItem('luna_test', '1') } catch {} })

await sleep(2500) // let the map settle first

// Acquire the hook AND open in one shot, retried — the hook can momentarily vanish
// if the deployed build re-registers it per render, so never split check + use.
let opened = false
for (let i = 0; i < 40; i++) {
  opened = await page.evaluate(() => {
    if (window.__lunaTest && window.__lunaTest.open) { window.__lunaTest.open(); return true }
    return false
  })
  if (opened) break
  await sleep(1000)
}
if (!opened) { console.log('❌ __lunaTest hook never available — latest deploy live?'); await browser.close(); process.exit(2) }
console.log('✓ hook present, opening')

// Wait for the Gemini Live session to connect (re-open if the hook had vanished).
let connected = false
for (let i = 0; i < 30; i++) {
  connected = await page.evaluate(() => (window.__lunaTest ? !!window.__lunaTest.connected() : false))
  if (connected) break
  if (i % 5 === 4) await page.evaluate(() => { window.__lunaTest && window.__lunaTest.open() }) // retry open
  await sleep(1000)
}
if (!connected) {
  console.log('❌ session never connected. console tail:'); console.log(bucket.slice(-15).join('\n'))
  await page.screenshot({ path: join(OUT, 'connect-fail.png') })
  await browser.close(); process.exit(3)
}
await sleep(1500)
await page.evaluate(() => { window.__lunaTest && window.__lunaTest.stopMic() })
console.log('✓ connected, mic stopped — driving by text')
await page.screenshot({ path: join(OUT, '00-connected.png') })

// Wait until Luna is genuinely idle (no pending tool, listening, bubble stable).
// Drains any backlog so each turn is attributed cleanly and we pace like a real user.
async function waitIdle(maxMs) {
  const start = Date.now(); let last = '', stable = 0
  while (Date.now() - start < maxMs) {
    await sleep(700)
    const st = await page.evaluate(() => (window.__lunaTest ? window.__lunaTest.state() : null))
    if (!st) continue
    const bub = st.bubble ? JSON.stringify(st.bubble) : ''
    if (bub === last) stable += 700; else { stable = 0; last = bub }
    // Require a long quiet window: real voice users wait for Luna to FINISH speaking
    // (server-side turn fully closed) before talking; injecting a text turn too soon
    // after a long reply gets it dropped. 4.9s stable ≈ Luna has truly stopped.
    if (!st.toolStatus && st.phase === 'listening' && stable >= 4900) return last
  }
  return last
}

for (let i = 0; i < TURNS.length; i++) {
  const turn = TURNS[i]
  const baseline = await waitIdle(35000) // fully drain + settle previous turn before speaking
  await sleep(1500)                      // extra settle so the injected turn isn't dropped
  bucket = []
  const t0 = Date.now()
  await page.evaluate((s) => { window.__lunaTest && window.__lunaTest.say(s) }, turn.say)

  // A real reply = the bubble CHANGES from the baseline. Wait up to 45s (some tools
  // like area_investment_report are slow) for a new, settled reply with no tool in flight.
  let lastBubble = baseline, stableFor = 0, firstReplyMs = null, sawTool = null, changed = false
  const DEADLINE = 45000
  while (Date.now() - t0 < DEADLINE) {
    await sleep(700)
    const st = await page.evaluate(() => (window.__lunaTest ? window.__lunaTest.state() : null))
    if (!st) continue
    const bub = st.bubble ? JSON.stringify(st.bubble) : ''
    if (st.toolStatus && !sawTool) sawTool = st.toolStatus
    if (bub && bub !== baseline && !changed) { changed = true; firstReplyMs = Date.now() - t0 }
    if (bub === lastBubble) { stableFor += 700 } else { stableFor = 0; lastBubble = bub }
    if (changed && stableFor >= 2800 && st.phase === 'listening' && !st.toolStatus) break
  }
  const toolLines = bucket.filter((l) => /Tool call|VoiceTiming|GoAway|CONNECTION_CLOSED|error/i.test(l))
  const shot = `${String(i + 1).padStart(2, '0')}.png`
  await page.screenshot({ path: join(OUT, shot) })
  const rec = {
    turn: i + 1, say: turn.say, expectTool: turn.expect,
    firstReplyMs, toolStatusSeen: sawTool,
    bubble: lastBubble.slice(0, 300),
    stuck: firstReplyMs === null,
    console: toolLines.slice(0, 12),
    shot,
  }
  report.push(rec)
  console.log(`\n── turn ${i + 1}: ${turn.say}`)
  console.log(`   expect=${turn.expect}  firstReply=${firstReplyMs}ms  tool=${sawTool || '—'}  stuck=${rec.stuck}`)
  console.log(`   bubble: ${lastBubble.slice(0, 160)}`)
  if (toolLines.length) console.log('   ' + toolLines.slice(0, 6).join('\n   '))
}

writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2))
console.log(`\n✓ done. screenshots + report.json in:\n  ${OUT}`)
await browser.close()
