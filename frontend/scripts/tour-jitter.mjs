/**
 * Luna Tour 抖动跑分 —— 把「疯狂颤抖」变成一个数字。
 *
 * 之前每次改运镜只能「改完请 owner 用真机看」。这个脚本在**手机尺寸 + DPR3 +
 * CPU 降速**下真跑一遍 tour，逐帧记录相机状态和帧间隔，然后算三件事：
 *
 *   1. 帧率        —— p50/p95/max 帧间隔、>33ms 的长帧占比（掉帧 = 顿）
 *   2. 屏幕位移    —— 每帧画面移动多少像素（p95/max）。抖动的观感 =
 *                     「大位移 + 不均匀间隔」，所以要一起看
 *   3. 真·振动     —— 相机在 zoom/bearing/center 上的**方向反转次数**。
 *                     时间驱动的插值绝不会反转；反转 = 有两个东西在抢相机，
 *                     或者采样时钟本身在抖
 *   4. long task   —— 主线程被 React/布局偷走多少毫秒（运镜帧的直接竞争者）
 *
 * 用法：
 *   node scripts/tour-jitter.mjs                 # 手机 + 桌面，打生产
 *   node scripts/tour-jitter.mjs --cpu=6         # 更狠的降速（模拟低端机）
 *   node scripts/tour-jitter.mjs --secs=45
 *   node scripts/tour-jitter.mjs --only=phone
 *
 * ⭐ 测**本地改动**（改完运镜想立刻知道数字有没有变好）：
 *   npx vite build && node scripts/tour-jitter.mjs --dist=dist --only=phone
 * `--dist` 把 https://www.pinzos.com 的静态资源劫持成本地 dist，**但 origin 仍是
 * www.pinzos.com** —— 所以后端 API / CORS / 瓦片全走真实生产，唯一变的就是前端代码。
 * （直接开 localhost:4173 不行:生产 API 不认这个 origin，tour 会「网络错误」。）
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`))
  return hit ? hit.split('=').slice(1).join('=') : d
}
const CODE = arg('code', 'demo')
const TOUR_URL = arg('url', `https://www.pinzos.com/?toursession=${CODE}`)
const SECS = Number(arg('secs', 40))
const CPU = Number(arg('cpu', 4))
const ONLY = arg('only', '')
const DIST = arg('dist', '')
/** 跳过开头这么多秒再开始采样 —— 开场那 18 秒的高空环绕是全片最贵的一段,
 *  拿它和「45 秒窗口里只有 8 秒开场」的旧数字比就是在比不同的东西。 */
const SKIP = Number(arg('skip', 0))
const OUT = 'scripts/_tour-jitter'

/** Serve a local `dist/` under the production origin (so the real API + CORS work). */
async function serveDist(page, dist) {
  const root = path.resolve(dist)
  const origin = new URL(TOUR_URL).origin
  await page.route(`${origin}/**`, async (route) => {
    const u = new URL(route.request().url())
    const rel = u.pathname === '/' ? '/index.html' : u.pathname
    const file = path.join(root, rel)
    if (path.extname(rel) && fs.existsSync(file)) return route.fulfill({ path: file })
    return route.fulfill({ path: path.join(root, 'index.html') })
  })
}

const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844, dpr: 3, isMobile: true, cpu: CPU },
  { name: 'desktop', width: 1440, height: 900, dpr: 2, isMobile: false, cpu: 1 },
].filter((v) => !ONLY || v.name === ONLY)

fs.mkdirSync(OUT, { recursive: true })

/**
 * 🔴 **跑分必须用内部 visitor id,否则跑几轮就把匿名地图额度烧光。**
 *
 * 烧光之后 `/api/dubai/landmarks`、`/api/dubai/areas` 全部 429 → **地标和区域图层
 * 压根不上地图**,于是页面变轻、帧率虚高,而我会以为是自己优化的功劳。
 * (我已经踩过一次:一轮 47.7fps 是在没有地标/区域的空地图上量出来的。)
 *
 * mapMeter 对「内部测试号」的 visitor_id 直接豁免(见 backend/src/middleware/mapMeter.ts),
 * 而内部号本身又被排除在所有分析口径之外 —— 所以跑分既不烧额度也不污染指标。
 * 这个 id 取自 app_events 里绑到 lt_agents 邮箱的浏览器。
 */
const INTERNAL_VISITOR_ID = arg('visitor', 'ce2a07df-7273-4992-af45-eda9d385f164')

