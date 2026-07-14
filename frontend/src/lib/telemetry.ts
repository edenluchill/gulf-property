/**
 * 客户端遥测(RUM)—— **通用**上报客户端。任何页面/功能都能用。
 *
 * WHY:2026-07-13「实时带看半分钟延迟」的真凶在**客户端**(首屏 + 4.8MB 卫星瓦片,
 * 弱网 16–20s),而服务端链路完全健康(端到端 161ms)。当时我们对真实客户的设备
 * 一无所知,只能拿 playwright 模拟。现在让真实客户的浏览器把数字直接告诉我们。
 *
 * 用法(三行):
 *   import { reportMetric, reportFunnelStep, mark, measureFrom } from './telemetry'
 *
 *   mark('collab.enter')                                  // 打个时间戳
 *   measureFrom('collab.enter', 'rum.collab.ttfc.ms')     // 到现在多久 → 上报
 *   reportMetric('rum.collab.tiles.bytes', bytes)
 *   reportFunnelStep('collab.join', 'identity_submit')
 *
 * 设计:
 *   - **攒批**再发(200ms 窗口),不为每个指标发一次请求
 *   - 页面隐藏/卸载时用 `sendBeacon` 兜底 —— 否则客户一关页面,数据全丢
 *     (而"关页面就走人"的客户恰恰是我们最想知道为什么的那批)
 *   - 失败**永远静默** —— 埋点绝不能影响用户看房
 *   - 指标名必须在**后端白名单**里(routes/telemetry.ts),否则被丢弃
 */
import { API_BASE_URL } from './config'

const ENDPOINT = `${API_BASE_URL}/api/telemetry/rum`
const BATCH_MS = 200
const MAX_BATCH = 20

interface Item { name: string; value: number; labels?: Record<string, string> }

let queue: Item[] = []
let funnelQueue: { name: string; step: string }[] = []
let timer: ReturnType<typeof setTimeout> | null = null

function payload() {
  const body = {
    metrics: queue.slice(0, MAX_BATCH),
    // 一次只带一个漏斗步骤(后端就这么设计的);多的下一批发
    funnel: funnelQueue.shift(),
  }
  queue = queue.slice(MAX_BATCH)
  return body
}

/** 立即发(页面要走了):sendBeacon 在 unload 期间仍能送达,fetch 不行。 */
function flushNow(): void {
  if (timer) { clearTimeout(timer); timer = null }
  while (queue.length || funnelQueue.length) {
    const body = payload()
    if (!body.metrics.length && !body.funnel) break
    try {
      const blob = new Blob([JSON.stringify(body)], { type: 'application/json' })
      if (!navigator.sendBeacon?.(ENDPOINT, blob)) throw new Error('beacon rejected')
    } catch {
      // beacon 不可用 → 尽力而为地 fetch;失败也静默
      void fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        keepalive: true,
      }).catch(() => {})
    }
  }
}

function schedule(): void {
  if (timer) return
  timer = setTimeout(() => {
    timer = null
    const body = payload()
    if (!body.metrics.length && !body.funnel) return
    void fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {})       // 静默:埋点失败绝不打扰用户
    if (queue.length || funnelQueue.length) schedule()
  }, BATCH_MS)
}

/** 上报一个数值指标。名字必须在后端白名单里。 */
export function reportMetric(name: string, value: number, labels?: Record<string, string>): void {
  try {
    if (!Number.isFinite(value) || value < 0) return
    queue.push({ name, value: Math.round(value), labels })
    schedule()
  } catch { /* 静默 */ }
}

/** 上报漏斗的一步(客户走到哪儿了)。 */
export function reportFunnelStep(name: string, step: string): void {
  try {
    funnelQueue.push({ name, step })
    schedule()
  } catch { /* 静默 */ }
}

// ── 计时小工具 ──────────────────────────────────────────────────────────────
const marks = new Map<string, number>()

/** 打一个时间戳。 */
export function mark(key: string): void {
  marks.set(key, Date.now())
}

/** 从某个时间戳到现在有多久 → 直接上报成指标。返回耗时(ms),没打过戳则返回 null。 */
export function measureFrom(key: string, metric: string, labels?: Record<string, string>): number | null {
  const t0 = marks.get(key)
  if (t0 === undefined) return null
  const ms = Date.now() - t0
  reportMetric(metric, ms, labels)
  return ms
}

/** 当前网络类型 —— 弱网才是真凶,数据必须能按网络分层看。 */
export function netLabel(): string {
  try {
    const c = (navigator as unknown as { connection?: { effectiveType?: string } }).connection
    return c?.effectiveType || 'unknown'
  } catch {
    return 'unknown'
  }
}

// 页面离开时把没发出去的攒批送走 —— 「关了页面就走人」的客户正是最该研究的那批。
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushNow()
  })
  window.addEventListener('pagehide', flushNow)
}
