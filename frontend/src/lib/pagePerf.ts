/**
 * 页面性能自动上报 —— **通用**,任何页面自动覆盖,不用逐页埋点。
 *
 * 两个数字,都是 2026-07-13「半分钟延迟」查出来的真凶:
 *   - DOMContentLoaded:弱网实测 **7.8s**(客户点开链接后盯着白屏的时间)
 *   - 地图瓦片字节:首屏 **4.8MB / 59 个请求**(其中 39 个是 Esri 卫星图)
 *
 * 用 PerformanceObserver 读浏览器**自己记录的**资源计时,不用手动拦 fetch ——
 * 拦 fetch 拦不到 maplibre 内部发的瓦片请求(它走的是 Image/XHR)。
 *
 * 在 main.tsx 里调一次 startPagePerf() 就行。
 */
import { reportMetric, netLabel } from './telemetry'

/** 瓦片请求的判定 —— Esri 卫星图 + 本地矢量瓦片。 */
function isTile(url: string): boolean {
  return /arcgisonline|\/tiles?\//i.test(url) || /\.(pbf|mvt)(\?|$)/i.test(url)
}

let started = false

export function startPagePerf(): void {
  if (started || typeof window === 'undefined') return
  started = true

  const net = netLabel()

  // ── DOMContentLoaded ──────────────────────────────────────────────────
  const reportNav = () => {
    try {
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
      if (nav?.domContentLoadedEventEnd) {
        reportMetric('rum.page.dcl.ms', nav.domContentLoadedEventEnd, { net })
      }
    } catch { /* 静默 */ }
  }
  if (document.readyState === 'complete') reportNav()
  else window.addEventListener('load', reportNav, { once: true })

  // ── 瓦片字节 ──────────────────────────────────────────────────────────
  // 攒 10 秒的窗口再报一次总量 —— 首屏那一批就在这个窗口里,后续平移产生的
  // 瓦片不该混进"首屏成本"。
  let tileBytes = 0
  let reported = false
  try {
    const obs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        const r = e as PerformanceResourceTiming
        if (!isTile(r.name)) continue
        // transferSize=0 = 命中缓存(不花流量),encodedBodySize 是真实字节
        tileBytes += r.transferSize || r.encodedBodySize || 0
      }
    })
    obs.observe({ type: 'resource', buffered: true })

    const finish = () => {
      if (reported) return
      reported = true
      try { obs.disconnect() } catch { /* noop */ }
      if (tileBytes > 0) reportMetric('rum.collab.tiles.bytes', tileBytes, { net })
    }
    setTimeout(finish, 10_000)
    window.addEventListener('pagehide', finish)   // 提前离开也要拿到数
  } catch { /* PerformanceObserver 不支持 → 算了,静默 */ }
}
