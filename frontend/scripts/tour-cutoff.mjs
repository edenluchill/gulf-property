/**
 * Luna Tour —— **有没有东西被屏幕裁掉**（owner 报的项目卡被切一半、CC/喇叭整个消失）。
 *
 * 根因:地图容器在 `h-screen`(=100vh)里,而手机浏览器的 100vh 是「地址栏收起时」的
 * 大视口。地址栏/系统导航栏一露出来,页面底部那一条就在可见区域之外。
 * 修法是把 `.lt-tour-host` 的底边收到真正看得见的那条线上(`--lt-hidden-bottom`)。
 *
 * ⚠️ **Playwright 没有 Android 的地址栏**,所以这里用注入 `--lt-hidden-bottom` 的方式
 * 复现同一个几何:hidden=0(桌面/全屏)和 hidden=120(手机露出浏览器 UI)两种情况下,
 * 每一个 tour 浮层元素都必须完整落在可见区域内。
 *
 *   node scripts/tour-cutoff.mjs [--dist=dist] [--hidden=120]
 */
import { chromium } from 'playwright'
import path from 'node:path'
import fs from 'node:fs'

const arg = (k, d) => {
  const h = process.argv.find((a) => a.startsWith(`--${k}=`))
  return h ? h.split('=').slice(1).join('=') : d
}
const TOUR_URL = arg('url', `https://www.pinzos.com/?toursession=${arg('code', 'demo')}`)
const DIST = arg('dist', '')
const HIDDEN = Number(arg('hidden', 120))
const OUT = 'scripts/_tour-jitter'
fs.mkdirSync(OUT, { recursive: true })

/** tour 期间可能出现的所有浮层（选择器 → 人话名字）。加新浮层就往这里补一条。 */
const OVERLAYS = [
  ['.lt-exit', '退出按钮'],
  ['.lt-agent-badge', '经纪名片'],
  ['.lt-chapters', '章节条'],
  ['.lt-subtitle', '字幕'],
  ['.lt-mute', '喇叭'],
  ['.lt-cc', '字幕开关'],
  ['.lt-ov-card', '项目卡'],
  ['.lt-ov-title', '标题卡'],
  ['.lt-ov-units', '户型卡'],
  ['.lt-ov-compare', '区域对比卡'],
  ['.lt-ov-roi', '投资卡'],
  ['.lt-ov-cta', 'CTA'],
  ['.lt-ov-picker', '收藏选择'],
  ['.lt-ov-media', '媒体'],
  ['.lt-evidence', '成交证据卡'],
  ['.lt-resume', '继续观看'],
  ['.lt-ask-luna', '问问 Luna'],
  ['.lt-ask-hint', '提示行'],
  ['.lt-explore-strip', '自己看看条'],
  ['.lt-live-caption', 'Luna 回答'],
  ['.lt-bigbtn', '再看一遍'],
  ['.lt-voice-warn', '无配音横幅'],
  ['.lt-edit-banner', '批注横幅'],
  ['.lt-comment', '批注输入'],
]

const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11'] })
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  locale: 'zh-CN',
})
const page = await ctx.newPage()
await page.addInitScript((v) => {
  try {
    localStorage.setItem('app-visitor-id', v)
  } catch {
    /* ignore */
  }
}, arg('visitor', 'ce2a07df-7273-4992-af45-eda9d385f164'))
if (DIST) {
  const root = path.resolve(DIST)
  const origin = new URL(TOUR_URL).origin
  await page.route(`${origin}/**`, async (route) => {
    const rel = new URL(route.request().url()).pathname
    const file = path.join(root, rel === '/' ? '/index.html' : rel)
    if (path.extname(rel) && fs.existsSync(file)) return route.fulfill({ path: file })
    return route.fulfill({ path: path.join(root, 'index.html') })
  })
}

