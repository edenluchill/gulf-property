/**
 * telemetry/start — 启动遥测(采集 + 落库 + 告警注册)。**只有 app 的 index.ts 引它。**
 *
 * 和 telemetry/index.ts 分开的理由:这里 import pool(flush/alerts 要写库),
 * 而埋点入口必须保持零依赖 —— 否则「纯逻辑层」(collab-rooms)引个 counter 就被
 * 拖进 DB 依赖,还会重蹈 pool ↔ monitor 的循环依赖。
 */
import { defineAlert } from './alerts'
import { peek } from './metrics'
import { startRuntimeMetrics, runtimeSnapshot } from './runtime'
import { startTelemetryFlusher } from './flush'
import { startDataFreshnessTelemetry } from './dataFreshness'

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

/**
 * 「事件类」告警 —— 这些**不是状态**,它们发生了就是发生了,不会自己好。
 *
 * 用 peek() 读当前窗口的计数:只要这一分钟内出现过,就开事故。
 * (状态类告警 CPU/内存 会自愈,上面那批;这批不会 —— 见 [[alerts-are-incidents-not-state]]。)
 */
function registerIncidentAlerts(): void {
  const countOf = (name: string): number =>
    peek().filter((s) => s.name === name).reduce((a, s) => a + (s.count ?? 0), 0)

  defineAlert({
    kind: 'BILLING_PAID_NOT_PROVISIONED',
    severity: 'error',
    threshold: 1,
    read: () => countOf('billing.webhook.dropped'),
    breach: (v) => v >= 1,
    // 🔴 全流程最严重的一条:**客户付了钱,订阅没开通,而 webhook 回了 200**,
    // Stripe 认为一切正常、不会重试。之前只有一行 console.warn。
    message: (v) =>
      `🔴 ${v} 笔付款没有开通订阅(webhook 找不到 agent 或 price 映射不到套餐)。` +
      `客户已经付钱了,Stripe 认为成功、不会重试 —— 需要人工去 Stripe 查这笔单并手动开通。`,
  })

  defineAlert({
    kind: 'STRIPE_WEBHOOK_SIG_FAILED',
    severity: 'error',
    threshold: 1,
    read: () => countOf('stripe.webhook.sig_failed'),
    breach: (v) => v >= 1,
    message: (v) => `Stripe webhook 验签失败 ${v} 次 —— 密钥不对/被篡改。此刻所有付款事件都进不来。`,
  })

  defineAlert({
    kind: 'AI_MODEL_GONE',
    severity: 'error',
    threshold: 1,
    read: () => peek()
      .filter((s) => (s.name === 'ai.call.failed' || s.name === 'pdf.ai.exhausted') && s.labels.reason === 'model_gone')
      .reduce((a, s) => a + (s.count ?? 0), 0),
    breach: (v) => v >= 1,
    // 就是这条:2026-07-13 发现 PDF 管线的 project-description-generator 用着一个
    // **已经 404** 的模型(gemini-3-pro-preview),每传一份楼书都在失败,
    // 靠一行 console.warn —— 一直没人发现。有这条告警,当天就会报出来。
    message: (v) =>
      `🔴 AI 模型已失效(404 / no longer supported),${v} 次调用直接挂掉。` +
      `模型被 Google 关停了 —— 跑 scripts/check-gemini-models.ts 看是哪个,改 services/ai/models.ts。`,
  })

  /**
   * AI 花钱**失速**告警。
   *
   * 这条盯的不是「花了多少」而是「花得多快」:一分钟内的 AI 支出超过阈值,
   * 说明有东西在打转 —— 重试风暴、循环调用、或者某个客户在刷。等月底看账单
   * 才发现,钱已经花掉了。
   *
   * 阈值 $0.50/分钟 ≈ $720/月的速率。参照:2026-07 整月 Google Cloud 账单
   * CA$197.80,正常速率远在这之下,所以这个值只会在真出事时响。
   * 用 AI_COST_BUDGET_PER_MIN_USD 可以调。
   */
  const costPerMinLimit = Number(process.env.AI_COST_BUDGET_PER_MIN_USD) || 0.5
  defineAlert({
    kind: 'AI_COST_SPIKE',
    severity: 'warn',
    threshold: costPerMinLimit,
    read: () =>
      Math.round(
        (peek()
          .filter((s) => s.name === 'ai.cost.usd_micro')
          .reduce((a, s) => a + (s.count ?? 0), 0) / 1e6) * 100
      ) / 100,
    breach: (v) => v > costPerMinLimit,
    message: (v) =>
      `AI 这一分钟花了 $${v}(阈值 $${costPerMinLimit}/分钟 ≈ $${Math.round(costPerMinLimit * 60 * 24 * 30)}/月的速率)。` +
      `去 Admin「AI & 管线」看是哪个功能 —— 通常是重试风暴或某个调用在打转,不是流量真涨了。`,
    recovered: (v) => `AI 支出速率回落到 $${v}/分钟。`,
  })

  defineAlert({
    kind: 'AI_EXHAUSTED',
    severity: 'warn',
    threshold: 3,
    read: () => countOf('ai.call.exhausted') + countOf('pdf.ai.exhausted'),
    breach: (v) => v >= 3,
    // 整条模型链(主 + fallback)全挂 = 这个 AI 功能此刻是坏的,客户拿不到东西。
    message: (v) => `${v} 次 AI 调用把整条模型链都试完了还是失败 —— 该功能此刻对客户是坏的(限流?上游挂了?)。`,
  })
}

let started = false

/** app 启动时调用一次(生产门内 —— 本地 dev 连的是生产库,后台写库任务不许在本地跑)。 */
export function startTelemetry(): void {
  if (started) return
  started = true
  startRuntimeMetrics()
  registerAlerts()
  registerIncidentAlerts()
  startDataFreshnessTelemetry() // DLD 断更告警(自带 gauge + 3 条规则)
  startTelemetryFlusher()
}
