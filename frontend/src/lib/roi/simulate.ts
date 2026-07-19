/**
 * 房产投资收益蒙特卡洛引擎 —— 纯函数,零 DOM/React 依赖(所以能整个搬进 Worker)。
 *
 * ⚠️ 这个文件的输出长得非常权威(「IRR 中位数 7.4%,亏钱概率 3%」),而它的可信度
 *    100% 取决于喂进来的先验。先验从哪来、哪些是实测哪些是假设,由 priors.ts 负责
 *    标注,UI 必须原样呈现。见 docs/map-timeline-and-roi-calculator-spec.md §③。
 *    这个项目在 ROI 数字上栽过一次([[luna-tour-audit-2026-07-12]]),别栽第二次。
 *
 * 随机数**带种子**:同一组参数永远得到同一张图。没有种子的话用户每动一次无关的
 * 滑块、图就自己抖一下,看起来像在瞎编。
 */

/** 持有年限敏感性的固定档位。用户自己的 holdYears 会被并进来(去重后排序)。 */
export const HOLD_GRID = [2, 3, 5, 7, 10, 15]

/** 分位数档位(和 UI 表格一一对应)。 */
export const PERCENTILE_POINTS = [5, 10, 25, 50, 75, 90, 95] as const

export interface SimParams {
  /** 购房总价 AED */
  price: number
  /** 首付比例 % */
  downPct: number
  /** 贷款年利率 % */
  ratePct: number
  /** 贷款年限 */
  loanYears: number
  /** 持有年限(主结果口径) */
  holdYears: number
  /** 房价年涨幅 ~ Normal(μ, σ),单位 % */
  growthMeanPct: number
  growthSdPct: number
  /** 租金收益率 ~ Triangular(min, mode, max),单位 %(占房值) */
  yieldMinPct: number
  yieldModePct: number
  yieldMaxPct: number
  /** 空置率 ~ Beta(α, β)。⚠️ 我们没有空置率数据,这两个数永远是假设。 */
  vacancyAlpha: number
  vacancyBeta: number
  /** 年维护/物业费率 %(占房值)。有 service_charge_per_sqft 时是实测值。 */
  maintenancePct: number
  /** 模拟次数 */
  runs: number
  seed?: number
}

export interface HoldPoint {
  years: number
  median: number
  p25: number
  p75: number
  pLoss: number
}

export interface HistBin {
  /** 区间左端(IRR 小数,如 0.072) */
  x0: number
  x1: number
  count: number
}

export interface SimResult {
  runs: number
  /** 有效样本数(找不到 IRR 变号区间的那几次被剔除) */
  valid: number
  mean: number
  median: number
  sd: number
  /** IRR < 0 的比例 */
  pLoss: number
  /** IRR > 10% 的比例 */
  pAbove10: number
  /** { 5: -0.02, 10: 0.01, ... } 单位是小数不是 % */
  percentiles: Record<number, number>
  hold: HoldPoint[]
  /** 60 档直方图 */
  hist: HistBin[]
  /** 累积分布,已按 x 升序,最多 200 点(画 CDF 够了,不必给 10000 点) */
  cdf: { x: number; p: number }[]
  /** 涨幅(小数) vs IRR(小数),最多 2000 点 */
  scatter: { g: number; irr: number }[]
  /** 主口径(用户 holdYears)下的全部 IRR,升序 */
  irrs: number[]
}

// ── 随机数 ──────────────────────────────────────────────────────────────────

/** mulberry32 —— 32bit 种子 PRNG。够快、周期够长、实现只有五行。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 标准正态 —— Box-Muller。两个数生一对,缓存另一半。 */
function makeNormal(rng: () => number): () => number {
  let spare: number | null = null
  return function () {
    if (spare !== null) {
      const s = spare
      spare = null
      return s
    }
    let u = 0
    let v = 0
    // u=0 会让 log(0) 变 -Infinity
    while (u === 0) u = rng()
    while (v === 0) v = rng()
    const r = Math.sqrt(-2 * Math.log(u))
    const th = 2 * Math.PI * v
    spare = r * Math.sin(th)
    return r * Math.cos(th)
  }
}

/** 三角分布。min===max 时退化为常数(否则下面开方会 0/0)。 */
function triangular(rng: () => number, min: number, mode: number, max: number): number {
  if (!(max > min)) return min
  const m = Math.min(Math.max(mode, min), max)
  const u = rng()
  const fc = (m - min) / (max - min)
  if (u < fc) return min + Math.sqrt(u * (max - min) * (m - min))
  return max - Math.sqrt((1 - u) * (max - min) * (max - m))
}

