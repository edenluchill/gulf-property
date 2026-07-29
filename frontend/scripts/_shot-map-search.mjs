/**
 * 地图搜索框验证截图 —— 三档宽度 × 三个状态。
 * 用法: node scripts/_shot-map-search.mjs [outDir]
 *
 * 盯三件事:
 *  1. 桌面左上「搜索 + 筛选」两行的总高度变了没有 → 指北针 top 有没有被压/浮空
 *  2. 结果行的 Area / Project 徽标看不看得清
 *  3. 手机上展开后下拉是不是向上开、有没有被底栏盖住
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'fs'

const outDir = process.argv[2] || 'shots-map-search'
const url = process.env.SHOT_URL || 'http://localhost:5173/'
mkdirSync(outDir, { recursive: true })

const VIEWPORTS = [
  { name: '1440', width: 1440, height: 900, mobile: false },
  { name: '1180', width: 1180, height: 820, mobile: false },
  { name: '414', width: 414, height: 896, mobile: true },
]

const browser = await chromium.launch()

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
    hasTouch: vp.mobile,
    isMobile: vp.mobile,
  })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log(`[pageerror ${vp.name}]`, String(e).slice(0, 200)))
  await page.addInitScript(() => {
    localStorage.setItem('pinzos-lang', 'en')
    localStorage.setItem('map-base', 'vector')
  })
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(11000)

  // 手机版搜索收在底部一颗圆钮里,先点开
  if (vp.mobile) {
    const btn = page.locator('button[aria-label="Search an area or project"]')
    if (await btn.count()) { await btn.first().click(); await page.waitForTimeout(600) }
  }

  // ⚠️ 桌面版和手机版是两个实例(一个 hidden md:block,一个 md:hidden 在底部坞),
  // 不加 :visible 会在手机档抓到那个隐藏的桌面实例。
  const input = page.locator('input[aria-label="Search an area or project"]:visible').first()
  const shot = (n) => page.screenshot({ path: `${outDir}/${vp.name}-${n}.png`, fullPage: false })

  await shot('1-idle')

  await input.click()
  await page.waitForTimeout(500)
  await shot('2-focus-hint')          // 空态示例:一眼看出这框是搜什么的

  await input.type('jum', { delay: 60 })
  await page.waitForTimeout(2600)
  await shot('3-results')             // Area / Project 徽标 + 副标题

  await input.fill('')
  await input.type('sobha', { delay: 60 })
  await page.waitForTimeout(2600)
  await shot('4-results-mixed')       // 区 + 楼盘混排

  // 按 Enter 选第一条 → 应当飞过去并打开详情
  await page.keyboard.press('Enter')
  await page.waitForTimeout(3500)
  await shot('5-after-pick')

  console.log(`✅ ${vp.name} done`)
  await ctx.close()
}

await browser.close()
console.log(`\n截图在 ${outDir}/`)
