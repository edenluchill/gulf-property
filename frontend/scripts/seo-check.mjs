/**
 * SEO 巡检 —— 公开页的 title / description / canonical 是否齐全且指向规范域。
 *
 * 为什么必须**真渲染**:meta 全靠 react-helmet-async 在客户端注入,
 * curl 拿到的 index.html 里一个都没有。用 curl 验 canonical 会得到假阴性。
 *
 * 用法:
 *   node scripts/seo-check.mjs                      # 打生产
 *   node scripts/seo-check.mjs http://localhost:5173  # 打本地
 *
 * 检查项:
 *   1. 有 title,且不是 index.html 里那个默认标题(= 该页没设 Helmet)
 *   2. 有 description
 *   3. 有 canonical,且以 https://www.pinzos.com 开头
 *      —— canonical 写裸域会让 Google 顺着它撞上 301,GSC 直接判「Page with redirect」,
 *         这正是 2026-07-18 只索引 4 页的根因之一。
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] || 'https://www.pinzos.com'
const CANONICAL_ORIGIN = 'https://www.pinzos.com'
const DEFAULT_TITLE = 'Pinzos - A New Way to Buy Off-Plan in Dubai'

// 公开可索引页。与 public/sitemap.xml 保持一致。
const PAGES = ['/', '/about', '/pricing', '/areas', '/transactions', '/changelog', '/privacy', '/terms']

const browser = await chromium.launch()
const page = await browser.newPage()
let failures = 0

for (const path of PAGES) {
  // ⚠️ 别用 networkidle + 固定 sleep。首页是地图,瓦片一直在流,networkidle **永远不触发**
  //    → goto 超时 → 固定等 2 秒时 React 还没挂完 → canonical 报「无」的**假阴性**
  //    (2026-07-18 就这么误报过一次)。改成等 Helmet 真的把标签注进来。
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {})
  await page
    .waitForSelector('link[rel=canonical][data-rh], meta[name=description][data-rh]', { timeout: 20000 })
    .catch(() => {})
  await page.waitForTimeout(800) // 让页面级 Helmet 覆盖掉 DefaultSeo 的默认值

  const r = await page.evaluate(() => ({
    title: document.title,
    canonical: document.querySelector('link[rel=canonical]')?.href || null,
    desc: document.querySelector('meta[name=description]')?.content || null,
  }))

  const problems = []
  if (!r.title) problems.push('无 title')
  // 首页用的就是默认标题,这是对的;其余页面撞上默认标题 = 没设 Helmet
  else if (path !== '/' && r.title === DEFAULT_TITLE) problems.push('title 是默认值(没设 Helmet)')
  if (!r.desc) problems.push('无 description')
  if (!r.canonical) problems.push('无 canonical')
  else if (!r.canonical.startsWith(CANONICAL_ORIGIN)) problems.push(`canonical 不是规范域: ${r.canonical}`)

  if (problems.length) failures++
  console.log(`${problems.length ? '❌' : '✅'} ${path}`)
  console.log(`   title:     ${r.title || '(无)'}`)
  console.log(`   canonical: ${r.canonical || '(无)'}`)
  console.log(`   desc:      ${(r.desc || '(无)').slice(0, 70)}`)
  if (problems.length) console.log(`   ⚠️  ${problems.join(' / ')}`)
}

await browser.close()
console.log(`\n${failures ? `❌ ${failures}/${PAGES.length} 页有问题` : `✅ ${PAGES.length} 页全部通过`}`)
process.exit(failures ? 1 : 0)
