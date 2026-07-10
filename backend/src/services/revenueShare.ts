/**
 * 分成对账 — FINDHOMEGO 25% / 运营方 75%(合伙协议 2026-06-30)。
 *
 * 口径:按 Stripe 实收净额结算 = 客户付款 − 退款 − Stripe 手续费(即 balance
 * transaction 的 net 之和,排除 payout/transfer 等资金搬运类型)。月份按迪拜时区
 * (UTC+4,无夏令时)切分。真相源 = Stripe;revenue_settlements 表只记录
 * 「某月已线下转账结算」的快照,防止事后 Stripe 数据变动(退款/争议)引发扯皮。
 *
 * 分成比例默认 25%,可用 FINDHOMEGO_SHARE_RATE 覆盖(0-1 小数)。
 */
import Stripe from 'stripe'
import pool from '../db/pool'

const SHARE_RATE = Math.min(1, Math.max(0, Number(process.env.FINDHOMEGO_SHARE_RATE) || 0.25))

let _stripe: Stripe | null = null
function getStripe(): Stripe | null {
  if (_stripe) return _stripe
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return null
  _stripe = new Stripe(key)
  return _stripe
}

// 资金搬运/非收入类型 — 不计入收入(payout=打款到银行,transfer=Connect 转账,topup=充值)。
const NON_REVENUE_TYPES = new Set([
  'payout', 'payout_cancel', 'payout_failure', 'payout_minimum_balance_hold', 'payout_minimum_balance_release',
  'transfer', 'transfer_cancel', 'transfer_failure', 'transfer_refund',
  'topup', 'topup_reversal',
])

const REFUND_TYPES = new Set(['refund', 'payment_refund', 'payment_failure_refund', 'refund_failure'])

export interface MonthShare {
  month: string          // 'YYYY-MM'(迪拜时区)
  currency: string       // 'usd' 等(小写)
  txn_count: number
  gross_cents: number    // 客户付款总额(charge/payment 的 amount 和)
  refund_cents: number   // 退款总额(正数)
  fee_cents: number      // Stripe 手续费总额
  net_cents: number      // 实收净额(balance txn net 之和)
  share_findhomego_cents: number
  share_operator_cents: number
  current: boolean       // 是否为进行中的当月(数字未完结)
  settlement: {
    settled_at: string
    settled_by: string | null
    note: string | null
    net_cents: number    // 结算时的快照(可能与最新 Stripe 数字有差,差异即事后退款)
    share_findhomego_cents: number
  } | null
}

export interface RevenueShareData {
  configured: boolean    // STRIPE_SECRET_KEY 是否已配置
  livemode: boolean | null
  share_rate: number
  months: MonthShare[]
}

