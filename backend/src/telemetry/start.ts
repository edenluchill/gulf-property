/**
 * telemetry/start — 启动遥测(采集 + 落库 + 告警注册)。**只有 app 的 index.ts 引它。**
 *
 * 和 telemetry/index.ts 分开的理由:这里 import pool(flush/alerts 要写库),
 * 而埋点入口必须保持零依赖 —— 否则「纯逻辑层」(collab-rooms)引个 counter 就被
 * 拖进 DB 依赖,还会重蹈 pool ↔ monitor 的循环依赖。
 */
import { defineAlert } from './alerts'
import { startRuntimeMetrics, runtimeSnapshot } from './runtime'
import { startTelemetryFlusher } from './flush'

export { flushNow } from './flush'
export { evaluateAlerts, defineAlert } from './alerts'

/**
 * 容量告警 —— 阈值来自 2026-07-13 的真实压测(已按生产 CPU 慢 1.56× 折算)。
 *
 * 后端是**单进程单线程**:cpx11 的 2 个 vCPU 只有 1 个在跑所有 API + WebSocket。
 *
 *   同时在线 100 人(25 场)→ 单核 ~10%
 *   同时在线 500 人(125 场)→ 单核 ~72%
 *   同时在线 1000 人(250 场)→ 单核 ~105%  ← 打满,开始积压
 *
 * **加核没用**(单线程用不上)。先降 cam 频率(20Hz→10Hz,容量直接翻倍),
 * 再考虑 cluster + Redis 共享房间状态(现在房间存在进程内存里,多进程会让
 * 经纪连进程 A、客户连进程 B,两人互相看不见)。
 */
function registerAlerts(): void {
  defineAlert({
    kind: 'CAPACITY_CPU',
    severity: 'warn',
    threshold: 75,
    read: () => runtimeSnapshot().cpuPct,
    breach: (v) => v > 75,
    message: (v) =>
      `单核 CPU ${v}% —— 后端是单进程单线程,100% 就开始积压(压测:1000 人同时带看 ≈ 105%)。` +
      `先把 cam 频率从 20Hz 降到 10Hz(容量翻倍),别急着加核 —— 单线程用不上。`,
    recovered: (v) => `单核 CPU 回落到 ${v}%。`,
  })

  defineAlert({
    kind: 'EVENT_LOOP_LAG',
    severity: 'error',
    threshold: 100,
    read: () => runtimeSnapshot().loopLagMs,
    breach: (v) => v > 100,
    // 单线程架构最诚实的健康指标:它一涨,**所有**接口都在排队,不只是带看。
    message: (v) =>
      `事件循环滞后 ${v}ms —— 主线程被堵住,此刻**所有**接口(不只是带看)都在排队。` +
      `通常是 WS 扇出量太大,或某段同步计算把单核吃满了。`,
    recovered: (v) => `事件循环恢复正常(滞后 ${v}ms)。`,
  })

  defineAlert({
    kind: 'MEMORY_HIGH',
    severity: 'warn',
    threshold: 1500,
    read: () => runtimeSnapshot().rssMb,
    breach: (v) => v > 1500,
    // 参考:1000 条 WS 连接才 130MB。涨到 1.5G 多半是泄漏,不是流量。
    message: (v) => `进程内存 ${v}MB / 共 2GB(参考:1000 条 WS 连接才 130MB —— 到这个数多半是泄漏,不是流量)。`,
    recovered: (v) => `内存回落到 ${v}MB。`,
  })
}

let started = false

/** app 启动时调用一次(生产门内 —— 本地 dev 连的是生产库,后台写库任务不许在本地跑)。 */
export function startTelemetry(): void {
  if (started) return
  started = true
  startRuntimeMetrics()
  registerAlerts()
  startTelemetryFlusher()
}
