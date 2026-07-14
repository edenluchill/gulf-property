/**
 * 验证「已经坏掉的客户,刷新就能好」。
 *
 * 精确模拟客户的处境:微信 X5 里存着**旧的 index.html**(引用已经不存在的 hash),
 * 我们改不了他那份 HTML。做法是拦住 document 响应,把入口 hash 换成假的 ——
 * 得到的就是他 WebView 里那份东西。
 *
 * 必须跑在 `npx wrangler pages dev dist --port 8788` 上(要真的 Pages Function)。
 *
 *   A 兜底关掉(直连 vite preview 4173) —— 必须复现故障(裸 HTML),证明这个模拟是真的
 *   B 兜底开着(wrangler 8788)         —— 必须完全正常  ← 这就是"刷新就好"
 */
import { chromium } from 'playwright'

const WECHAT_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) ' +
  'Mobile/15E148 MicroMessenger/8.0.49(0x18003128) NetType/WIFI Language/zh_CN'
const OUT = 'C:/Users/lzp65/AppData/Local/Temp/claude/C--Users-lzp65-Desktop-projects-gulf-property/33515050-5e45-49ef-a7db-32fe15e7bed9/scratchpad'

async function asStaleClient(name, base) {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({
    userAgent: WECHAT_UA, viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  })
  const page = await ctx.newPage()

  const assetStatus = []
  page.on('response', (r) => {
    if (r.url().includes('/assets/')) assetStatus.push(`${r.status()} ${r.url().split('/assets/')[1].slice(0, 34)}`)
  })

  // ★ 把 index.html 改成"上一次部署的那份":入口 hash 全部换成不存在的
  await page.route(base, async (route) => {
    const r = await route.fetch()
    let html = await r.text()
    html = html
      .replace(/\/assets\/index-[A-Za-z0-9_-]+\.css/g, '/assets/index-STALE0001.css')
      .replace(/\/assets\/index-[A-Za-z0-9_-]+\.js/g, '/assets/index-STALE0001.js')
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html })
  })

  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {})
  await page.waitForTimeout(7000)

  const p = await page.evaluate(() => {
    const own = [...document.styleSheets].find((s) => s.href && s.href.includes('/assets/'))
    let rules = -1
    try { rules = own ? own.cssRules.length : -1 } catch { rules = -2 }
    const logo = document.querySelector('img[src*="logo"], header svg, img')
    return {
      rules,
      logoWidth: logo ? Math.round(logo.getBoundingClientRect().width) : -1,
      bodyMargin: getComputedStyle(document.body).margin,
      rootChildren: document.getElementById('root')?.children.length ?? -1,
      hasMap: !!document.querySelector('.leaflet-container, canvas'),
    }
  })

  await page.screenshot({ path: `${OUT}/stale-${name}.png` })
  await browser.close()

  const ok = p.rules > 100 && p.bodyMargin === '0px' && p.logoWidth > 0 && p.logoWidth < 60
  console.log(`\n===== ${name} =====`)
  console.log(`  /assets/ 响应 : ${[...new Set(assetStatus)].join('\n                  ')}`)
  console.log(`  CSS 规则数    : ${p.rules}`)
  console.log(`  logo / margin : ${p.logoWidth}px / ${p.bodyMargin}`)
  console.log(`  React 渲染    : ${p.rootChildren} 个子节点   地图: ${p.hasMap ? '有' : '无'}`)
  console.log(`  >>> ${ok ? '✅ 页面完全正常' : '❌ 裸 HTML(故障)'}`)
  return ok
}

// A:没有 Function 兜底 → 必须复现故障(证明模拟是真的)
const a = await asStaleClient('A-no-fallback', 'http://localhost:4173/')
// B:有 Function 兜底 → 必须正常
const b = await asStaleClient('B-with-fallback', 'http://localhost:8788/')

console.log('\n################  判定  ################')
console.log(`A 对照组(无兜底):${a ? '❌ 没能复现故障,这测试不算数' : '✅ 复现了客户的裸 HTML'}`)
console.log(`B 有 Function 兜底:${b ? '✅ 旧 HTML 的客户刷新就好了' : '❌ 仍然坏'}`)
console.log(a === false && b === true ? '\n🎉 已经坏掉的客户,刷新即可恢复。' : '\n⚠️ 没达成目标。')
