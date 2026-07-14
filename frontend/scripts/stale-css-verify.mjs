/**
 * 验证「样式表过期 → 裸 HTML」的修复。跑在本地 `vite preview`(dist 产物)上。
 *
 *  1 对照组       —— 什么都不拦。页面必须正常(别修坏了)。
 *  2 CSS 一直 404 —— 模拟客户现在的处境。必须**强刷一次**(带 _r 回源),且只刷一次,不死循环。
 *  3 CSS 先404后好 —— 模拟强刷后真的拿到了新产物。页面必须**自愈**成正常样子。← 最关键
 *  4 墙内         —— 封掉 fonts.googleapis/gstatic(丢包式挂起)。首屏**不许**再等 30 秒。
 */
import { chromium } from 'playwright'

const BASE = 'http://localhost:4173/'
const OUT = 'C:/Users/lzp65/AppData/Local/Temp/claude/C--Users-lzp65-Desktop-projects-gulf-property/33515050-5e45-49ef-a7db-32fe15e7bed9/scratchpad'
const WECHAT_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) ' +
  'Mobile/15E148 MicroMessenger/8.0.49(0x18003128) NetType/WIFI Language/zh_CN'

async function scenario(name, setup) {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({
    userAgent: WECHAT_UA, viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  })
  const page = await ctx.newPage()
  const state = { cssHits: 0, navs: [] }
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) state.navs.push(f.url().replace(BASE, '/')) })

  await setup(page, state)

  const t0 = Date.now()
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {})
  const domMs = Date.now() - t0
  await page.waitForTimeout(7000)   // 给强刷 + React 渲染留时间

  const p = await page.evaluate(() => {
    const own = [...document.styleSheets].find((s) => s.href && s.href.includes('/assets/'))
    let rules = -1
    try { rules = own ? own.cssRules.length : -1 } catch { rules = -2 }
    const logo = document.querySelector('img[src*="logo"], header svg, img')
    return {
      ownCssRules: rules,
      logoWidth: logo ? Math.round(logo.getBoundingClientRect().width) : -1,
      bodyMargin: getComputedStyle(document.body).margin,
      url: location.pathname + location.search,
      cssLock: sessionStorage.getItem('pz-stale-css-reloaded'),
    }
  })

  await page.screenshot({ path: `${OUT}/fix-${name}.png` })
  await browser.close()

  const styled = p.ownCssRules > 100 && p.bodyMargin === '0px' && p.logoWidth > 0 && p.logoWidth < 60
  console.log(`\n===== ${name} =====`)
  console.log(`  首屏 DOMContentLoaded : ${domMs}ms`)
  console.log(`  本站 CSS 规则数        : ${p.ownCssRules}`)
  console.log(`  logo 宽 / body margin  : ${p.logoWidth}px / ${p.bodyMargin}`)
  console.log(`  CSS 请求次数           : ${state.cssHits}`)
  console.log(`  导航history(看强刷)    : ${state.navs.join('  →  ')}`)
  console.log(`  最终地址栏             : ${p.url}   ${p.url.includes('_r=') ? '❌ _r 没擦干净' : '✅ 干净'}`)
  console.log(`  >>> 样式生效? ${styled ? '✅ 正常' : '❌ 裸 HTML'}`)
  return { domMs, styled, p, state }
}

// 1 对照组
await scenario('1-baseline', async () => {})

// 2 CSS 一直 404(客户此刻的处境)
const s2 = await scenario('2-css-404-forever', async (page, st) => {
  await page.route('**/assets/*.css', (r) => {
    st.cssHits++
    r.fulfill({ status: 404, contentType: 'text/html', body: '<p>Not found.' })
  })
})

// 3 CSS 先 404、强刷后放行(强刷真的拿到新产物)← 最关键
const s3 = await scenario('3-css-404-then-ok', async (page, st) => {
  await page.route('**/assets/*.css', (r) => {
    st.cssHits++
    if (st.cssHits === 1) return r.fulfill({ status: 404, contentType: 'text/html', body: '<p>Not found.' })
    return r.continue()
  })
})

// 4 墙内:Google Fonts 丢包式挂起
const s4 = await scenario('4-gfw-fonts-hang', async (page) => {
  await page.route(/fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com/, async (r) => {
    await new Promise((res) => setTimeout(res, 30000))
    return r.abort('timedout')
  })
})

console.log('\n\n################  判定  ################')
// 同一次导航会被 framenavigated 记多次(replace + Router 初始化),所以要按**去重后的 _r 值**数,
// 不能数条目数。真正判死循环的硬证据是 CSS 请求次数:每强刷一次就多取一次 CSS。
const rStamps = new Set(s2.state.navs.filter((u) => u.includes('_r=')).map((u) => u.split('_r=')[1]))
console.log(`2 CSS一直404  → 强刷了吗: ${rStamps.size >= 1 ? '✅ 是' : '❌ 没有'}` +
            `   只刷一次(没死循环): ${rStamps.size === 1 && s2.state.cssHits === 2 ? `✅ (强刷1次, CSS取了${s2.state.cssHits}次)` : `❌ 强刷${rStamps.size}次 / CSS取了${s2.state.cssHits}次`}`)
console.log(`3 强刷后拿到新CSS → 自愈: ${s3.styled ? '✅ 页面恢复正常' : '❌ 仍是裸 HTML'}`)
console.log(`4 墙内首屏     → ${s4.domMs}ms ${s4.domMs < 5000 ? '✅ 不再白等(修复前 30500ms)' : '❌ 仍在阻塞'}` +
            `   样式: ${s4.styled ? '✅' : '❌'}`)
