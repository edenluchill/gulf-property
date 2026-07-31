/**
 * 「挂上 GA 会不会让墙内客户打不开?」—— 实测,不靠猜。
 * 用法: node scripts/_probe-ga-china.mjs
 *
 * 模拟大陆的真实行为:墙**不是干脆拒绝**,而是**丢包**,浏览器要一路等到超时。
 * (index.html 里 Google Fonts 那段注释记录过:阻塞 <link> 下 DOMContentLoaded
 *  从 637ms 涨到 30.5 秒。)这里对 GA 的三种挂法各测一遍:
 *   A. 不挂 GA          —— 基线
 *   B. <script async>   —— GA 官方给的写法
 *   C. <script>(阻塞)  —— 手抖漏了 async 的写法
 */
import { chromium } from 'playwright'

const URL = process.env.SHOT_URL || 'https://www.pinzos.com/'
const GA_ID = 'G-TESTFAKE01'

const TAG = {
  // GA 官方给的写法
  async: `<script async src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script>`,
  // 手抖漏了 async —— **解析器阻塞**,这才是真正危险的那种
  sync: `<script src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script>`,
}

async function run(mode, block) {
  const browser = await chromium.launch()
  const ctx = await browser.newContext()
  const page = await ctx.newPage()

  if (block) {
    // 丢包:接住请求但**永远不回应**,直到浏览器自己超时
    await ctx.route('**://*.googletagmanager.com/**', () => { /* 黑洞 */ })
    await ctx.route('**://*.google-analytics.com/**', () => { /* 黑洞 */ })
  }
  // ⚠️ 必须把 <script> **写进 HTML 源码**再交给浏览器。
  // 用 document.createElement + appendChild 插进去的 script **天生 async**
  // (动态插入的 script 默认 async=true),那样测不出「阻塞写法」的差别 ——
  // 我第一版就是这么测的,四个场景数字一样,得出了「怎么写都没事」的假绿灯。
  if (mode !== 'none') {
    await page.route(URL, async (route) => {
      const res = await route.fetch()
      const html = (await res.text()).replace('</head>', `${TAG[mode]}</head>`)
      await route.fulfill({ response: res, body: html, headers: { ...res.headers(), 'content-length': undefined } })
    })
  }

  const t0 = Date.now()
  await page.goto(URL, { waitUntil: 'commit', timeout: 90000 })
  // 首屏能不能看见东西 —— 用 FCP,这才是"打得开吗"的判据
  const fcp = await page.evaluate(() => new Promise((res) => {
    const seen = performance.getEntriesByName('first-contentful-paint')[0]
    if (seen) return res(Math.round(seen.startTime))
    new PerformanceObserver((l) => { const e = l.getEntries()[0]; if (e) res(Math.round(e.startTime)) })
      .observe({ type: 'paint', buffered: true })
    setTimeout(() => res(-1), 45000)
  })).catch(() => -1)

  let dcl = -1, load = -1
  try {
    await page.waitForLoadState('domcontentloaded', { timeout: 45000 })
    dcl = Date.now() - t0
  } catch { dcl = -1 }
  try {
    await page.waitForLoadState('load', { timeout: 45000 })
    load = Date.now() - t0
  } catch { load = -1 }

  // 首屏真的画出东西了吗(不是白屏)
  const painted = await page.evaluate(() => !!document.querySelector('header') && document.body.innerText.trim().length > 20).catch(() => false)

  await browser.close()
  return { fcp, dcl, load, painted }
}

const CASES = [
  ['不挂 GA(基线)', 'none', false],
  ['GA async · 网络正常', 'async', false],
  ['GA 阻塞 · 网络正常', 'sync', false],
  ['GA async · 墙(丢包)', 'async', true],
  ['GA 阻塞 · 墙(丢包)', 'sync', true],
]

console.log('目标:', URL, '\n')
console.log('场景'.padEnd(26), 'FCP(首次绘制)'.padStart(14), 'DCL'.padStart(8), 'load'.padStart(8), '  首屏有内容')
for (const [name, mode, block] of CASES) {
  const r = await run(mode, block)
  const f = (v) => (v < 0 ? '超时' : v + 'ms')
  console.log(name.padEnd(28), f(r.fcp).padStart(12), f(r.dcl).padStart(9), f(r.load).padStart(9), '   ' + (r.painted ? '✅ 是' : '❌ 白屏'))
}
console.log('\n判据:FCP 和「首屏有内容」才是「打得开吗」。load 事件被拖长本身不影响用户看到页面,')
console.log('     除非有代码在等 window.onload —— 那才是真正会把人挡在外面的写法。')
