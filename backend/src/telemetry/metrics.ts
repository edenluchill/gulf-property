/**
 * telemetry/metrics — 通用 Counter / Gauge / Histogram 注册表。
 *
 * WHY 独立于 perfSink:perfSink 的字段是**写死给 HTTP 的**(req/err4/err5/query/
 * slowQuery)。每来一个新功能就往里加几个字段 → 越堆越脏,而且别的 feature 根本
 * 没法复用。这里只认「名字 + label + 值」,任何 feature 三行接入,不用建表、不用
 * 改 flush、不用写 SQL。
 *
 * 三条铁律(照抄 perfSink 的血泪教训,见 docs/telemetry-spec.md):
 *   1. **零依赖** —— 不 import pool,不 import 任何业务模块。否则 pool ↔ monitor
 *      循环依赖,且遥测一崩就把请求路径带崩。
 *   2. **内存有界** —— 指标名、label 组合、直方图样本全部有上限。一个写错的 label
 *      (比如把 userId 当 label)不能把进程撑爆。
 *   3. **绝不抛错** —— 公开函数内部吞掉一切。**遥测挂了业务必须照跑。**
 *
 * 模型:每个 (name, labels) 是一条 series。counter 累加、gauge 存 pull 函数、
 * histogram 存有界样本。flush 每 60s 抽干一次(drain),抽完 counter/histogram 归零,
 * gauge 现场求值。
 */

// ── 有界性上限(超了就丢弃新的,老的照常工作 —— 宁可少记,不可炸内存)──────
const MAX_SERIES = 500        // 不同 (name+labels) 组合总数。真实面 ~40
const MAX_HIST_SAMPLES = 2000 // 单条 histogram series 每个 flush 周期的样本上限

export type Labels = Record<string, string | number>
export type Kind = 'counter' | 'gauge' | 'histogram'

interface Series {
  name: string
  labels: Labels
  kind: Kind
  count: number        // counter: 累加值;histogram: 样本数
  sum: number
  min: number
  max: number
  samples: number[]    // histogram only(有界)
  read?: () => number  // gauge only(pull 式)
}

const series = new Map<string, Series>()
let dropped = 0        // 因为超上限被丢掉的 series 数(自我监控:它自己也是个指标)

/** 稳定的 series key —— label 顺序不能影响身份,否则同一条会裂成两条。 */
function keyOf(name: string, labels: Labels): string {
  const ks = Object.keys(labels).sort()
  if (ks.length === 0) return name
  return name + '{' + ks.map((k) => `${k}=${labels[k]}`).join(',') + '}'
}

function get(name: string, labels: Labels, kind: Kind): Series | null {
  const key = keyOf(name, labels)
  let s = series.get(key)
  if (s) return s
  if (series.size >= MAX_SERIES) { dropped++; return null }   // 基数护栏
  s = { name, labels, kind, count: 0, sum: 0, min: Infinity, max: -Infinity, samples: [] }
  series.set(key, s)
  return s
}

// ── 公开 API ──────────────────────────────────────────────────────────────

export interface Counter { inc(n?: number): void }
export interface Histogram { observe(v: number): void }

/** 计数器:发生了多少次。`counter('collab.ws.connect').inc()` */
export function counter(name: string, labels: Labels = {}): Counter {
  return {
    inc(n = 1) {
      try {
        const s = get(name, labels, 'counter')
        if (s) s.count += n
      } catch { /* 遥测绝不影响业务 */ }
    },
  }
}

/**
 * 瞬时值:**pull 式** —— 传一个读函数,flush 时才求值。
 * 调用方不用自己维护定时器,也不会因为忘记更新而读到陈旧值。
 * 同名重复注册 = 覆盖读函数(热重载/重复 init 安全)。
 */
export function gauge(name: string, read: () => number, labels: Labels = {}): void {
  try {
    const s = get(name, labels, 'gauge')
    if (s) { s.kind = 'gauge'; s.read = read }
  } catch { /* noop */ }
}

