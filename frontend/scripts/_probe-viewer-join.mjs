/**
 * 客户端进房首屏探针 —— 回答「实时带看为什么感觉有半分钟延迟」。
 *
 * WS 同步链路已实测健康(backend/scripts/probe-collab-latency.ts:161ms 端到端,
 * 20Hz 零累积)。剩下唯一能解释「半分钟」的,是客户手机点开分享链接后、
 * 到画面真正跟上经纪之间的这段**首屏时间**。这里把它逐段拆开量:
 *
 *   t0 goto → DOMContentLoaded → WS open → 收到 sync → 收到第一帧 cam
 *      → 地图 idle(瓦片加载完,画面真正可看)
 *
 * presenter 用页面内原生 WebSocket 顶着(不需要登录),持续 20Hz 发 cam,
 * 与真实经纪端一致。客户端用真实手机型号 + 网络节流打开 /t/:code。
 *
 * 用法:
 *   node scripts/_probe-viewer-join.mjs               # 迪拜 4G(20Mbps/40ms)
 *   node scripts/_probe-viewer-join.mjs slow3g        # 弱网(1.5Mbps/300ms)
 *   node scripts/_probe-viewer-join.mjs fast          # 不节流(对照组)
 */
import { chromium, devices } from 'playwright'

const NET = {
  fast:   null,
  '4g':   { downloadThroughput: 20e6 / 8, uploadThroughput: 8e6 / 8, latency: 40 },
  slow3g: { downloadThroughput: 1.5e6 / 8, uploadThroughput: 0.7e6 / 8, latency: 300 },
}
const profile = process.argv[2] || '4g'
const cond = NET[profile]
const ORIGIN = process.env.PROBE_ORIGIN || 'https://pinzos.com'
const WS = process.env.PROBE_WS || 'wss://api.pinzos.com/api/collab'
const CODE = 'PV' + Math.floor(Math.random() * 900 + 100)

const browser = await chromium.launch()

// ── presenter:一个空白页里用原生 WS 顶住房间,20Hz 发 cam ──────────────
const pctx = await browser.newContext()
const ppage = await pctx.newPage()
await ppage.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' })
// 模拟真实经纪:20Hz 平移 2 秒("我们看这块地"),然后停住不动 —— 客户的画面
// 就是从这一刻开始追瓦片的。全程乱动的话瓦片永远加载不完(那是探针假象)。
await ppage.evaluate(([ws, code]) => {
  const s = new WebSocket(ws)
  s.onopen = () => {
    s.send(JSON.stringify({ k: 'hello', code, name: 'probe-agent', role: 'presenter' }))
    let n = 0
    const send = (lng, idle) => s.send(JSON.stringify({
      k: 'cam', t: Date.now(), c: [lng, 25.08], z: 15, b: 0, p: 0, vw: 1180, vh: 800, ...(idle ? { idle: true } : {}),
    }))
    const id = setInterval(() => {
      n++
      const lng = 55.14 + n * 0.0006          // 平移穿过 Dubai Marina
      if (n <= 40) return send(lng, false)     // 20Hz × 2s
      clearInterval(id)
      send(55.14 + 40 * 0.0006, true)          // 停下(idle 帧)
      window.__stopped = Date.now()
    }, 50)
  }
}, [WS, CODE])
await ppage.waitForTimeout(1500)
console.log(`🎥 presenter 顶住房间 ${CODE}(20Hz cam)\n`)

// ── viewer:真实手机 + 网络节流,打开分享链接 ───────────────────────────
const vctx = await browser.newContext({ ...devices['iPhone 13'] })
const vpage = await vctx.newPage()

// 在页面里插桩:hook WebSocket,记录 open / sync / 第一帧 cam 的时间
await vpage.addInitScript(() => {
  window.__marks = { t0: Date.now() }
  const OrigWS = window.WebSocket
  window.WebSocket = function (...args) {
    const s = new OrigWS(...args)
    if (String(args[0]).includes('/api/collab')) {
      s.addEventListener('open', () => { window.__marks.wsOpen ??= Date.now() })
      s.addEventListener('message', (e) => {
        let m; try { m = JSON.parse(e.data) } catch { return }
        if (m.k === 'sync') window.__marks.sync ??= Date.now()
        if (m.k === 'cam') window.__marks.firstCam ??= Date.now()
      })
    }
    return s
  }
  window.WebSocket.prototype = OrigWS.prototype
  Object.assign(window.WebSocket, OrigWS)
  document.addEventListener('DOMContentLoaded', () => { window.__marks.dom ??= Date.now() })
})