/** Gamma(a, 1) —— Marsaglia–Tsang。a<1 走 boost 递归。 */
function rgamma(rng: () => number, norm: () => number, a: number): number {
  if (a < 1) return rgamma(rng, norm, a + 1) * Math.pow(rng() || 1e-12, 1 / a)
  const d = a - 1 / 3
  const c = 1 / Math.sqrt(9 * d)
  for (;;) {
    let x = 0
    let v = 0
    do {
      x = norm()
      v = 1 + c * x
    } while (v <= 0)
    v = v * v * v
    const u = rng()
    const x2 = x * x
    if (u < 1 - 0.0331 * x2 * x2) return d * v
    if (Math.log(u || 1e-12) < 0.5 * x2 + d * (1 - v + Math.log(v))) return d * v
  }
}

/** Beta(a, b) = X/(X+Y),X~Gamma(a), Y~Gamma(b)。 */
function rbeta(rng: () => number, norm: () => number, a: number, b: number): number {
  const x = rgamma(rng, norm, a)
  const y = rgamma(rng, norm, b)
  const s = x + y
  return s > 0 ? x / s : 0
}

/**
 * 把「平均空置率」翻成 Beta 的 α/β。
 * concentration 越大分布越窄;25 大致对应 ±6pp 的 90% 区间(在 8% 均值附近)。
 * ⚠️ 这是纯假设的形状 —— 我们没有任何空置率观测值可以拟合。
 */
export function betaFromMean(meanPct: number, concentration = 25): { alpha: number; beta: number } {
  const m = Math.min(Math.max(meanPct / 100, 0.001), 0.6)
  return { alpha: Math.max(0.2, m * concentration), beta: Math.max(0.2, (1 - m) * concentration) }
}

// ── 金融 ────────────────────────────────────────────────────────────────────

/** 等额本息月供。 */
export function pmt(rate: number, nper: number, pv: number): number {
  if (nper <= 0) return 0
  if (Math.abs(rate) < 1e-12) return pv / nper
  return (pv * rate) / (1 - Math.pow(1 + rate, -nper))
}

/** 剩余本金 = 剩余月供的现值。 */
export function pvOf(rate: number, nper: number, payment: number): number {
  if (nper <= 0) return 0
  if (Math.abs(rate) < 1e-12) return payment * nper
  return (payment * (1 - Math.pow(1 + rate, -nper))) / rate
}

function npv(cf: Float64Array, n: number, r: number): number {
  let acc = 0
  const f = 1 + r
  let disc = 1
  for (let t = 0; t <= n; t++) {
    acc += cf[t] / disc
    disc *= f
  }
  return acc
}

/**
 * IRR —— 先以 0.05 步长在 [-0.95, 10] 扫描找**第一个变号区间**,再二分 70 次。
 * 找不到变号(现金流全正或全负)返回 NaN,调用方剔除。
 */
export function irr(cf: Float64Array, n: number): number {
  let lo = -0.95
  let fLo = npv(cf, n, lo)
  if (fLo === 0) return lo
  let hi = lo
  let fHi = fLo
  let found = false
  for (let r = lo + 0.05; r <= 10.0001; r += 0.05) {
    const f = npv(cf, n, r)
    if (f === 0) return r
    if ((fLo < 0) !== (f < 0)) {
      hi = r
      fHi = f
      found = true
      break
    }
    lo = r
    fLo = f
  }
  if (!found) return NaN
  for (let i = 0; i < 70; i++) {
    const mid = (lo + hi) / 2
    const fm = npv(cf, n, mid)
    if ((fLo < 0) === (fm < 0)) {
      lo = mid
      fLo = fm
    } else {
      hi = mid
      fHi = fm
    }
  }
  void fHi
  return (lo + hi) / 2
}

// ── 统计 ────────────────────────────────────────────────────────────────────

/** 升序数组的线性插值分位数。 */
function quantile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN
  const i = (sorted.length - 1) * p
  const lo = Math.floor(i)
  const hi = Math.ceil(i)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo)
}

function summarize(values: number[]): { median: number; p25: number; p75: number; pLoss: number } {
  const s = [...values].sort((a, b) => a - b)
  let loss = 0
  for (const v of s) if (v < 0) loss++
  return {
    median: quantile(s, 0.5),
    p25: quantile(s, 0.25),
    p75: quantile(s, 0.75),
    pLoss: s.length ? loss / s.length : 0,
  }
}

// ── 主流程 ──────────────────────────────────────────────────────────────────