/** 迪拜时区(UTC+4 固定)把 unix 秒落到 'YYYY-MM'。 */
function dubaiMonth(unixSeconds: number): string {
  const d = new Date((unixSeconds + 4 * 3600) * 1000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** 迪拜时区下,往前第 n 个月的月初对应的 unix 秒(n=0 即本月初)。 */
function dubaiMonthStart(monthsAgo: number): number {
  const now = new Date(Date.now() + 4 * 3600 * 1000)
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 1)
  return Math.floor(start / 1000) - 4 * 3600
}

// Stripe 全量翻页不便宜 — 5 分钟内存缓存;结算动作后主动失效。
let cache: { at: number; months: number; data: RevenueShareData } | null = null
function bustCache() { cache = null }

async function aggregateFromStripe(monthsBack: number): Promise<RevenueShareData> {
  const stripe = getStripe()
  if (!stripe) return { configured: false, livemode: null, share_rate: SHARE_RATE, months: [] }

  const gte = dubaiMonthStart(monthsBack - 1)
  const buckets = new Map<string, MonthShare>() // key = month|currency
  let livemode: boolean | null = null

  for await (const bt of stripe.balanceTransactions.list({ created: { gte }, limit: 100 })) {
    if (NON_REVENUE_TYPES.has(bt.type)) continue
    if (livemode === null) livemode = !!(bt as unknown as { livemode?: boolean }).livemode
    const month = dubaiMonth(bt.created)
    const key = `${month}|${bt.currency}`
    let b = buckets.get(key)
    if (!b) {
      b = {
        month, currency: bt.currency, txn_count: 0, gross_cents: 0, refund_cents: 0,
        fee_cents: 0, net_cents: 0, share_findhomego_cents: 0, share_operator_cents: 0,
        current: false, settlement: null,
      }
      buckets.set(key, b)
    }
    b.txn_count += 1
    b.net_cents += bt.net
    b.fee_cents += bt.fee
    if (REFUND_TYPES.has(bt.type)) b.refund_cents += -bt.amount
    else if (bt.amount > 0) b.gross_cents += bt.amount
  }

  const currentMonth = dubaiMonth(Math.floor(Date.now() / 1000))
  const months = [...buckets.values()]
    .sort((a, b) => b.month.localeCompare(a.month) || a.currency.localeCompare(b.currency))
  for (const m of months) {
    m.share_findhomego_cents = Math.round(m.net_cents * SHARE_RATE)
    m.share_operator_cents = m.net_cents - m.share_findhomego_cents
    m.current = m.month === currentMonth
  }
  return { configured: true, livemode, share_rate: SHARE_RATE, months }
}

export async function getRevenueShare(monthsBack = 12): Promise<RevenueShareData> {
  let data: RevenueShareData
  if (cache && cache.months >= monthsBack && Date.now() - cache.at < 5 * 60_000) {
    data = cache.data
  } else {
    data = await aggregateFromStripe(monthsBack)
    if (data.configured) cache = { at: Date.now(), months: monthsBack, data }
  }

  // 结算记录挂回各月(独立查询,保证缓存的 Stripe 数字也能看到最新结算状态)。
  const { rows } = await pool.query<{
    month: string; currency: string; net_cents: string; share_findhomego_cents: string
    settled_at: string; settled_by: string | null; note: string | null
  }>(`SELECT month, currency, net_cents, share_findhomego_cents, settled_at, settled_by, note
        FROM revenue_settlements`)
  const settled = new Map(rows.map((r) => [`${r.month}|${r.currency}`, r]))
  const months = data.months.map((m) => {
    const s = settled.get(`${m.month}|${m.currency}`)
    return {
      ...m,
      settlement: s ? {
        settled_at: s.settled_at, settled_by: s.settled_by, note: s.note,
        net_cents: Number(s.net_cents), share_findhomego_cents: Number(s.share_findhomego_cents),
      } : null,
    }
  })
  return { ...data, months }
}

/** 标记某月已结算 — 用「结算那一刻」的 Stripe 数字做快照落库。 */
export async function settleMonth(
  month: string, currency: string, by: string | null, note: string | null
): Promise<MonthShare> {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('bad month')
  bustCache()
  const data = await getRevenueShare(24)
  // livemode 守卫:测试模式的数字不能被锁成结算快照写进账本(切 Live 后会污染对账)。
  if (data.livemode === false) throw new Error('Stripe 测试模式数据不可结算')
  const m = data.months.find((x) => x.month === month && x.currency === currency.toLowerCase())
  if (!m) throw new Error('month not found in Stripe data')
  await pool.query(
    `INSERT INTO revenue_settlements (month, currency, net_cents, share_findhomego_cents, share_operator_cents, share_rate, settled_by, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (month, currency) DO UPDATE SET
       net_cents = EXCLUDED.net_cents,
       share_findhomego_cents = EXCLUDED.share_findhomego_cents,
       share_operator_cents = EXCLUDED.share_operator_cents,
       share_rate = EXCLUDED.share_rate,
       settled_at = now(), settled_by = EXCLUDED.settled_by, note = EXCLUDED.note`,
    [month, currency.toLowerCase(), m.net_cents, m.share_findhomego_cents, m.share_operator_cents, data.share_rate, by, note]
  )
  const fresh = await getRevenueShare(24)
  return fresh.months.find((x) => x.month === month && x.currency === currency.toLowerCase())!
}

/** 撤销结算标记(转错/误点)。 */
export async function unsettleMonth(month: string, currency: string): Promise<void> {
  await pool.query(`DELETE FROM revenue_settlements WHERE month = $1 AND currency = $2`, [month, currency.toLowerCase()])
}
