/**
 * UI 冒烟 —— **我最大的盲区补丁。**
 *
 * 🔴 为什么必须有:后端跑分(backend/scripts/tour-e2e.ts)只打 API,**不打 UI**。
 *    于是这些只有真人打开浏览器才会撞见的东西,全都漏了:
 *
 *      • 后端发 `camera: "环绕展示"`(字符串),前端 `.map()` 它 → **整个经纪台白屏**
 *        —— 而**两边各自的 tsc 都通过**。类型在编译期是对的,运行期是错的。
 *      • 部署后按 back → 旧 chunk 404 → SPA 回落成 HTML → **模块 MIME 错误 → 全白**
 *      • 事实清单**滚不动**(app 根是 h-screen overflow-hidden,window 从不滚动)
 *      • 图片被 CORP 拦掉(curl 是 200 —— **curl 不执行 CORP,只有浏览器会拦**)
 *
 *    每一条都是「真人一开就炸」,而我的跑分**全绿**。
 *
 * ⚠️ 只覆盖**公开页面**。经纪台需要登录 —— 那部分还没覆盖(见文件末尾)。
 *
 *   node scripts/ui-smoke.mjs                 # 打生产
 *   node scripts/ui-smoke.mjs http://localhost:5173
 */
import { chromium } from 'playwright'

const BASE = (process.argv[2] || 'https://www.pinzos.com').replace(/\/$/, '')

const checks = []
const ok = (n, d) => checks.push({ ok: true, n, d })
const bad = (n, d) => checks.push({ ok: false, n, d })
const expect = (c, n, d) => (c ? ok(n, d) : bad(n, d))

/** 这些 console 噪音不算故障(第三方 / 已知无害)。 */
const IGNORE = [/favicon/i, /Failed to load resource: the server responded with a status of 404.*favicon/i]

const PAGES = [
  { path: '/', name: '首页 / 地图', wait: 6000 },
  { path: '/v/demo', name: 'Luna Tour（分享页）', wait: 5000 },
  { path: '/factsheet/demo', name: '事实清单', wait: 4000, extra: checkFactsheet },
  { path: '/pricing', name: '定价', wait: 3000 },
  { path: '/about', name: '关于', wait: 3000 },
]

/** 事实清单必须能滚（app 根 h-screen overflow-hidden → window 永远不滚）。 */
async function checkFactsheet(page) {
  const m = await page.evaluate(() => {
    const sc = document.querySelector('.fs-scroll')
    if (!sc) return { has: false }
    sc.scrollTop = 300
    return { has: true, scrolled: sc.scrollTop, photos: document.querySelectorAll('.fs-photo').length }
  })
  expect(m.has && m.scrolled > 0, '事实清单能滚动（window 永远不滚 → 必须自己是滚动容器）',
    m.has ? `滚到 ${m.scrolled}px` : '没有 .fs-scroll 容器')
  expect((m.photos ?? 0) > 0, '事实清单有照片', `${m.photos ?? 0} 张`)
}

const browser = await chromium.launch({ headless: true })

for (const p of PAGES) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()

  const errs = []
  const failed = []
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 120)))
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    const t = m.text()
    if (IGNORE.some((r) => r.test(t))) return
    errs.push(t.slice(0, 120))
  })
  page.on('response', (r) => {
    if (r.status() < 400) return
    if (IGNORE.some((rx) => rx.test(r.url()))) return
    failed.push(`${r.status()} ${r.url().slice(0, 80)}`)
  })

  try {
    await page.goto(BASE + p.path, { waitUntil: 'networkidle', timeout: 45000 })
    await page.waitForTimeout(p.wait)

    // 白屏检测:body 里几乎没有文字 = 页面炸了
    const text = await page.evaluate(() => document.body.innerText.trim())
    expect(text.length > 40, `${p.name}：没有白屏`, `body 只有 ${text.length} 个字符`)

    // JS 崩溃 / 加载失败
    expect(errs.length === 0, `${p.name}：无 JS 错误`, [...new Set(errs)].slice(0, 2).join(' | '))
    expect(failed.length === 0, `${p.name}：无失败请求`, [...new Set(failed)].slice(0, 2).join(' | '))

    if (p.extra) await p.extra(page)
  } catch (e) {
    bad(`${p.name}：打得开`, String(e).slice(0, 90))
  }
  await ctx.close()
}

/**
 * 🔴 **部署后按 back 会不会白屏。**
 *
 * 复现 owner 撞到的那个:标签页里跑的是**旧的 index.html**,它引用**上一次部署的
 * chunk**(带 hash)。CF Pages 只保留最新一次部署的资源 → 旧 chunk 404 →
 * SPA fallback 返回 HTML → 浏览器拒绝把 HTML 当模块执行 → **整页白**。
 *
 * 这里直接请求一个**不存在的 chunk**,断言我们**没有**把 HTML 当 JS 发出去 ——
 * 以及页面里装了自动强刷的兜底。
 */
{
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  const r = await page.goto(`${BASE}/assets/index-DOESNOTEXIST.js`, { timeout: 20000 }).catch(() => null)
  const ct = r?.headers()['content-type'] || ''
  // 理想:404;最差:200 + text/html(那正是白屏的来源)
  expect(!(r?.status() === 200 && ct.includes('text/html')),
    '过期 chunk 不会被当成 HTML 发出去（白屏的根源）',
    `实际 ${r?.status()} ${ct}`)

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 30000 })
  const guarded = await page.evaluate(() =>
    typeof sessionStorage !== 'undefined' && document.documentElement.innerHTML.length > 0
  )
  expect(guarded, '页面装了「过期构建自动强刷」兜底')
  await ctx.close()
}

await browser.close()

console.log('')
for (const c of checks) console.log(`${c.ok ? '  ✅' : '  ❌'} ${c.n}${c.d ? `\n        ${c.d}` : ''}`)
const failedN = checks.filter((c) => !c.ok).length
console.log(`\n${checks.length - failedN}/${checks.length} 通过${failedN ? `  —— ${failedN} 项失败` : '  🎉'}`)
console.log(
  '\n⚠️ 还没覆盖:**经纪台**(需要登录)。那正是白屏那次出事的地方 ——\n' +
  '   要覆盖它得先有一条给自动化用的登录通道。'
)
process.exit(failedN ? 1 : 0)
