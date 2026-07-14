/**
 * telemetry/runtime — 进程级指标。**容量预警的唯一信号源。**
 *
 * 为什么重要(2026-07-13 压测的硬数字):后端是**单进程单线程**(没有 cluster/
 * worker_threads),cpx11 那 2 个 vCPU 里**只有 1 个**在跑所有 API + WebSocket。
 * 实测(已按生产 CPU 慢 1.56× 折算):
 *
 *   |  同时在线 |  场次  |  出站 msg/s |  单核占用 |
 *   |    100   |   25  |    1,200   |   ~10%   |
 *   |    500   |  125  |    6,100   |   ~72%   |
 *   |   1000   |  250  |   13,000   |  ~105% ← 打满,开始积压 |
 *
 * 加核**没用**(单线程用不上);内存完全不是瓶颈(1000 连接才 130MB)。
 * 所以要盯的是这三个:CPU%、event-loop lag、RSS。
 *
 * **event-loop lag 是单线程架构最诚实的健康指标** —— 它一涨,所有请求
 * (不只是带看)都在排队。CPU 还没到 100% 时它就会先动。
 */
import { gauge, histogram } from './metrics'

let lastCpu = process.cpuUsage()
let lastAt = Date.now()
let cpuPct = 0

/** 事件循环滞后:定时器本该 500ms 后触发,实际晚了多久 = 循环被堵了多久。 */
let loopLagMs = 0
const LOOP_PROBE_MS = 500

let started = false

export function startRuntimeMetrics(): void {
  if (started) return
  started = true

  // CPU:进程消耗的 CPU 时间 / 墙钟时间。100% = 一个核吃满。
  setInterval(() => {
    try {
      const cpu = process.cpuUsage(lastCpu)
      const dt = Date.now() - lastAt
      lastCpu = process.cpuUsage()
      lastAt = Date.now()
      if (dt > 0) cpuPct = Math.round(((cpu.user + cpu.system) / 1000 / dt) * 100)
    } catch { /* noop */ }
  }, 5000).unref?.()

  // event-loop lag
  let expected = Date.now() + LOOP_PROBE_MS
  setInterval(() => {
    try {
      const now = Date.now()
      loopLagMs = Math.max(0, now - expected)
      expected = now + LOOP_PROBE_MS
      histogram('runtime.loop_lag.ms').observe(loopLagMs)
    } catch { /* noop */ }
  }, LOOP_PROBE_MS).unref?.()

  gauge('runtime.cpu.pct', () => cpuPct)
  gauge('runtime.rss.mb', () => Math.round(process.memoryUsage().rss / 1e6))
  gauge('runtime.loop_lag.ms', () => loopLagMs)
}

/** 给告警规则和 Admin 用的即时读数。 */
export function runtimeSnapshot(): { cpuPct: number; rssMb: number; loopLagMs: number } {
  return {
    cpuPct,
    rssMb: Math.round(process.memoryUsage().rss / 1e6),
    loopLagMs,
  }
}