/** 量一遍：每个浮层是否完整落在「可见区域」内。 */
async function audit(label, hidden) {
  const res = await page.evaluate(
    ({ list, hidden }) => {
      const host = document.querySelector('.lt-tour-host')
      if (!host) return { err: 'no host' }
      // 模拟手机浏览器 UI 吃掉底部 hidden 像素
      host.style.setProperty('--lt-hidden-bottom', `${hidden}px`)
      const visibleTop = 0
      const visibleBottom = window.innerHeight - hidden
      const rows = []
      for (const [sel, name] of list) {
        for (const el of document.querySelectorAll(sel)) {
          const r = el.getBoundingClientRect()
          if (r.width === 0 && r.height === 0) continue
          const cs = getComputedStyle(el)
          if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue
          rows.push({
            name,
            sel,
            top: Math.round(r.top),
            bottom: Math.round(r.bottom),
            left: Math.round(r.left),
            right: Math.round(r.right),
            cutBottom: Math.round(Math.max(0, r.bottom - visibleBottom)),
            cutTop: Math.round(Math.max(0, visibleTop - r.top)),
            cutLeft: Math.round(Math.max(0, 0 - r.left)),
            cutRight: Math.round(Math.max(0, r.right - window.innerWidth)),
          })
        }
      }
      /**
       * 互相盖住也算 —— 「被按钮盖死」和「被屏幕裁掉」对客户是同一件事。
       * 只报**实质性**重叠(小面积压角是设计里常见的,比如收藏心叠在卡片角上),
       * 阈值取「较小那个元素面积的 45%」。
       */
      const overlaps = []
      for (let i = 0; i < rows.length; i++) {
        for (let j = i + 1; j < rows.length; j++) {
          const a = rows[i]
          const b = rows[j]
          const w = Math.min(a.right, b.right) - Math.max(a.left, b.left)
          const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
          if (w <= 0 || h <= 0) continue
          const areaA = (a.right - a.left) * (a.bottom - a.top)
          const areaB = (b.right - b.left) * (b.bottom - b.top)
          const frac = (w * h) / Math.max(1, Math.min(areaA, areaB))
          if (frac >= 0.45) overlaps.push({ a: a.name, b: b.name, pct: Math.round(frac * 100) })
        }
      }
      return { rows, overlaps, visibleBottom, vw: window.innerWidth }
    },
    { list: OVERLAYS, hidden }
  )
  if (res.err) {
    console.log(`  ✖ ${label}: ${res.err}`)
    return 1
  }
  let bad = 0
  console.log(`\n── ${label}（可见区域 0..${res.visibleBottom}px，浏览器 UI 吃掉 ${hidden}px）`)
  for (const r of res.rows) {
    const cuts = []
    if (r.cutBottom > 0) cuts.push(`底部裁 ${r.cutBottom}px`)
    if (r.cutTop > 0) cuts.push(`顶部裁 ${r.cutTop}px`)
    if (r.cutLeft > 0) cuts.push(`左侧裁 ${r.cutLeft}px`)
    if (r.cutRight > 0) cuts.push(`右侧裁 ${r.cutRight}px`)
    if (cuts.length) {
      bad++
      console.log(`  ❌ ${r.name.padEnd(12)} ${r.sel.padEnd(20)} ${cuts.join(' · ')}   (top ${r.top} bottom ${r.bottom})`)
    } else {
      console.log(`  ✅ ${r.name.padEnd(12)} ${r.sel.padEnd(20)} top ${r.top} bottom ${r.bottom}`)
    }
  }
  for (const o of res.overlaps) {
    bad++
    console.log(`  ❌ 互相盖住:${o.a} ↔ ${o.b}(重叠 ${o.pct}%)—— 被盖住和被裁掉一样糟`)
  }
  return bad
}

await page.goto(TOUR_URL, { waitUntil: 'domcontentloaded', timeout: 90000 })
await page.locator('.lt-greet-btn').waitFor({ state: 'visible', timeout: 60000 })
await page.waitForTimeout(1500)

let bad = 0
bad += await audit('欢迎页', HIDDEN)
await page.locator('.lt-greet-btn').click()

// 开场（标题卡 + 字幕）
await page.waitForTimeout(4000)
bad += await audit('开场', HIDDEN)
await page.screenshot({ path: `${OUT}/cutoff-intro.png` })

// 到访项目（项目卡 —— owner 截图里被切一半的那张）
await page.waitForTimeout(22000)
bad += await audit('到访项目', HIDDEN)
await page.screenshot({ path: `${OUT}/cutoff-arrival.png` })

// 暂停（继续观看 / 问问 Luna / 自己看看条）
await page.mouse.click(195, 300)
await page.waitForTimeout(1200)
bad += await audit('暂停', HIDDEN)
await page.screenshot({ path: `${OUT}/cutoff-paused.png` })

// hidden=0（桌面/全屏）—— 确认修复没把东西顶飞
bad += await audit('对照:浏览器 UI 不占位', 0)

console.log(`\n${bad === 0 ? '✅ 没有任何浮层被裁' : `❌ ${bad} 处被裁`}   截图 ${OUT}/cutoff-*.png`)
await browser.close()
process.exit(bad === 0 ? 0 : 1)