export function simulate(p: SimParams): SimResult {
  const runs = Math.max(1, Math.floor(p.runs))
  const rng = mulberry32(p.seed ?? 0xc0ffee)
  const norm = makeNormal(rng)

  const holdYears = Math.max(1, Math.round(p.holdYears))
  // 敏感性图和主结果**共用同一批抽样** —— 否则相邻年限的差异里混着抽样噪声,
  // 曲线会上下乱跳,而那正是这张图唯一要回答的问题(多持一年到底有没有用)。
  const horizons = [...new Set([...HOLD_GRID, holdYears])].filter((h) => h > 0).sort((a, b) => a - b)
  const maxH = horizons[horizons.length - 1]

  const down = p.price * (p.downPct / 100)
  const loan = Math.max(0, p.price - down)
  const mRate = p.ratePct / 100 / 12
  const nper = Math.max(0, Math.round(p.loanYears * 12))
  const monthly = loan > 0 && nper > 0 ? pmt(mRate, nper, loan) : 0
  const annualDebt = monthly * 12

  const gMean = p.growthMeanPct / 100
  const gSd = Math.max(0, p.growthSdPct / 100)
  const maint = p.maintenancePct / 100

  const cf = new Float64Array(maxH + 1)
  const perH: number[][] = horizons.map(() => [])
  const gDraws: number[] = []
  const mainIdx = horizons.indexOf(holdYears)
  const mainIrrs: number[] = []

  for (let i = 0; i < runs; i++) {
    // 涨幅可以是负的(市场会跌),但 -100% 以下没有物理意义
    const g = Math.max(-0.99, gMean + gSd * norm())
    const y = Math.max(0, triangular(rng, p.yieldMinPct / 100, p.yieldModePct / 100, p.yieldMaxPct / 100))
    const v = Math.min(0.99, Math.max(0, rbeta(rng, norm, p.vacancyAlpha, p.vacancyBeta)))
    gDraws.push(g)

    cf[0] = -down
    let val = p.price
    for (let t = 1; t <= maxH; t++) {
      val = val * (1 + g)
      const rent = val * y * (1 - v)
      const upkeep = val * maint
      const debt = t <= p.loanYears ? annualDebt : 0
      cf[t] = rent - upkeep - debt
    }

    let mainR = NaN
    for (let k = 0; k < horizons.length; k++) {
      const H = horizons[k]
      const valH = p.price * Math.pow(1 + g, H)
      const remainMonths = Math.max(0, nper - H * 12)
      const remaining = loan > 0 ? pvOf(mRate, remainMonths, monthly) : 0
      const saved = cf[H]
      cf[H] = saved + valH - remaining // 卖出:房值 − 剩余本金
      const r = irr(cf, H)
      cf[H] = saved // 还原,下一个年限还要用这条流
      if (Number.isFinite(r)) perH[k].push(r)
      if (k === mainIdx) mainR = r
    }
    // 逐次记录主口径 IRR(不能事后从 perH 取最后一个 —— 无解的那几次没入队,
    // 会把散点图的 g↔IRR 配对整体错位)
    mainIrrs.push(mainR)
  }

  const valid = perH[mainIdx]
  const sorted = [...valid].sort((a, b) => a - b)
  const n = sorted.length || 1

  let sum = 0
  let loss = 0
  let above10 = 0
  for (const v of sorted) {
    sum += v
    if (v < 0) loss++
    if (v > 0.1) above10++
  }
  const mean = sum / n
  let ss = 0
  for (const v of sorted) ss += (v - mean) * (v - mean)
  const sd = Math.sqrt(ss / n)

  const percentiles: Record<number, number> = {}
  for (const q of PERCENTILE_POINTS) percentiles[q] = quantile(sorted, q / 100)

  // 直方图 60 档。极端尾巴(<p1 / >p99)会把 60 档压成一根针 —— 按 p1..p99 定边界,
  // 尾部样本归进首尾档,形状才看得见。
  const BINS = 60
  const lo = quantile(sorted, 0.01)
  const hi = quantile(sorted, 0.99)
  const span = hi - lo || 0.01
  const hist: HistBin[] = []
  for (let b = 0; b < BINS; b++) {
    hist.push({ x0: lo + (span * b) / BINS, x1: lo + (span * (b + 1)) / BINS, count: 0 })
  }
  for (const v of sorted) {
    let b = Math.floor(((v - lo) / span) * BINS)
    if (b < 0) b = 0
    if (b >= BINS) b = BINS - 1
    hist[b].count++
  }

  // CDF 降采样到 ≤200 点
  const CDF_POINTS = 200
  const cdf: { x: number; p: number }[] = []
  const step = Math.max(1, Math.floor(sorted.length / CDF_POINTS))
  for (let i = 0; i < sorted.length; i += step) cdf.push({ x: sorted[i], p: (i + 1) / sorted.length })
  if (sorted.length) cdf.push({ x: sorted[sorted.length - 1], p: 1 })

  // 散点 2000 点(等距抽,不重排,保持 g↔irr 配对)
  const SCATTER = 2000
  const scatter: { g: number; irr: number }[] = []
  const sStep = Math.max(1, Math.floor(runs / SCATTER))
  for (let i = 0; i < runs; i += sStep) {
    const r = mainIrrs[i]
    if (Number.isFinite(r)) scatter.push({ g: gDraws[i], irr: r })
  }

  const hold: HoldPoint[] = horizons.map((years, k) => ({ years, ...summarize(perH[k]) }))

  return {
    runs,
    valid: valid.length,
    mean,
    median: quantile(sorted, 0.5),
    sd,
    pLoss: loss / n,
    pAbove10: above10 / n,
    percentiles,
    hold,
    hist,
    cdf,
    scatter,
    irrs: sorted,
  }
}
