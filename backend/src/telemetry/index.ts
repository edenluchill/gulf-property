/**
 * telemetry — 埋点的公共入口。**这个文件本身零依赖**(不碰 DB、不碰 express)。
 *
 * ⚠️ 刻意不从这里 re-export flush/alerts:它们 import pool。一旦 re-export,
 * 任何引了 `../telemetry` 的「纯逻辑层」(比如 collab-rooms)就被间接拖进 DB 依赖,
 * 而且会重蹈 pool ↔ monitor 的循环依赖。**启动逻辑在 telemetry/start.ts。**
 *
 * 加埋点(三行,不用建表、不用改 flush、不用写 SQL):
 *
 *   import { counter, gauge, histogram } from '../telemetry'
 *
 *   counter('myfeature.thing.done').inc()
 *   counter('myfeature.thing.failed', { reason: 'timeout' }).inc()   // label 只放低基数枚举
 *   gauge('myfeature.queue.depth', () => queue.length)               // pull 式,flush 时才求值
 *   histogram('myfeature.render.ms').observe(ms)
 *
 * 命名:`feature.thing.unit`(点分层级)。
 * label **绝不放 userId / roomId / email** —— 基数会炸(护栏会开始丢数据,
 * 并把 telemetry.series.dropped 报出来)。
 *
 * 加漏斗:在 funnel.ts 里声明步骤(顺序 + 白名单),然后 `myFunnel.step('xxx')`。
 * 加告警:在 start.ts 的 registerAlerts() 里 defineAlert({...})。
 *
 * 全部细节见 docs/telemetry-spec.md。
 */
export { counter, gauge, histogram, peek, seriesCount, type Labels, type Snapshot } from './metrics'
export { funnel, collabJoin, COLLAB_JOIN_STEPS, type Funnel } from './funnel'
export { runtimeSnapshot } from './runtime'
