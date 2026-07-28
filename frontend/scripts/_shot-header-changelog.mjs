/**
 * header 更新历史入口 + 未读红点验收(桌面 xl / 手机)。
 *
 * ⚠️ 两个坑,都栽过:
 *  ① 页面上**同时存在两个** /changelog 链接(手机版 `xl:hidden` + 桌面版在
 *     `hidden xl:flex` 的 nav 里)。`.first()` 会抓到 DOM 里靠前但**当前不可见**
 *     的那个 → 点击一直超时。必须用 `:visible`。
 *  ② 别用 addInitScript 去清 `pz-changelog-seen` —— 它在**每次导航**都会跑,
 *     于是「看过之后红点该熄」这条永远测不出来(刚写进去就被下一次导航清掉)。
 */
import { chromium } from 'playwright'
import fs from 'fs'

const OUT = 'shots-changelog'
fs.mkdirSync(OUT, { recursive: true })
const FE = process.env.FE || 'http://localhost:5174'

const browser = await chromium.launch()
let fail = 0
const check = (l, ok, d = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${d ? ' — ' + d : ''}`); if (!ok) fail++ }

for (const [tag, vp] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 414, height: 896 }]]) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  await page.goto(FE + '/', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4500)

  const link = page.locator('a[href="/changelog"]:visible').first()
  check(`${tag}: header 有更新历史入口`, await link.count() > 0)
  if (await link.count() === 0) { await ctx.close(); continue }

  check(`${tag}: 没读过 → 红点亮`, await link.locator('span.bg-rose-500').count() > 0)
  await page.screenshot({
    path: `${OUT}/_header-${tag}.png`,
    clip: { x: Math.max(0, vp.width - 460), y: 0, width: Math.min(460, vp.width), height: 110 },
  })

  await link.click()
  await page.waitForTimeout(2500)
  check(`${tag}: 点进去是更新历史`, /更新历史|What's new/.test(await page.evaluate(() => document.body.innerText)))

  // 回首页:红点该熄(这里**不清** localStorage —— 就是要验它真的记住了)
  await page.goto(FE + '/', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3500)
  check(`${tag}: 看过之后红点熄灭`,
    await page.locator('a[href="/changelog"]:visible span.bg-rose-500').count() === 0)

  await ctx.close()
}

await browser.close()
console.log(fail === 0 ? `\n✅ 全部通过,截图在 ${OUT}/` : `\n❌ ${fail} 项未通过`)
process.exit(fail === 0 ? 0 : 1)
