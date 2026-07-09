// 验证滚动收纳:pad 视口打开项目详情 → 下滑(双栏应收起) → 上滑一点(tab栏应回来,
// 导航不回) → 滚回顶(导航回来)。每个阶段截图 + 打印两栏状态。
import { chromium } from 'playwright'

const prefix = process.argv[2] || 'sc'
const pid = process.argv[3]
const base = process.env.SHOT_URL || 'http://localhost:5174'

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 834, height: 1000 }, deviceScaleFactor: 2, hasTouch: true })
const page = await ctx.newPage()
await page.addInitScript(() => { localStorage.setItem('pinzos-lang', 'zh-CN') })
await page.goto(`${base}/project/${pid}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(7000)

const state = async (tag) => {
  const s = await page.evaluate(() => {
    const header = document.querySelector('header')
    const hb = header?.getBoundingClientRect()
    const tabs = document.querySelector('[role="tablist"]')?.closest('.sticky')
    const tb = tabs ? getComputedStyle(tabs).transform : 'none'
    return { headerVisibleH: hb ? Math.max(0, Math.round(hb.bottom)) : -1, tabsTransform: tb }
  })
  console.log(tag, JSON.stringify(s))
}

const scroll = async (dy) => {
  await page.mouse.move(417, 520)
  await page.mouse.wheel(0, dy)
  await page.waitForTimeout(700)
}

await state('初始')
await page.screenshot({ path: `${prefix}-0-top.png` })

await scroll(500); await scroll(400)
await state('下滑后(双栏应收起)')
await page.screenshot({ path: `${prefix}-1-down.png` })

await scroll(-200)
await state('上滑一点(tab栏应回,导航不回)')
await page.screenshot({ path: `${prefix}-2-up.png` })

await scroll(-3000)
await state('滚回顶(导航应回来)')
await page.screenshot({ path: `${prefix}-3-backtop.png` })

await browser.close()
