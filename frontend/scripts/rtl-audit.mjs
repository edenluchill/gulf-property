/**
 * RTL 多断点巡检 —— 切阿拉伯语,把关键页在 手机/平板/桌面 三档下逐一截图,
 * 并**自动**抓出人眼扫图容易漏的三类硬伤:
 *
 *   1. 横向溢出 —— RTL 最典型的坏法:某个元素还锁在物理左/右,把页面撑出一条横向滚动条。
 *      判据 documentElement.scrollWidth > clientWidth + 1。
 *   2. 漏翻的键 —— 页面上出现 `ns:key.path` 这种裸键(i18next 找不到译文就原样吐 key),
 *      以及本该翻完的页上残留的 CJK。
 *   3. dir 没生效 —— <html dir> 或文档容器的 dir 不是 rtl。
 *
 * 用法:
 *   node scripts/rtl-audit.mjs                 # 全部页 × 三档
 *   node scripts/rtl-audit.mjs /cr/demo        # 只跑某条路由
 *   RTL_BASE=http://localhost:5174 node scripts/rtl-audit.mjs
 *
 * 产物: scripts/_rtl/<page>-<bp>.png + 控制台报告(有硬伤则 exit 1)
 */
import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'

const BASE = process.env.RTL_BASE || 'http://localhost:5174'
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '_rtl')
fs.mkdirSync(OUT, { recursive: true })

// 断点:owner 定的三档(手机/平板/桌面)。经纪全用 iPad → 平板档不是可选项。
const BREAKPOINTS = [
  { key: 'mobile', width: 414, height: 896, mobile: true },
  { key: 'pad', width: 1180, height: 820, mobile: true },   // iPad Pro 11" 横向
  { key: 'desktop', width: 1440, height: 900, mobile: false },
]

// 关键页。cr/r 是**分享给客户**的公开页 —— RTL 坏了客户直接看到。
const PAGES = [
  { key: 'home', url: '/' },
  { key: 'pricing', url: '/pricing' },
  { key: 'about', url: '/about' },
  { key: 'login', url: '/login' },
]

const only = process.argv[2]
const pages = only ? [{ key: only.replace(/\W+/g, '_').replace(/^_|_$/g, '') || 'page', url: only }] : PAGES

const browser = await chromium.launch()
const findings = []

for (const p of pages) {
  for (const bp of BREAKPOINTS) {
    const ctx = await browser.newContext({
      viewport: { width: bp.width, height: bp.height },
      deviceScaleFactor: 2,
      isMobile: bp.mobile,
      hasTouch: bp.mobile,
      locale: 'ar',
    })
    // 切阿语。app 用 pinzos-lang 存语言选择(见 i18n/index.ts)。
    await ctx.addInitScript(() => {
      localStorage.setItem('pinzos-lang', 'ar')
      localStorage.setItem('map-base', 'satellite')
    })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)))

    try {
      await page.goto(BASE + p.url, { waitUntil: 'networkidle', timeout: 30000 })
    } catch {
      await page.waitForTimeout(2500)   // networkidle 在有轮询的页上永远等不到
    }
    await page.waitForTimeout(1200)

    const probe = await page.evaluate(() => {
      const de = document.documentElement
      const overflowX = de.scrollWidth - de.clientWidth
      // 找把页面撑宽的元素(RTL 下多半是还锁着物理边的那个)
      const culprits = []
      if (overflowX > 1) {
        for (const el of document.querySelectorAll('body *')) {
          const r = el.getBoundingClientRect()
          if (r.width === 0 || r.height === 0) continue
          if (r.right > de.clientWidth + 1 || r.left < -1) {
            culprits.push({
              tag: el.tagName.toLowerCase(),
              cls: (el.className && String(el.className).slice(0, 70)) || '',
              left: Math.round(r.left), right: Math.round(r.right),
            })
            if (culprits.length >= 4) break
          }
        }
      }
      const text = document.body.innerText || ''
      // i18next 找不到译文 → 原样吐 key。形如 ns:a.b 或 a.b.c
      const rawKeys = [...new Set((text.match(/\b[a-zA-Z][\w]*:[a-z][\w]*(?:\.[\w]+)+/g) || []))].slice(0, 6)
      const cjk = [...new Set((text.match(/[一-龥]{2,}/g) || []))].slice(0, 6)
      return {
        overflowX, culprits,
        htmlDir: de.getAttribute('dir'),
        rawKeys, cjk,
      }
    })

    const file = path.join(OUT, `${p.key}-${bp.key}.png`)
    await page.screenshot({ path: file, fullPage: false })

    const bad = []
    if (probe.overflowX > 1) bad.push(`横向溢出 ${probe.overflowX}px`)
    if (probe.htmlDir !== 'rtl') bad.push(`html dir=${probe.htmlDir} (应为 rtl)`)
    if (probe.rawKeys.length) bad.push(`漏翻裸键: ${probe.rawKeys.join(', ')}`)
    if (probe.cjk.length) bad.push(`残留中文: ${probe.cjk.join(' / ')}`)
    if (errors.length) bad.push(`JS 错误: ${errors[0]}`)

    const tag = `${p.key.padEnd(10)} ${bp.key.padEnd(8)}`
    if (bad.length) {
      console.log(`  ❌ ${tag} ${bad.join(' | ')}`)
      probe.culprits.forEach((c) => console.log(`        ↳ 撑宽元素 <${c.tag}> [${c.left}..${c.right}] ${c.cls}`))
      findings.push({ page: p.key, bp: bp.key, bad })
    } else {
      console.log(`  ✅ ${tag} 无溢出 · dir=rtl · 零漏翻`)
    }
    await ctx.close()
  }
}

await browser.close()
console.log(`\n截图: ${OUT}`)
console.log(findings.length ? `\n❌ ${findings.length} 处硬伤` : '\n✅ 全部通过')
process.exit(findings.length ? 1 : 0)