const cdp = await vctx.newCDPSession(vpage)
if (cond) {
  await cdp.send('Network.emulateNetworkConditions', { offline: false, ...cond })
  console.log(`📶 网络: ${profile}(${(cond.downloadThroughput * 8 / 1e6).toFixed(1)}Mbps 下行, ${cond.latency}ms 延迟)`)
} else {
  console.log('📶 网络: 不节流(对照组)')
}

const t0 = Date.now()
vpage.on('console', (m) => { if (m.type() === 'error') console.log('  [err]', m.text().slice(0, 120)) })

// 瓦片请求账本 —— 「客户什么时候看清画面」的唯一硬证据。
// (maplibre 实例没暴露全局,量网络比猜 DOM 可信。)
const tiles = []
let lastTileAt = 0
vpage.on('response', async (r) => {
  const u = r.url()
  if (!/arcgisonline|tile|\.pbf|\.png|\.jpg/i.test(u)) return
  const t = r.request().timing()
  const dur = t.responseEnd > 0 ? Math.round(t.responseEnd) : 0
  let bytes = 0
  try { bytes = (await r.body()).length } catch { /* 复用/取消的响应 */ }
  tiles.push({ sat: /arcgisonline/i.test(u), dur, bytes })
  lastTileAt = Date.now()
})

await vpage.goto(`${ORIGIN}/t/${CODE}`, { waitUntil: 'domcontentloaded', timeout: 90000 })

// 身份门:客户必须先填称呼才进房(CollabIdentityGate)。从「进入带看」按下那一刻
// 重新计时 —— 那才是客户主观等待的起点。
await vpage.getByPlaceholder('如:陈先生').fill('探针客户', { timeout: 30000 })
await vpage.evaluate(() => { window.__marks.t0 = Date.now() })
const tClick = Date.now()
await vpage.getByRole('button', { name: /进入带看/ }).click()

// 「画面稳定」= 瓦片请求静默 2.5 秒(经纪已停在 2s,之后的瓦片都是客户在追)
const deadline = Date.now() + 75000
let tIdle = 0
while (Date.now() < deadline) {
  await vpage.waitForTimeout(500)
  if (lastTileAt && Date.now() - lastTileAt > 2500) { tIdle = lastTileAt; break }
}

const marks = await vpage.evaluate(() => window.__marks)

const rel = (t, base) => (t ? `${((t - base) / 1000).toFixed(1)}s` : '❌ 从未发生')
console.log(`\n① 点开链接 → 看到「填称呼」弹窗:`)
console.log(`  DOMContentLoaded ......... ${rel(marks.dom, t0)}`)
console.log(`  (客户在这里手动填称呼、点进入)`)
console.log(`\n② 点「进入带看」→ 画面真正跟上经纪:`)
console.log(`  WS 连上 .................. ${rel(marks.wsOpen, tClick)}`)
console.log(`  收到 sync(进房成功)....... ${rel(marks.sync, tClick)}`)
console.log(`  收到第一帧 cam(经纪动作)... ${rel(marks.firstCam, tClick)}`)
console.log(`  画面追完瓦片(看清经纪在看啥)${rel(tIdle, tClick)}`)

const sat = tiles.filter((t) => t.sat)
const mb = (tiles.reduce((a, b) => a + b.bytes, 0) / 1e6).toFixed(1)
const slowest = tiles.length ? Math.max(...tiles.map((t) => t.dur)) : 0
console.log(`\n瓦片账单:${tiles.length} 个请求(其中卫星图 ${sat.length} 个)· ${mb} MB · 最慢单个 ${slowest}ms`)
console.log(`\n👉 「WS 连上/sync/第一帧 cam」= 实时链路,秒级以内。`)
console.log(`   「画面追完瓦片」才是客户主观感受的延迟。两者差多少,就是瓦片欠的债。`)

await vpage.screenshot({ path: `scripts/_probe-viewer-${profile}.png` })
await browser.close()