/** Installed before any app code: pin the visitor id + a rAF probe + longtask observer. */
const PROBE = (visitorId) => {
  const w = /** @type {any} */ (window)
  try {
    localStorage.setItem('app-visitor-id', visitorId)
  } catch {
    /* storage blocked — 会退回匿名额度,跑分照跑但可能撞 429 */
  }
  w.__jit = { frames: [], long: [], started: 0, quota429: 0 }
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__jit.long.push(Math.round(e.duration))
    }).observe({ entryTypes: ['longtask'] })
  } catch {
    /* no longtask support */
  }
  const tick = () => {
    const m = w.__pinzosMap
    if (m && w.__jit.started) {
      try {
        const c = m.getCenter()
        w.__jit.frames.push([
          Math.round(performance.now()),
          +c.lng.toFixed(6),
          +c.lat.toFixed(6),
          +m.getZoom().toFixed(4),
          +m.getPitch().toFixed(3),
          +m.getBearing().toFixed(3),
        ])
      } catch {
        /* map mid-teardown */
      }
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

// ── analysis ──────────────────────────────────────────────────────────────────
const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0

function analyse(frames, vw) {
  // frames: [t, lng, lat, zoom, pitch, bearing]
  const dts = []
  const pxs = []
  let revZoom = 0,
    revBear = 0,
    revLng = 0
  let prevSz = 0,
    prevSb = 0,
    prevSl = 0
  for (let i = 1; i < frames.length; i++) {
    const [t0, lng0, lat0, z0, p0, b0] = frames[i - 1]
    const [t1, lng1, lat1, z1, , b1] = frames[i]
    const dt = t1 - t0
    if (dt <= 0) continue
    dts.push(dt)
    // screen-space displacement: pan (Mercator px at this zoom) + rotation at the
    // frame edge + zoom (radial). Rough but consistent — we compare runs, not physics.
    const scale = (256 * Math.pow(2, z0)) / 360 // px per degree lng
    const cos = Math.max(0.1, Math.cos((lat0 * Math.PI) / 180))
    const panPx = Math.hypot((lng1 - lng0) * scale, ((lat1 - lat0) * scale) / cos)
    const rotPx = (Math.abs(b1 - b0) * Math.PI * (vw / 2)) / 180
    const zoomPx = Math.abs(z1 - z0) * (vw / 2) * Math.LN2
    pxs.push(panPx + rotPx + zoomPx)
    // direction reversals (true oscillation, not just low fps)
    const sz = Math.sign(+(z1 - z0).toFixed(4))
    const sb = Math.sign(+(b1 - b0).toFixed(3))
    const sl = Math.sign(+(lng1 - lng0).toFixed(6))
    if (sz && prevSz && sz !== prevSz) revZoom++
    if (sb && prevSb && sb !== prevSb) revBear++
    if (sl && prevSl && sl !== prevSl) revLng++
    if (sz) prevSz = sz
    if (sb) prevSb = sb
    if (sl) prevSl = sl
  }
  /**
   * 🔴 **真正决定观感的是「画面动了」之间的间隔,不是 rAF 的间隔。**
   *
   * 引擎现在会**主动降到设备跑得动的匀速节拍**(不再每一帧都要求重绘)。所以 rAF 仍是
   * 60Hz、每帧位移接近 0 —— 光看 fps 会觉得完美,而客户看到的是每 33/50ms 动一次。
   * 这里只取「相机真的变了」的那些帧,算它们之间的间隔:**均匀 = 顺,忽快忽慢 = 抖。**
   * (真·静止镜头没有 move,不进统计,不会污染。)
   */
  const moveDts = []
  let lastMoveT = null
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1]
    const b = frames[i]
    const moved = a[1] !== b[1] || a[2] !== b[2] || a[3] !== b[3] || a[4] !== b[4] || a[5] !== b[5]
    if (!moved) continue
    if (lastMoveT != null) {
      const d = b[0] - lastMoveT
      if (d > 0 && d < 400) moveDts.push(d) // >400ms 多半是「这一拍本来就定住了」
    }
    lastMoveT = b[0]
  }
  const smd = [...moveDts].sort((a, b) => a - b)

  const sd = [...dts].sort((a, b) => a - b)
  const sp = [...pxs].sort((a, b) => a - b)
  const span = frames.length > 1 ? (frames[frames.length - 1][0] - frames[0][0]) / 1000 : 1
  return {
    frames: frames.length,
    seconds: +span.toFixed(1),
    fps: +(frames.length / span).toFixed(1),
    dt_p50: pct(sd, 0.5),
    dt_p95: pct(sd, 0.95),
    dt_max: sd[sd.length - 1] ?? 0,
    long_frames_pct: +((100 * dts.filter((d) => d > 33).length) / Math.max(1, dts.length)).toFixed(1),
    // 抖动核心指标：帧间隔的**不均匀度**（越接近 0 越顺）
    dt_jitter: +(pct(sd, 0.95) / Math.max(1, pct(sd, 0.5))).toFixed(2),
    px_p50: +pct(sp, 0.5).toFixed(1),
    px_p95: +pct(sp, 0.95).toFixed(1),
    px_max: +(sp[sp.length - 1] ?? 0).toFixed(1),
    rev_per_sec: +((revZoom + revBear + revLng) / span).toFixed(2),
    rev: { zoom: revZoom, bearing: revBear, lng: revLng },
    // ── 「画面动了」之间的间隔 = 观感的直接读数 ──
    move_hz: smd.length ? +(1000 / pct(smd, 0.5)).toFixed(1) : 0,
    move_p50: pct(smd, 0.5),
    move_p95: pct(smd, 0.95),
    move_max: smd[smd.length - 1] ?? 0,
    /** 匀不匀 —— 1.0 = 完美匀速。这就是「抖」的数字定义。 */
    move_unevenness: +(pct(smd, 0.95) / Math.max(1, pct(smd, 0.5))).toFixed(2),
    move_samples: smd.length,
  }
}