/** 分布:耗时 / 大小。`histogram('collab.fanout.ms').observe(ms)` */
export function histogram(name: string, labels: Labels = {}): Histogram {
  return {
    observe(v: number) {
      try {
        if (!Number.isFinite(v)) return
        const s = get(name, labels, 'histogram')
        if (!s) return
        s.count++
        s.sum += v
        if (v < s.min) s.min = v
        if (v > s.max) s.max = v
        if (s.samples.length < MAX_HIST_SAMPLES) s.samples.push(v)   // 样本护栏
      } catch { /* noop */ }
    },
  }
}

// ── flush 侧 ──────────────────────────────────────────────────────────────

export interface Snapshot {
  name: string
  labels: Labels
  kind: Kind
  count: number | null
  value: number | null   // gauge
  sum: number | null
  min: number | null
  max: number | null
  p50: number | null
  p95: number | null
}

function pct(sorted: number[], p: number): number {
  if (!sorted.length) return 0
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}

/**
 * 抽干:返回这一周期的快照,counter/histogram 归零(gauge 是 pull 的,不需要归零)。
 * 没有任何数据的 series 直接跳过 —— 不往库里灌一堆 0。
 */
export function drain(): Snapshot[] {
  const out: Snapshot[] = []
  for (const s of series.values()) {
    try {
      if (s.kind === 'gauge') {
        const v = s.read ? s.read() : 0
        if (!Number.isFinite(v)) continue
        out.push({ name: s.name, labels: s.labels, kind: 'gauge', count: null, value: v, sum: null, min: null, max: null, p50: null, p95: null })
        continue
      }
      if (s.count === 0) continue    // 这一分钟没发生 → 不记
      if (s.kind === 'counter') {
        out.push({ name: s.name, labels: s.labels, kind: 'counter', count: s.count, value: null, sum: null, min: null, max: null, p50: null, p95: null })
      } else {
        const sorted = [...s.samples].sort((a, b) => a - b)
        out.push({
          name: s.name, labels: s.labels, kind: 'histogram',
          count: s.count, value: null, sum: s.sum,
          min: Number.isFinite(s.min) ? s.min : null,
          max: Number.isFinite(s.max) ? s.max : null,
          p50: pct(sorted, 50), p95: pct(sorted, 95),
        })
      }
      // 归零(gauge 不走这里)
      s.count = 0; s.sum = 0; s.min = Infinity; s.max = -Infinity; s.samples.length = 0
    } catch { /* 单条坏了不影响其它 */ }
  }
  if (dropped > 0) {
    // 自我监控:基数护栏一旦生效,必须让人看见(否则指标"莫名其妙少了"永远查不出)
    out.push({ name: 'telemetry.series.dropped', labels: {}, kind: 'counter', count: dropped, value: null, sum: null, min: null, max: null, p50: null, p95: null })
    dropped = 0
  }
  return out
}

/** 当前值(不归零)—— 给告警规则和 Admin 实时读数用。 */
export function peek(): Snapshot[] {
  const out: Snapshot[] = []
  for (const s of series.values()) {
    try {
      if (s.kind === 'gauge') {
        const v = s.read ? s.read() : 0
        out.push({ name: s.name, labels: s.labels, kind: 'gauge', count: null, value: v, sum: null, min: null, max: null, p50: null, p95: null })
      } else if (s.count > 0) {
        const sorted = [...s.samples].sort((a, b) => a - b)
        out.push({
          name: s.name, labels: s.labels, kind: s.kind,
          count: s.count, value: null, sum: s.sum,
          min: Number.isFinite(s.min) ? s.min : null,
          max: Number.isFinite(s.max) ? s.max : null,
          p50: pct(sorted, 50), p95: pct(sorted, 95),
        })
      }
    } catch { /* noop */ }
  }
  return out
}

/** 测试用:清空注册表。 */
export function __reset(): void {
  series.clear()
  dropped = 0
}

/** 测试/自检用:当前 series 数量(基数护栏的可见性)。 */
export function seriesCount(): number {
  return series.size
}
