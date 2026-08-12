/**
 * 金额格式化 — 按语言习惯紧凑显示
 *
 * 中文用户对 K/M 不直观（10k 还要换算），用 万/亿；
 * 英文用户习惯 K/M。完整金额用千分位（10,000）。
 */

const trimZeros = (s: string) => s.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')

/** 紧凑金额：zh → 185万 / 1.2亿；en → 1.85M / 120M */
export function formatMoneyCompact(v: number, lang: string): string {
  const neg = v < 0 ? '-' : ''
  const abs = Math.abs(v)
  if (lang?.startsWith('zh')) {
    if (abs >= 100_000_000) return neg + trimZeros((abs / 100_000_000).toFixed(2)) + '亿'
    // 100万 以上整数万就够；以下保留一位小数（12.5万）
    if (abs >= 10_000) {
      const wan = abs / 10_000
      return neg + (wan >= 100 ? Math.round(wan).toLocaleString('en-US') : trimZeros(wan.toFixed(1))) + '万'
    }
    return neg + Math.round(abs).toLocaleString('en-US')
  }
  // 十亿级要有自己的档 —— 否则「全市当日成交 12.7 亿」会显示成 `1270M`，
  // 一串数字读不出量级（2026-08-12 每日速报实测）。中文侧本来就有「亿」。
  // 只有汇总类数字会到这个量级，单套房永远到不了，影响面极小。
  if (abs >= 1_000_000_000) return neg + trimZeros((abs / 1_000_000_000).toFixed(2)) + 'B'
  if (abs >= 1_000_000) return neg + trimZeros((abs / 1_000_000).toFixed(abs >= 100_000_000 ? 0 : 1)) + 'M'
  if (abs >= 1_000) return neg + Math.round(abs / 1_000) + 'K'
  return neg + Math.round(abs).toLocaleString('en-US')
}

/** 紧凑计数（成交笔数等）：zh → 1.2万；en → 1.2K */
export function formatCountCompact(v: number, lang: string): string {
  if (lang?.startsWith('zh')) {
    if (v >= 10_000) return trimZeros((v / 10_000).toFixed(1)) + '万'
    return Math.round(v).toLocaleString('en-US')
  }
  if (v >= 1_000) return trimZeros((v / 1_000).toFixed(1)) + 'K'
  return Math.round(v).toLocaleString('en-US')
}

/** 完整金额：千分位，不缩写（10,000） */
export function formatMoneyFull(v: number): string {
  return Math.round(v).toLocaleString('en-US')
}
