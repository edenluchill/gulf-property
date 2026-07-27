/**
 * 屏幕底部所有浮元素的几何验收 —— 两种场景 × 三档屏宽。
 *
 * 修的是什么:带看底栏、画笔调色板、分享链接、测距状态条、左下搜索钮以前各写各的
 * `fixed bottom-XX`,同时出现就必然重叠(桌面画笔条压住底栏、手机糊成一坨)。
 * 现在全挂进 BottomDock 的一个 flex 竖列。
 *
 * 🔴 **这里必须连坞外的浮元素一起量。**
 * 第一版只量坞里的条 → 三档全 PASS,但 owner 一点画笔照样撞:左下搜索钮和右下
 * Luna 药丸压根不在坞里,却和坞在同一条带上。「只检查我改过的东西」= 检查不出
 * 我没想到的东西。现在 Luna(data-luna-pill)也进两两比对。
 *
 * 场景:
 *   collab —— 客户端 /t/:code(不用登录,跑真实带看 UI:底栏 + 语音大入口 + 画笔条)。
 *             chromeless,Luna 被藏、无底部导航。经纪独有的「分享链接」行本地登录不了,
 *             用同样挂进坞的假节点补上,验的是坞的排布(那正是重叠的成因)。
 *   solo   —— 普通地图 /?drawtest=1。**有底部导航 + Luna 药丸 + 搜索钮**,
 *             这才是 Luna 会撞上的场景,collab 场景测不出来。
 *
 * 用法:
 *   VITE_API_URL=https://api.pinzos.com npx vite --port 5174   # 另开一个终端
 *   node scripts/_shot-livetour-dock.mjs
 *   HEADED=1 node scripts/_shot-livetour-dock.mjs              # 想亲眼看
 */
import { chromium } from 'playwright'
import fs from 'fs'

const BE = process.env.BE || 'https://api.pinzos.com'
const FE = process.env.FE || 'http://localhost:5174'
const OUT = 'shots-livetour-dock'
fs.mkdirSync(OUT, { recursive: true })

let fail = 0
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
  if (!ok) fail++
}

// 建一间房(客户端进这个 code)
const res = await fetch(BE + '/api/collab/rooms', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Ahmed' }),
})
const { code } = await res.json()
if (!code) { console.error('建房失败,后端没给 code'); process.exit(2) }
console.log(`room ${code}\n`)

const VIEWPORTS = [
  { tag: 'phone', width: 367, height: 762, mobile: true },   // owner 截图用的就是这个宽度
  { tag: 'pad', width: 1180, height: 820, mobile: false },
  { tag: 'desktop', width: 1440, height: 900, mobile: false },
]

const browser = await chromium.launch({ headless: process.env.HEADED !== '1' })

/** 量:坞的每个直接子节点 + 坞外那些贴底浮元素 */
const measure = (page) => page.evaluate(() => {
  const box = (el, label) => {
    const r = el.getBoundingClientRect()
    return {
      label: label || (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24) || el.className.slice(0, 24),
      order: getComputedStyle(el).order,
      top: Math.round(r.top), bottom: Math.round(r.bottom),
      left: Math.round(r.left), right: Math.round(r.right),
      h: Math.round(r.height), w: Math.round(r.width),
    }
  }
  const d = document.getElementById('app-bottom-dock')
  if (!d) return null
  /**
   * 🔴 **最底那一行是个容器,里面还有东西 —— 必须下钻一层。**
   * 2026-07-27 第二次踩同一个坑:搜索钮挂进 base row 后不再是坞的直接子节点,
   * 只量 d.children 就把它漏了,而它当时正压在导航栏上 —— 检查还是全 PASS。
   * 「只量我以为的那一层」和上次「只量坞里不量坞外」是同一个错。
   */
  const flatten = (el) => {
    if (el.id === 'app-bottom-dock-base-row') return [...el.children].map((c) => box(c))
    return [box(el)]
  }
  const kids = [...d.children].flatMap(flatten).filter((k) => k.h > 0 && k.w > 0)
  const outside = []
  const luna = document.querySelector('[data-luna-pill]')
  if (luna) { const b = box(luna, 'Luna 药丸(坞外)'); if (b.h > 0) outside.push(b) }
  // ⚠️ MobileNav 是 xl:hidden —— 桌面下它 display:none,rect 全是 0。
  //    不过滤掉就会拿到 navTop=0,然后把「在导航之上」判成失败(假红灯)。
  const navEl = [...document.querySelectorAll('nav.fixed, [data-testid="mobile-nav"]')]
    .find((n) => n.getBoundingClientRect().height > 0)
  return {
    kids, outside,
    navTop: navEl ? Math.round(navEl.getBoundingClientRect().top) : null,
    vh: window.innerHeight,
    dockPointerEvents: getComputedStyle(d).pointerEvents,
  }
})

