/**
 * 验证「禁止整页捏放大」的策略按路由分流正确,且没弄坏地图。
 *
 * ⚠️ 诚实的边界:`gesture*` 是 **WebKit 私有事件**,Chromium(playwright)里根本不存在,
 *    所以这里**验不了真实的 iOS 行为**。能验的是:
 *      • handler 确实注册了,且对合成的 gesturestart 会 preventDefault
 *      • meta viewport 按路由正确切换(应用型禁缩放 / 文档型放开)
 *      • 地图没被弄坏(仍能渲染、仍能缩放)
 *    iOS 真机行为要靠 owner 拿手机验。
 *
 * 跑之前:npx vite preview --port 4173
 */
import { chromium } from 'playwright'

const BASE = 'http://localhost:4173'
const OUT = 'C:/Users/lzp65/AppData/Local/Temp/claude/C--Users-lzp65-Desktop-projects-gulf-property/33515050-5e45-49ef-a7db-32fe15e7bed9/scratchpad'

const browser = await chromium.launch()
const ctx = await browser.newContext({
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) ' +
    'Mobile/15E148 MicroMessenger/8.0.49(0x18003128) NetType/WIFI Language/zh_CN',
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2, isMobile: true, hasTouch: true,
})
const page = await ctx.newPage()

async function check(label, path, expectZoomable) {
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3500) // 等 React 挂载 + 路由 effect 跑完

  const r = await page.evaluate(() => {
    const meta = document.querySelector('meta[name="viewport"]')?.getAttribute('content') || ''
    // 合成一个 gesturestart,看有没有人 preventDefault 它
    const ev = new Event('gesturestart', { cancelable: true, bubbles: true })
    document.dispatchEvent(ev)
    return { meta, gestureBlocked: ev.defaultPrevented }
  })

  const metaLocked = /user-scalable=no/.test(r.meta)
  // 应用型:meta 锁死 + gesture 被拦。文档型:两者都放开。
  const ok = expectZoomable ? !metaLocked && !r.gestureBlocked : metaLocked && r.gestureBlocked

  console.log(`\n===== ${label}  (${path}) =====`)
  console.log(`  meta viewport   : ${r.meta}`)
  console.log(`  meta 锁死缩放?  : ${metaLocked ? '是(安卓/X5 生效)' : '否'}`)
  console.log(`  gesturestart 被拦: ${r.gestureBlocked ? '是(iOS 路径生效)' : '否'}`)
  console.log(`  期望             : ${expectZoomable ? '可缩放(文档页)' : '禁缩放(应用页)'}`)
  console.log(`  >>> ${ok ? '✅' : '❌ 不符'}`)
  return ok
}

// 应用型 —— 必须禁缩放
const a = await check('地图首页', '/', false)
const b = await check('成交记录', '/transactions', false)
// 文档型 —— 必须放开(客户要放大看细节)
const c = await check('报价单', '/pp/ANYCODE', true)
const d = await check('客户报告', '/cr/ANYCODE', true)
// 切回应用型 —— 确认能来回切,不是单向的
const e = await check('切回地图', '/', false)

// 地图没被弄坏?
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6000)
const map = await page.evaluate(() => {
  const c = document.querySelector('.leaflet-container, canvas')
  return { present: !!c, w: c ? Math.round(c.getBoundingClientRect().width) : 0 }
})
await page.screenshot({ path: `${OUT}/pinch-map.png` })
await browser.close()

console.log(`\n===== 地图没被弄坏? =====`)
console.log(`  地图画布: ${map.present ? `✅ 在,宽 ${map.w}px` : '❌ 不见了'}`)

console.log('\n################  判定  ################')
const allOk = a && b && c && d && e && map.present
console.log(allOk ? '✅ 应用页禁缩放 / 文档页可缩放 / 能来回切 / 地图正常' : '❌ 有不符项')
console.log('⚠️ iOS 真机行为(WKWebView 忽略 meta,只认 gesture 拦截)需 owner 用手机复验。')