// ── run ───────────────────────────────────────────────────────────────────────
/**
 * 🔴 **单轮的数字不能信,必须取中位数。**
 *
 * 同一份代码连跑几轮,fps 能在 22 和 55 之间摆(卫星瓦片的网络延迟 + 本机负载)。
 * 我曾经据此得出「优化让它变慢了」的结论 —— 那是噪声,不是信号。
 * `--runs=3` 起步;比较两个版本时两边都要用同样的轮数。
 */
const RUNS = Number(arg('runs', 1))
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

/**
 * 🔴 **`--cpu=N` 是在本机当前负载之上再乘 N 倍。**
 *
 * 本机空闲时 cpu×6 ≈ 一台低端手机;本机在跑 vite build(或者刚跑完还没凉)时,
 * 同样的 cpu×6 会量出 5fps —— 而那**不是代码的问题**。
 * 我为此追过一次「回归」:反复 bisect,最后把上一个 commit 的相机代码 build 出来一量,
 * 它更慢(736 vs 686 ms/s)。**代码没退步,是机器在忙。**
 * 所以每次跑分先报一下本机负载,高了就直接喊停。
 */
async function hostLoad() {
  try {
    const { execSync } = await import('node:child_process')
    const out = execSync(
      'powershell -NoProfile -Command "(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average"',
      { encoding: 'utf8', timeout: 15000 }
    )
    return Number(out.trim())
  } catch {
    return NaN
  }
}
const LOAD = await hostLoad()
if (Number.isFinite(LOAD)) {
  const warn = LOAD > 25 && CPU > 1
  console.log(
    `本机 CPU 负载 ${LOAD}%` +
      (warn
        ? `  ⛔ **偏高,配合 --cpu=${CPU} 会量出假的「回归」** —— 等机器凉下来（别和 vite build 同时跑）再测,或改用 --cpu=1 看绝对值。`
        : '  ✅')
  )
}

