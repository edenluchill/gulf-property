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

// Realistic buyer journey (Mandarin). Each turn notes the tool we EXPECT Luna to call.
const TURNS = [
  { say: '你好,我有大概300万迪拉姆,想在迪拜投资买房,推荐哪些区域?', expect: 'recommend_by_budget' },
  { say: '带我看看 Al Safouh First 这个区怎么样。', expect: 'present_place' },
  { say: '这个区生活方便吗?离地铁、学校、医院远不远?', expect: 'analyze_area_amenities' },
  { say: '在我的预算内有哪些具体的项目?', expect: 'search_projects' },
  { say: '带我去看第一个项目的详情。', expect: 'navigate_to_project' },
  { say: '这个项目五年回报怎么样?值得投资吗?', expect: '(investment talk)' },
]

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

// Wait for the test hook (with the new open/stopMic methods) to be present.
let hookOk = false
for (let i = 0; i < 30; i++) {
  hookOk = await page.evaluate(() => !!(window.__lunaTest && window.__lunaTest.open && window.__lunaTest.stopMic))
  if (hookOk) break
  await sleep(1000)
}
if (!hookOk) { console.log('❌ __lunaTest hook (open/stopMic) not found — is the latest deploy live?'); await browser.close(); process.exit(2) }
console.log('✓ hook present')

await sleep(2000) // let the map settle
await page.evaluate(() => window.__lunaTest.open())

// Wait for the Gemini Live session to connect.
let connected = false
for (let i = 0; i < 25; i++) {
  connected = await page.evaluate(() => window.__lunaTest.connected())
  if (connected) break
  await sleep(1000)
}
if (!connected) {
  console.log('❌ session never connected. console tail:'); console.log(bucket.slice(-15).join('\n'))
  await page.screenshot({ path: join(OUT, 'connect-fail.png') })
  await browser.close(); process.exit(3)
}
await sleep(1500)
await page.evaluate(() => window.__lunaTest.stopMic())
console.log('✓ connected, mic stopped — driving by text')
await page.screenshot({ path: join(OUT, '00-connected.png') })

let prevTurnBubble = '' // bubble left over from the previous turn (persists in UI)
for (let i = 0; i < TURNS.length; i++) {
  const turn = TURNS[i]
  bucket = []
  const t0 = Date.now()
  await page.evaluate((s) => window.__lunaTest.say(s), turn.say)

  // A real reply = the bubble CHANGES from the previous turn's leftover (not just
  // "non-empty"). This both detects ignored turns and paces us like a real user
  // (we don't fire the next turn until this one actually produced a new answer).
  let lastBubble = prevTurnBubble, stableFor = 0, firstReplyMs = null, sawTool = null, changed = false
  const DEADLINE = 30000
  while (Date.now() - t0 < DEADLINE) {
    await sleep(700)
    const st = await page.evaluate(() => (window.__lunaTest ? window.__lunaTest.state() : null))
    if (!st) continue
    const bub = st.bubble ? JSON.stringify(st.bubble) : ''
    if (st.toolStatus && !sawTool) sawTool = st.toolStatus
    if (bub && bub !== prevTurnBubble && !changed) { changed = true; firstReplyMs = Date.now() - t0 }
    if (bub === lastBubble) { stableFor += 700 } else { stableFor = 0; lastBubble = bub }
    // settle once a NEW reply has arrived, stabilised, and Luna is back to listening
    if (changed && stableFor >= 2100 && st.phase === 'listening') break
  }
  prevTurnBubble = lastBubble
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
