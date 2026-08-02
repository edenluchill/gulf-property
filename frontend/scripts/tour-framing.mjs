/**
 * Luna Tour —— **主角到底落在屏幕的哪儿。**
 *
 * 为什么要它:俯角和构图是互相打架的两件事。
 *   • 俯角低（20°）→ 构图准（所见即所算），但 owner 说「直勾勾从上而下」不好看。
 *   • 俯角高（40°+）→ 有航拍味，但近景地面吃掉下半屏，**主角全被挤到上面三分之一**
 *     —— 我上一轮就是因为这个把俯角从 34 压到 20 的。
 * 所以调俯角不能靠眼睛,要看**主角的归一化坐标**:项目 pin / POI 落在 0~1 的哪个位置,
 * 有没有跑出「看得见的那块」(扣掉章节条和字幕之后)。
 *
 *   node scripts/tour-framing.mjs [--code=p-xxx] [--dist=dist] [--secs=60]
 *
 * 理想:主角的 y 落在可见区域的 0.35~0.65 之间,x 落在 0.2~0.8 之间。
 */
import { chromium } from 'playwright'
import path from 'node:path'
import fs from 'node:fs'

const arg = (k, d) => {
  const h = process.argv.find((a) => a.startsWith(`--${k}=`))
  return h ? h.split('=').slice(1).join('=') : d
}
const CODE = arg('code', 'p-binghatti-aquarise')
const DIST = arg('dist', '')
const SECS = Number(arg('secs', 60))
const OUT = 'scripts/_tours-shots'
fs.mkdirSync(OUT, { recursive: true })

const payload = await (await fetch(`https://api.pinzos.com/api/luna/public/v/${CODE}`)).json()
/** 主角 = 项目本身 + 它讲到的每个配套（配套拍要求两点同时在画面里）。 */
const coords = [
  ...payload.properties.map((x) => x.snapshot.coords).filter(Array.isArray),
  ...(payload.properties[0]?.snapshot?.distances ?? []).map((d) => d.to),
]
console.log(`主角 ${coords.length} 个点（项目 + 配套）`)

for (const vp of [
  { n: 'phone', w: 390, h: 844, m: true },
  { n: 'desktop', w: 1440, h: 900, m: false },
]) {
  const b = await chromium.launch({ headless: true, args: ['--use-angle=d3d11'] })
  const ctx = await b.newContext({
    viewport: { width: vp.w, height: vp.h },
    deviceScaleFactor: 2,
    isMobile: vp.m,
    hasTouch: vp.m,
    locale: 'zh-CN',
  })
  const p = await ctx.newPage()
  await p.addInitScript((v) => {
    try {
      localStorage.setItem('app-visitor-id', v)
    } catch {
      /* ignore */
    }
  }, arg('visitor', 'ce2a07df-7273-4992-af45-eda9d385f164'))
  if (DIST) {
    const root = path.resolve(DIST)
    await p.route('https://www.pinzos.com/**', async (r) => {
      const rel = new URL(r.request().url()).pathname
      const f = path.join(root, rel === '/' ? '/index.html' : rel)
      if (path.extname(rel) && fs.existsSync(f)) return r.fulfill({ path: f })
      return r.fulfill({ path: path.join(root, 'index.html') })
    })
  }
  await p.goto(`https://www.pinzos.com/?toursession=${CODE}`, { waitUntil: 'domcontentloaded', timeout: 90000 })
  await p.locator('.lt-greet-btn').waitFor({ state: 'visible', timeout: 60000 })
  await p.waitForTimeout(2500)

  // 欢迎页(= tour 第一帧的机位)先量一次 —— 这是客户看到的第一眼
  const shot = async (label) =>
    p.evaluate(
      ({ label, coords }) => {
        const m = window.__pinzosMap
        if (!m) return null
        // 坐标由 Node 侧从会话 API 取好传进来 —— maplibre 5 的 GeoJSONSource
        // 拿不到 _data,从源里读会永远是空(我第一版就是这样,一行都没打印出来)。
        const pts = coords
        if (!pts.length) return null
        const host = document.querySelector('.lt-tour-host')
        const hidden = parseFloat(getComputedStyle(host || document.body).getPropertyValue('--lt-hidden-bottom')) || 0
        // 「看得见的那块」= 扣掉章节条(顶)和字幕/卡片(底)
        const top = window.innerWidth < 700 ? 56 : 64
        const bottom = (window.innerWidth < 700 ? 170 : 120) + hidden
        const visTop = top
        const visBot = window.innerHeight - bottom
        return {
          label,
          pitch: +m.getPitch().toFixed(1),
          zoom: +m.getZoom().toFixed(2),
          pts: pts.map((c) => {
            const q = m.project(c)
            return {
              x: +(q.x / window.innerWidth).toFixed(3),
              y: +((q.y - visTop) / (visBot - visTop)).toFixed(3),
            }
          }),
        }
      },
      { label, coords }
    )

  const rows = [await shot('欢迎页')]
  await p.locator('.lt-greet-btn').click()
  for (const t of [4, 10, 16]) {
    await p.waitForTimeout(t === 4 ? 4000 : 6000)
    rows.push(await shot(`开场 +${t}s`))
  }
  // 一路采到配套段
  for (let i = 0; i < Math.max(0, (SECS - 16) / 6); i++) {
    await p.waitForTimeout(6000)
    rows.push(await shot(`+${22 + i * 6}s`))
  }

  console.log(`\n===== ${vp.n} =====`)
  for (const r of rows) {
    if (!r) continue
    const bad = r.pts.filter((q) => q.y < 0.05 || q.y > 0.95 || q.x < 0.03 || q.x > 0.97)
    const off = r.pts.filter((q) => q.y < 0 || q.y > 1 || q.x < 0 || q.x > 1)
    const ys = r.pts.map((q) => q.y)
    const mid = (Math.min(...ys) + Math.max(...ys)) / 2
    const flag = off.length ? '❌ 有主角在可见区外' : bad.length ? '⚠️ 贴边' : mid < 0.3 ? '⚠️ 偏上' : mid > 0.75 ? '⚠️ 偏下' : '✅'
    console.log(
      `  ${r.label.padEnd(10)} pitch ${String(r.pitch).padStart(4)}° zoom ${String(r.zoom).padStart(5)} ` +
        `主角 y=${r.pts.map((q) => q.y.toFixed(2)).join(',')} 中点 ${mid.toFixed(2)}  ${flag}`
    )
  }
  await b.close()
}
console.log('\n判读:y 是在「看得见的那块」里的归一化位置(0=顶 1=底)。0.35~0.65 最舒服。')