const report = {}
const PLAN = VIEWPORTS.flatMap((vp) => Array.from({ length: RUNS }, (_, i) => ({ ...vp, run: i + 1 })))
for (const vp of PLAN) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', ...(arg("gpu","")? ["--use-angle=d3d11","--enable-unsafe-swiftshader"]:["--use-gl=swiftshader"])],
  })
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.dpr,
    isMobile: vp.isMobile,
    hasTouch: vp.isMobile,
    locale: 'zh-CN',
  })
  const page = await ctx.newPage()
  await page.addInitScript(PROBE, INTERNAL_VISITOR_ID)
  // 429 = 额度烧光 → 地标/区域图层不上图 → 这一轮的数字不能信。必须响亮地喊出来。
  let quota429 = 0
  page.on('response', (r) => {
    if (r.status() === 429) quota429++
  })
  if (DIST) await serveDist(page, DIST)
  const cdp = await ctx.newCDPSession(page)
  if (vp.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: vp.cpu })

  console.log(`\n===== ${vp.name} ${vp.width}×${vp.height} dpr${vp.dpr} cpu×${vp.cpu} · run ${vp.run}/${RUNS} =====`)
  console.log(`  ${TOUR_URL}`)
  await page.goto(TOUR_URL, { waitUntil: 'domcontentloaded', timeout: 90000 })

  // wait for the greeting start button (the tour payload + map are ready by then)
  const start = page.locator('.lt-greet-btn')
  try {
    await start.waitFor({ state: 'visible', timeout: 60000 })
  } catch {
    console.log('  ✖ 欢迎页没出来 —— 页面没加载出 tour（检查 URL / 网络）')
    await page.screenshot({ path: `${OUT}/${vp.name}-FAIL.png` })
    await browser.close()
    continue
  }
  await page.waitForTimeout(2500) // let tiles settle so we measure motion, not first paint
  await start.click()
  if (SKIP) await page.waitForTimeout(SKIP * 1000)
  await page.evaluate(() => {
    const w = window
    w.__jit.frames.length = 0
    w.__jit.long.length = 0
    w.__jit.started = 1
  })

  // record, screenshotting a few beats so I can eyeball the framing too
  const shotsAt = [1, Math.round(SECS * 0.25), Math.round(SECS * 0.5), Math.round(SECS * 0.8)]
  for (let s = 1; s <= SECS; s++) {
    await page.waitForTimeout(1000)
    if (shotsAt.includes(s)) {
      await page.screenshot({ path: `${OUT}/${vp.name}-${String(s).padStart(2, '0')}s.png` })
    }
  }

  // 地标/区域图层在不在？跑分只在「和客户看到的同一张地图」上才有意义。
  const layers = await page.evaluate(() => {
    const m = window.__pinzosMap
    const n = (id) => {
      try {
        return m.queryRenderedFeatures({ layers: [id] }).length
      } catch {
        return -1
      }
    }
    return { pins: n('lt-props-sym'), landmarks: n('host-landmarks-sym'), areas: n('area-fills') }
  })

  const raw = await page.evaluate(() => ({ frames: window.__jit.frames, long: window.__jit.long }))
  const m = analyse(raw.frames, vp.width)
  m.quota429 = quota429
  m.layers = layers
  m.longtask_count = raw.long.length
  m.longtask_ms_total = raw.long.reduce((a, b) => a + b, 0)
  m.longtask_ms_max = raw.long.length ? Math.max(...raw.long) : 0
  m.longtask_ms_per_sec = +(m.longtask_ms_total / Math.max(1, m.seconds)).toFixed(0)
  ;(report[vp.name] ??= []).push(m)

  console.log(`  帧:      ${m.frames} 帧 / ${m.seconds}s  →  ${m.fps} fps`)
  console.log(`  帧间隔:  p50 ${m.dt_p50}ms · p95 ${m.dt_p95}ms · max ${m.dt_max}ms · >33ms ${m.long_frames_pct}%`)
  console.log(
    `  画面移动:  ${m.move_hz}Hz(每 ${m.move_p50}ms 动一次) · p95 ${m.move_p95}ms · max ${m.move_max}ms · ` +
      `匀速度 ${m.move_unevenness} ${m.move_unevenness > 2 ? '❌ 忱快忽慢=抖' : m.move_unevenness > 1.6 ? '⚠️' : '✅'}`
  )
  console.log(`  长帧占比 >33ms = ${m.long_frames_pct}%  (不均匀度 p95/p50 = ${m.dt_jitter}) ${m.long_frames_pct > 60 ? '❌ 一路在掉帧' : m.long_frames_pct > 30 ? '⚠️' : '✅'}`)
  console.log(`  每帧位移: p50 ${m.px_p50}px · p95 ${m.px_p95}px · max ${m.px_max}px ${m.px_max > 60 ? '❌ 单帧跳太远' : ''}`)
  console.log(`  方向反转: ${m.rev_per_sec}/s  (zoom ${m.rev.zoom} · bearing ${m.rev.bearing} · lng ${m.rev.lng}) ${m.rev_per_sec > 2 ? '❌ 真·振动' : '✅'}`)
  console.log(`  long task: ${m.longtask_count} 个 · 合计 ${m.longtask_ms_total}ms · 最长 ${m.longtask_ms_max}ms · ${m.longtask_ms_per_sec}ms/s ${m.longtask_ms_per_sec > 150 ? '❌ 主线程被偷' : ''}`)
  console.log(`  图层:    pin ${layers.pins} · 地标 ${layers.landmarks} · 区域 ${layers.areas}`)
  if (quota429) {
    console.log(
      `  ⛔ ${quota429} 个 429(地图额度用尽)—— **这一轮的数字不能用**:地标/区域没上图,` +
        `页面比客户看到的轻。换个 --visitor=<内部 visitor_id>，或等迪拜时间过零点。`
    )
  }
  fs.writeFileSync(`${OUT}/${vp.name}-frames.json`, JSON.stringify(raw.frames))
  await browser.close()
}

fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2))
if (RUNS > 1) {
  console.log(`
══════ 中位数（${RUNS} 轮）══════`)
  for (const [name, runs] of Object.entries(report)) {
    console.log(
      `  ${name.padEnd(8)} fps ${median(runs.map((r) => r.fps))}` +
        ` · >33ms ${median(runs.map((r) => r.long_frames_pct))}%` +
        ` · 单帧最大 ${median(runs.map((r) => r.px_max))}px` +
        ` · 移动 ${median(runs.map((r) => r.move_hz))}Hz 匀速度 ${median(runs.map((r) => r.move_unevenness))}` +
        ` · longtask ${median(runs.map((r) => r.longtask_ms_per_sec))}ms/s`
    )
  }
}
console.log(`\n📊 ${OUT}/report.json  ·  截图 ${OUT}/*.png`)
