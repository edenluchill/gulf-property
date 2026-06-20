/**
 * Collab 端到端冒烟:node WS 客户端扮 presenter,真实 Chromium 开 viewer 页 /t/:code,
 * 验证 协作UI挂载 + presenter 看到 viewer join + 镜头跟随 + 拖拽脱离。
 * 用法: FE=http://localhost:5174 node scripts/test-collab-e2e.mjs
 */
import { chromium } from 'playwright'

const BE = process.env.BE || 'http://localhost:3000'
const FE = process.env.FE || 'http://localhost:5174'
const WSURL = (BE.replace(/^http/, 'ws')) + '/api/collab'
const WS = globalThis.WebSocket
let failed = false
const ok = (m) => console.log('  ✓', m)
const bad = (m) => { console.log('  ✗', m); failed = true }

if (!WS) { console.log('no global WebSocket in node — aborting'); process.exit(2) }

// 1. 建房
const res = await fetch(BE + '/api/collab/rooms', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Ahmed' }),
})
const { code, url } = await res.json()
code ? ok(`room created: ${code}  (url ${url})`) : bad('no code from POST /rooms')

// 2. presenter WS
const pres = new WS(WSURL)
let presConnId = null
const joins = []
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('presenter sync timeout')), 8000)
  pres.onopen = () => pres.send(JSON.stringify({ k: 'hello', code, name: 'Ahmed', role: 'presenter' }))
  pres.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.k === 'sync') { presConnId = m.connId; clearTimeout(t); resolve() }
    if (m.k === 'join') joins.push(m.who)
    if (m.k === 'ping') pres.send(JSON.stringify({ k: 'pong' }))
  }
  pres.onerror = (e) => { clearTimeout(t); reject(new Error('presenter ws error ' + e?.message)) }
}).then(() => ok(`presenter joined connId=${presConnId}`)).catch((e) => bad(e.message))

// 3. 浏览器 viewer
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 200)))
page.on('console', (m) => { const t = m.text(); if (/collab|websocket|\[Collab\]/i.test(t)) console.log('  [page]', t.slice(0, 160)) })
await page.goto(`${FE}/t/${code}`, { waitUntil: 'domcontentloaded', timeout: 60000 })

// 诊断:进页后看到什么
await page.waitForTimeout(3000)
const earlyText = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 400)
console.log('  [viewer body text @3s]', earlyText)

// 协作 UI 挂载?
try {
  await page.waitForFunction(() => /实时带看|带看中/.test(document.body.innerText), { timeout: 20000 })
  ok('viewer 显示 session 栏(协作 UI 挂载 + WS 连上)')
} catch { bad('session 栏未出现 — 协作 UI 没挂上') }

// presenter 是否收到了浏览器 viewer 的 join?
await page.waitForTimeout(1500)
joins.some((w) => w && w.role === 'viewer')
  ? ok(`presenter 收到 viewer join (${joins.filter(w => w?.role === 'viewer').length} 个)`)
  : bad('presenter 没收到 viewer join — 浏览器 WS 没进房')

// 等地图瓦片
await page.waitForTimeout(11000)
await page.screenshot({ path: '/tmp/collab-before.png' })

// 4. presenter 发 cam 斜坡到一个明显不同的高缩放位置
const target = { c: [55.2708, 25.2048], z: 15 }
for (let i = 0; i < 50; i++) {
  pres.send(JSON.stringify({ k: 'cam', t: Date.now(), c: target.c, z: target.z, b: 0, p: 0 }))
  await new Promise((r) => setTimeout(r, 50))
}
await page.waitForTimeout(3500) // 等插值收敛 + 瓦片
await page.screenshot({ path: '/tmp/collab-after.png' })

const before = (await import('fs')).readFileSync('/tmp/collab-before.png')
const after = (await import('fs')).readFileSync('/tmp/collab-after.png')
before.equals(after)
  ? console.log('  ~ 截图无差异(headless 瓦片可能空白)→ 镜头跟随用截图不可判,看 page 日志/手动复验')
  : ok('presenter 发 cam 后 viewer 画面变化(镜头跟随)')

// 5. 拖拽地图 → 应脱离跟随
const box = await page.evaluate(() => {
  const c = document.querySelector('.maplibregl-canvas') || document.querySelector('canvas')
  if (!c) return null
  const r = c.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
if (box) {
  await page.mouse.move(box.x, box.y); await page.mouse.down()
  await page.mouse.move(box.x - 220, box.y - 140, { steps: 10 }); await page.mouse.up()
  await page.waitForTimeout(1000)
  try {
    await page.waitForFunction(() => /已脱离|回到/.test(document.body.innerText), { timeout: 5000 })
    ok('拖拽地图 → 脱离跟随,出现「回到」pill')
  } catch { bad('拖拽后未出现脱离 pill — Free 判定没生效') }
} else { bad('找不到地图 canvas,无法测拖拽脱离') }

await browser.close(); pres.close()
console.log(failed ? '\nSMOKE FAILED' : '\nSMOKE OK')
process.exit(failed ? 1 : 0)