const assertGeo = (geo, minKids) => {
  console.log(`  坞内 ${geo.kids.length} 条:`)
  for (const k of geo.kids) console.log(`    order=${String(k.order).padStart(2)}  y ${k.top}→${k.bottom}  x ${k.left}→${k.right}  「${k.label}」`)
  for (const o of geo.outside) console.log(`    [坞外]        y ${o.top}→${o.bottom}  x ${o.left}→${o.right}  「${o.label}」`)

  check(`坞里至少 ${minKids} 条`, geo.kids.length >= minKids, `${geo.kids.length} 条`)

  // ① 两两不重叠 —— 坞内 + 坞外一起比
  const all = [...geo.kids, ...geo.outside]
  const overlaps = []
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j]
      const v = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
      const h = Math.min(a.right, b.right) - Math.max(a.left, b.left)
      if (v > 1 && h > 1) overlaps.push(`「${a.label}」×「${b.label}」叠了 ${v}×${h}px`)
    }
  }
  check('底部所有浮元素两两不重叠(含坞外 Luna)', overlaps.length === 0, overlaps.join('; '))

  // ② 全在视口内
  const out = all.filter((k) => k.top < 0 || k.bottom > geo.vh + 1 || k.left < -1 || k.right > 10000)
  check('全部在视口内(没被挤出屏幕)', out.length === 0,
    out.map((k) => `「${k.label}」${k.top}→${k.bottom}/vh=${geo.vh}`).join('; '))

  // ③ 最低一条要让开底部导航 / 屏幕底边
  const lowest = geo.kids.length ? geo.kids.reduce((m, k) => (k.bottom > m.bottom ? k : m), geo.kids[0]) : null
  if (!lowest) {
    check('坞里有东西可量', false, '坞是空的,这一档没验到任何排布')
  } else if (geo.navTop != null) {
    check('坞最低一条在底部导航之上', lowest.bottom <= geo.navTop + 1, `底边 ${lowest.bottom} vs 导航顶 ${geo.navTop}`)
  } else {
    check('坞最低一条离屏幕底边有余量', geo.vh - lowest.bottom >= 8, `余 ${geo.vh - lowest.bottom}px`)
  }

  // ④ 坞本身不能吃掉地图手势
  check('坞本身 pointer-events:none(不挡地图)', geo.dockPointerEvents === 'none', geo.dockPointerEvents)
}

const newPage = async (vp) => {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2, isMobile: vp.mobile, hasTouch: vp.mobile,
  })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 160)))
  await page.addInitScript(() => {
    localStorage.setItem('pinzos-lang', 'zh-CN')
    localStorage.setItem('map-base', 'satellite')
    localStorage.setItem('pz-collab-identity', JSON.stringify({ name: '测试客户' }))
    localStorage.setItem('app-visitor-id', 'v_dock_' + Math.random().toString(36).slice(2, 9))
  })
  return { ctx, page }
}

const openDraw = async (page) => {
  const pencil = page.locator('button[aria-label="画笔"], button[aria-label="Draw"]').first()
  if (await pencil.count() === 0) return false
  await pencil.click().catch(() => {})
  await page.waitForTimeout(800)
  return true
}

