/**
 * 引擎回归测试。这一页的输出看起来很权威,所以数学部分必须有对照组 ——
 * IRR 算错不会报错,只会安静地给出一个可信的错数字。
 */
import { describe, it, expect } from 'vitest'
import { simulate, irr, pmt, pvOf, betaFromMean, type SimParams } from '../simulate'

const base: SimParams = {
  price: 1_500_000,
  downPct: 25,
  ratePct: 4.5,
  loanYears: 25,
  holdYears: 7,
  growthMeanPct: 3,
  growthSdPct: 8,
  yieldMinPct: 4.5,
  yieldModePct: 6,
  yieldMaxPct: 7.5,
  vacancyAlpha: 2,
  vacancyBeta: 23,
  maintenancePct: 1.5,
  runs: 2000,
  seed: 42,
}

describe('pmt / pvOf', () => {
  it('等额本息月供对得上教科书值', () => {
    // 1,125,000 @ 4.5%/25y → ~6,253/月
    expect(pmt(0.045 / 12, 300, 1_125_000)).toBeCloseTo(6253, 0)
  })
  it('剩余本金 = 剩余月供现值;还满期为 0', () => {
    const m = pmt(0.045 / 12, 300, 1_125_000)
    expect(pvOf(0.045 / 12, 300, m)).toBeCloseTo(1_125_000, 0)
    expect(pvOf(0.045 / 12, 0, m)).toBe(0)
  })
  it('零利率退化成等分,不产生 NaN', () => {
    expect(pmt(0, 120, 1200)).toBe(10)
    expect(pvOf(0, 120, 10)).toBe(1200)
  })
})

describe('irr', () => {
  it('翻倍现金流:-100 → 0 → 121,IRR = 10%', () => {
    const cf = new Float64Array([-100, 0, 121])
    expect(irr(cf, 2)).toBeCloseTo(0.1, 4)
  })
  it('全负现金流没有变号区间 → NaN(调用方剔除,不能当 0 用)', () => {
    const cf = new Float64Array([-100, -10, -10])
    expect(Number.isNaN(irr(cf, 2))).toBe(true)
  })
})

describe('betaFromMean', () => {
  it('α/(α+β) 就是给定的均值', () => {
    const { alpha, beta } = betaFromMean(8)
    expect(alpha / (alpha + beta)).toBeCloseTo(0.08, 3)
  })
})

describe('simulate', () => {
  it('同种子 → 完全相同的结果(否则用户动无关滑块图也会抖)', () => {
    const a = simulate(base)
    const b = simulate(base)
    expect(a.median).toBe(b.median)
    expect(a.pLoss).toBe(b.pLoss)
  })

  it('分位数单调递增,中位数落在 P25/P75 之间', () => {
    const r = simulate(base)
    const ps = [5, 10, 25, 50, 75, 90, 95].map((p) => r.percentiles[p])
    for (let i = 1; i < ps.length; i++) expect(ps[i]).toBeGreaterThanOrEqual(ps[i - 1])
    expect(r.median).toBeGreaterThanOrEqual(r.percentiles[25])
    expect(r.median).toBeLessThanOrEqual(r.percentiles[75])
  })

  it('直方图计数总和 = 有效样本数(尾部归进首尾档,不能丢样本)', () => {
    const r = simulate(base)
    expect(r.hist.reduce((s, b) => s + b.count, 0)).toBe(r.valid)
  })

  it('持有年限档位含用户值,且各档共用抽样(结果稳定可比)', () => {
    const r = simulate({ ...base, holdYears: 7 })
    expect(r.hold.map((h) => h.years)).toEqual([2, 3, 5, 7, 10, 15])
    const r6 = simulate({ ...base, holdYears: 6 })
    expect(r6.hold.map((h) => h.years)).toEqual([2, 3, 5, 6, 7, 10, 15])
    // 6 年那档就是主结果
    expect(r6.hold.find((h) => h.years === 6)!.median).toBeCloseTo(r6.median, 10)
  })

  it('涨幅越高 IRR 中位数越高(方向必须对)', () => {
    const low = simulate({ ...base, growthMeanPct: 0, growthSdPct: 1 })
    const high = simulate({ ...base, growthMeanPct: 8, growthSdPct: 1 })
    expect(high.median).toBeGreaterThan(low.median)
  })

  it('全款(首付 100%)时 IRR 应低于加杠杆(正杠杆下)', () => {
    const cash = simulate({ ...base, downPct: 100, growthSdPct: 1 })
    const levered = simulate({ ...base, downPct: 25, growthSdPct: 1 })
    expect(levered.median).toBeGreaterThan(cash.median)
  })

  it('散点是 g↔IRR 的真实配对(不是各自排序后拼的)', () => {
    const r = simulate({ ...base, growthSdPct: 10 })
    expect(r.scatter.length).toBeGreaterThan(500)
    // 单调正相关:按 g 排序后,前 20% 的平均 IRR 必须低于后 20%
    const s = [...r.scatter].sort((a, b) => a.g - b.g)
    const k = Math.floor(s.length * 0.2)
    const avg = (arr: typeof s) => arr.reduce((t, p) => t + p.irr, 0) / arr.length
    expect(avg(s.slice(0, k))).toBeLessThan(avg(s.slice(-k)))
  })
})
