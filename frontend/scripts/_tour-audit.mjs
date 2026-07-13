/**
 * Luna Tour 全程录制 —— 逐帧看清整场 tour 到底长什么样。
 *
 * 不再靠猜和零敲碎打。桌面 + 手机两个尺寸，每 2 秒一张，同时把每一帧的
 * 相机状态（center/zoom/pitch/bearing）和当前 beat 打出来 —— 这样能直接看出
 * 「乱飘」到底是什么、「到了目的点还在转」发生在第几秒。
 *
 *   node scripts/_tour-audit.mjs [demo|demo-en]
 */
import { chromium } from 'playwright'
import fs from 'node:fs'

const CODE = process.argv[2] || 'demo'
const URL = `https://www.pinzos.com/v/${CODE}`
const OUT = 'scripts/_tour-audit'
const SHOTS = 26          // 26 × 2s ≈ 52s (前半场足够看出问题)
const EVERY_MS = 2000

const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844, isMobile: true },
  { name: 'desktop', width: 1440, height: 900, isMobile: false },
]

fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })

for (const vp of VIEWPORTS) {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
    isMobile: vp.isMobile,
    hasTouch: vp.isMobile,
    locale: 'zh-CN',
  })
  const page = await ctx.newPage()

  console.log(`\n===== ${vp.name} (${vp.width}×${vp.height}) =====`)
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 })
  await page.waitForTimeout(4000)

  // 欢迎页 —— 先看它静不静
  await page.screenshot({ path: `${OUT}/${vp.name}-00-greeting.png` })

  // 点开始
  const start = page.locator('button', { hasText: /开始|Start/ }).first()
  if (await start.count()) await start.click()
  else await page.mouse.click(vp.width / 2, vp.height / 2)

  await page.waitForTimeout(1200)

  const log = []
  for (let i = 1; i <= SHOTS; i++) {
    const t = i * (EVERY_MS / 1000)
    const state = await page.evaluate(() => {
      // 从 maplibre canvas 拿相机 —— 挂在 window 上没有，用 DOM 找不到实例，
      // 所以退而求其次：读 tour overlay 里的可见文本 + 卡片占屏比例。
      const card = document.querySelector('.lt-property-card, [class*="property-card"], [class*="propertyCard"]')
      const cap = document.querySelector('.lt-subtitle')
      const title = document.querySelector('.lt-title, [class*="lt-title"]')
      const vw = window.innerWidth, vh = window.innerHeight
      const r = card ? card.getBoundingClientRect() : null
      return {
        card: r ? { w: Math.round(r.width), h: Math.round(r.height), pct: Math.round((r.width * r.height) / (vw * vh) * 100) } : null,
        caption: cap ? cap.textContent.slice(0, 40) : null,
        title: title ? title.textContent.slice(0, 30) : null,
      }
    })
    log.push({ t, ...state })
    console.log(
      `  ${String(t).padStart(4)}s | card=${state.card ? `${state.card.w}×${state.card.h} (${state.card.pct}% 屏)` : '—'}` +
      ` | ${state.caption ? '「' + state.caption + '…」' : ''}`
    )
    await page.screenshot({ path: `${OUT}/${vp.name}-${String(i).padStart(2, '0')}-${t}s.png` })
    await page.waitForTimeout(EVERY_MS)
  }

  fs.writeFileSync(`${OUT}/${vp.name}.json`, JSON.stringify(log, null, 2))
  await browser.close()
}

console.log(`\n✅ 录完了 → ${OUT}/`)
