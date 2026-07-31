/**
 * GA4 接入验证 —— 改 index.html 的 GA 片段或 src/lib/ga.ts 之后必跑。
 * 用法: node scripts/_probe-ga-verify.mjs
 *       SHOT_URL=https://www.pinzos.com/ node scripts/_probe-ga-verify.mjs
 *
 * 拦 google-analytics.com 的上报,检查四件事:
 *   1. 首屏发出 page_view
 *   2. **SPA 路由切换**也发(必须用点链接模拟,`page.goto` 是整页重载,测不到)
 *   3. 每次路由只发 1 条(2 条 = send_page_view:false 没生效)
 *   4. 🔴 **分享短链的 code 一个字节都不能出现在任何一条上报里**
 *      —— 不只是 page_view:增强测量自动发的 scroll / user_engagement 也带
 *      `dl`(document location),那里同样会漏。所以判据是「整个 payload 里
 *      搜不到那串 code」,不是「page_view 的 dp 对不对」。
 */
import { chromium } from 'playwright'

const base = (process.env.SHOT_URL || 'http://localhost:5173').replace(/\/$/, '')
const FAKE = 'zzTOPSECRET99'

const browser = await chromium.launch()
const ctx = await browser.newContext()
const page = await ctx.newPage()

/** 每条上报解析成 {en 事件名, dl 页面地址, dt 标题},同时保留原始串用于查漏 */
const hits = []
await ctx.route('**://*.google-analytics.com/**', async (route) => {
  const url = route.request().url()
  const body = route.request().postData() || ''
  const take = (src) => {
    const p = new URLSearchParams(src)
    const en = p.get('en') || p.get('t')
    if (en) hits.push({ en, dl: p.get('dl'), dt: p.get('dt'), raw: src })
  }
  take(new URL(url).search)
  for (const line of body.split('\n')) if (line.trim()) take(line)
  // 整条 URL + body 也留一份,防止有参数没被 URLSearchParams 覆盖到
  hits.push({ en: '(raw)', raw: url + '\n' + body })
  await route.fulfill({ status: 204, body: '' })
})

const flush = () => hits.splice(0, hits.length)
const show = (arr) => arr.filter((h) => h.en !== '(raw)')
  .map((h) => `${h.en}${h.dl ? ' dl=' + h.dl.replace(base, '') : ''}`).join(' | ') || '(无)'

// ── ① 首屏 ────────────────────────────────────────────────────────────────
await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(4500)
const first = flush()
console.log('① 首屏      :', show(first))

// ── ② SPA 路由切换(点导航,不是 goto)────────────────────────────────────
const link = page.locator('a[href="/pricing"], a[href="/transactions"]').first()
let second = []
if (await link.count()) {
  await link.click()
  await page.waitForTimeout(3500)
  second = flush()
  console.log('② SPA 切换  :', show(second))
} else {
  console.log('② SPA 切换  : ⚠️ 页面上找不到可点的站内链接,跳过')
}

// ── ③ 分享短链(整页进入)──────────────────────────────────────────────
await page.goto(`${base}/v/${FAKE}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(4500)
const third = flush()
console.log('③ /v/<code> :', show(third))

// ── ④ 从普通页 SPA 跳进分享短链(最容易漏的一条路径)──────────────────
await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(2500)
flush()
await page.evaluate((u) => { window.history.pushState({}, '', u); window.dispatchEvent(new PopStateEvent('popstate')) }, `/v/${FAKE}`)
await page.waitForTimeout(3500)
const fourth = flush()
console.log('④ SPA→短链 :', show(fourth))

const all = [...first, ...second, ...third, ...fourth]
const leaked = all.filter((h) => (h.raw || '').includes(FAKE))
// ⚠️ 只数 **dl 指向本轮目标页** 的 page_view。GA 是批量延迟发送的,
// 每一轮都会捎上一页没发完的 beacon —— 把它们算进来会得出「重复上报」的假红灯
// (我第一版就是这么误判 send_page_view:false 失效的)。
const pv = (arr, forPath) => arr.filter((h) => h.en === 'page_view' && (h.dl || '').replace(base, '').split('?')[0] === forPath).length

console.log('')
const line = (ok, s) => console.log(`${ok ? '✅' : '❌'} ${s}`)
const okFirst = pv(first, '/') >= 1
const navPath = second.length ? (second.find(h => h.en === 'page_view' && /transactions|pricing/.test(h.dl || ''))?.dl || '').replace(base, '').split('?')[0] : ''
const okSecond = second.length === 0 || pv(second, navPath) === 1
line(okFirst, `首屏发出指向 / 的 page_view(${pv(first, '/')} 条)`)
line(okSecond, `SPA 切换后指向 ${navPath || '(未测)'} 的 page_view 只有 1 条(实际 ${navPath ? pv(second, navPath) : 0} 条 —— 2 条 = send_page_view:false 失效)`)
line(leaked.length === 0, `没有任何一条上报带着真实 code(漏了 ${leaked.length} 条)`)
if (leaked.length) for (const h of leaked.slice(0, 3)) console.log('   ↑ 泄露:', h.en, (h.raw || '').slice(0, 220))

await browser.close()
process.exit(okFirst && okSecond && leaked.length === 0 ? 0 : 1)