// ── 场景 1:带看客户端(真实带看 UI) ─────────────────────────────────────────
for (const vp of VIEWPORTS) {
  console.log(`── collab · ${vp.tag} ${vp.width}×${vp.height} ──`)
  const { ctx, page } = await newPage(vp)
  await page.goto(`${FE}/t/${code}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(12000)

  const gate = page.locator('input[placeholder*="称呼"], input[placeholder*="名字"]').first()
  if (await gate.count() > 0 && await gate.isVisible().catch(() => false)) {
    await gate.fill('测试客户')
    await page.getByRole('button', { name: /进入|开始|加入/ }).first().click().catch(() => {})
    await page.waitForTimeout(4000)
  }

  if (await page.locator('#app-bottom-dock').count() === 0) { check('底部坞已挂载', false); await ctx.close(); continue }
  check('底部坞已挂载', true)
  await openDraw(page)

  // 经纪独有的「分享链接」行:本地登录不了,用同样的坞子节点补一行,验排布。
  await page.evaluate(() => {
    const d = document.getElementById('app-bottom-dock')
    if (!d || d.querySelector('[data-sim-share]')) return
    const el = document.createElement('div')
    el.dataset.simShare = '1'
    el.style.order = '40'                          // DOCK_ORDER.share
    el.style.pointerEvents = 'auto'
    el.style.maxWidth = '100%'
    el.className = 'flex items-center gap-2 rounded-full bg-slate-900/90 px-3.5 py-1.5 text-xs text-white shadow-xl'
    el.textContent = '复制客户链接（模拟经纪行）'
    d.appendChild(el)
  })
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${OUT}/collab-${vp.tag}.png` })

  const geo = await measure(page)
  assertGeo(geo, 3)
  await ctx.close()
  console.log('')
}

// ── 场景 2:普通地图(有底部导航 + Luna 药丸 + 搜索钮)────────────────────────
for (const vp of VIEWPORTS) {
  console.log(`── solo · ${vp.tag} ${vp.width}×${vp.height} ──`)
  const { ctx, page } = await newPage(vp)
  await page.goto(`${FE}/?drawtest=1`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(13000)

  if (await page.locator('#app-bottom-dock').count() === 0) { check('底部坞已挂载', false); await ctx.close(); continue }
  check('底部坞已挂载', true)

  /**
   * 画笔现在要求登录(`canSoloDraw = !!user && …`,老的 ?drawtest 后门已删),
   * playwright 里登不了 → 注入一条**满宽**的假调色板行代替。
   * 这一档要验的就是几何:坞里一条满宽的行,会不会钻到右下 Luna 药丸底下。
   * 满宽是最坏情况,真调色板只会更窄。
   */
  await page.evaluate(() => {
    const d = document.getElementById('app-bottom-dock')
    if (!d || d.querySelector('[data-sim-tools]')) return
    const el = document.createElement('div')
    el.dataset.simTools = '1'
    el.style.order = '60'                          // DOCK_ORDER.tools
    el.style.pointerEvents = 'auto'
    el.style.width = '100%'                        // 最坏情况:占满坞的内容区
    el.className = 'flex h-11 items-center justify-center rounded-2xl bg-slate-900/90 text-xs text-white shadow-2xl'
    el.textContent = '画笔调色板（模拟满宽行）'
    d.appendChild(el)
  })
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${OUT}/solo-${vp.tag}.png` })

  const geo = await measure(page)
  assertGeo(geo, 1)

  // Luna 在这个场景必须是**显示着**的 —— 否则这一档等于没测到它
  check('Luna 药丸确实在场(这一档才有意义)', geo.outside.length > 0,
    geo.outside.length ? '' : '没找到 [data-luna-pill],这档没验到 Luna')
  await ctx.close()
  console.log('')
}

await browser.close()
console.log(fail === 0 ? `\n✅ 全部通过,截图在 ${OUT}/` : `\n❌ ${fail} 项未通过,截图在 ${OUT}/`)
process.exit(fail === 0 ? 0 : 1)
