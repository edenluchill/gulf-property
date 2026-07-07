/**
 * Admin dashboard — 分成对账 tab.
 *
 * 合伙协议(2026-06-30):FINDHOMEGO 25% / 迪拜运营方 75%,按 Stripe 实收净额
 * (客户付款 − 退款 − Stripe 手续费)逐月分成。真相源 = Stripe;这里给双方一个
 * 同一份数字的对账单:每月转账后点「标记已结算」锁定当时快照,事后 Stripe 数字
 * 再变(退款/争议)会显示差异提醒。双方 admin 都可见。
 */
import { useEffect, useState } from 'react'
import { Loader2, Handshake, Banknote, PiggyBank, CheckCircle2, Undo2, FlaskConical } from 'lucide-react'
import {
  fetchRevenueShare, settleRevenueMonth, unsettleRevenueMonth,
  RevenueShareData, MonthShare,
} from '../../lib/analyticsApi'
import StatCard from './StatCard'

const fmtMoney = (cents: number, currency: string) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100)

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })

const monthLabel = (m: string) => {
  const [y, mo] = m.split('-')
  return `${y} 年 ${Number(mo)} 月`
}

/** One month's settlement row — numbers + settle/unsettle actions. */
function MonthRow({ m, onChanged }: { m: MonthShare; onChanged: () => void }) {
  const [settling, setSettling] = useState(false)  // inline confirm form open
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const doSettle = async () => {
    setBusy(true); setErr('')
    try {
      await settleRevenueMonth(m.month, m.currency, note.trim() || undefined)
      setSettling(false); setNote('')
      onChanged()
    } catch {
      setErr('结算标记失败,请重试')
    } finally {
      setBusy(false)
    }
  }

  const doUnsettle = async () => {
    setBusy(true); setErr('')
    try {
      await unsettleRevenueMonth(m.month, m.currency)
      onChanged()
    } catch {
      setErr('撤销失败,请重试')
    } finally {
      setBusy(false)
    }
  }

  // 结算后 Stripe 数字又变了(事后退款/争议)→ 提醒差额,下月结算时找齐。
  const drift = m.settlement ? m.net_cents - m.settlement.net_cents : 0

  return (
    <div className="border-b border-slate-100 px-4 py-3 last:border-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-800">{monthLabel(m.month)}</span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium uppercase text-slate-500">{m.currency}</span>
            {m.current && (
              <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-600 ring-1 ring-sky-200">进行中</span>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {m.txn_count} 笔 · 收入 {fmtMoney(m.gross_cents, m.currency)}
            {m.refund_cents > 0 && <> · 退款 −{fmtMoney(m.refund_cents, m.currency)}</>}
            {' '}· 手续费 −{fmtMoney(m.fee_cents, m.currency)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm font-bold text-slate-800">{fmtMoney(m.net_cents, m.currency)}</p>
          <p className="text-[11px] text-slate-400">实收净额</p>
        </div>
      </div>

      {/* 25 / 75 split bar */}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-teal-50 px-3 py-2 ring-1 ring-teal-100">
          <p className="text-[11px] font-medium text-teal-700">FINDHOMEGO 25%</p>
          <p className="text-sm font-bold text-teal-800">{fmtMoney(m.share_findhomego_cents, m.currency)}</p>
        </div>
        <div className="rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
          <p className="text-[11px] font-medium text-slate-500">运营方 75%</p>
          <p className="text-sm font-bold text-slate-700">{fmtMoney(m.share_operator_cents, m.currency)}</p>
        </div>
      </div>

      {/* Settlement state / actions */}
      <div className="mt-2">
        {m.settlement ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-600 ring-1 ring-emerald-200">
              <CheckCircle2 className="h-3 w-3" />
              已结算 {fmtDate(m.settlement.settled_at)}
              {m.settlement.settled_by ? ` · ${m.settlement.settled_by.split('@')[0]}` : ''}
            </span>
            {m.settlement.note && <span className="text-[11px] text-slate-400">备注:{m.settlement.note}</span>}
            {drift !== 0 && (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200">
                结算后数字变动 {drift > 0 ? '+' : ''}{fmtMoney(drift, m.currency)}(下月找齐)
              </span>
            )}
            <button
              onClick={doUnsettle}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            >
              <Undo2 className="h-3 w-3" /> 撤销
            </button>
          </div>
        ) : m.current ? (
          <p className="text-[11px] text-slate-400">本月未完结,月底后再结算。</p>
        ) : settling ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="备注(转账参考号,可空)"
              className="h-8 w-56 max-w-full rounded-lg border border-slate-200 px-2 text-xs outline-none focus:border-teal-400"
            />
            <button
              onClick={doSettle}
              disabled={busy}
              className="inline-flex h-8 items-center gap-1 rounded-lg bg-teal-600 px-3 text-xs font-semibold text-white transition-colors hover:bg-teal-700 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
              确认已转账结算
            </button>
            <button onClick={() => setSettling(false)} className="h-8 rounded-lg px-2 text-xs text-slate-400 hover:text-slate-600">
              取消
            </button>
          </div>
        ) : (
          <button
            onClick={() => setSettling(true)}
            className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-700"
          >
            标记已结算
          </button>
        )}
        {err && <p className="mt-1 text-[11px] text-rose-500">{err}</p>}
      </div>
    </div>
  )
}

export default function RevenueShare() {
  const [data, setData] = useState<RevenueShareData | null>(null)
  const [failed, setFailed] = useState(false)

  const load = () => {
    fetchRevenueShare(12)
      .then((d) => { setData(d); setFailed(false) })
      .catch(() => setFailed(true))
  }
  useEffect(load, [])

  if (failed) {
    return <p className="rounded-2xl bg-white p-8 text-center text-sm text-slate-400 shadow-sm ring-1 ring-slate-900/[0.06]">分成数据加载失败,刷新重试。</p>
  }
  if (!data) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-teal-500" />
      </div>
    )
  }
  if (!data.configured) {
    return (
      <p className="rounded-2xl bg-white p-8 text-center text-sm text-slate-400 shadow-sm ring-1 ring-slate-900/[0.06]">
        服务器未配置 STRIPE_SECRET_KEY,暂无法读取收入数据。
      </p>
    )
  }

  const done = data.months.filter((m) => !m.current)
  const cur = data.months.find((m) => m.current)
  const unsettled = done.filter((m) => !m.settlement)
  // 待结算合计只在单一币种时直接相加;多币种时逐月看(目前只收 USD)。
  const currencies = [...new Set(unsettled.map((m) => m.currency))]
  const pendingShare = currencies.length === 1 ? unsettled.reduce((s, m) => s + m.share_findhomego_cents, 0) : null

  return (
    <div className="space-y-4">
      {/* 口径说明 — 双方看同一份数字,避免扯皮。 */}
      <div className="rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-900/[0.06]">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
          <Handshake className="h-4 w-4 text-teal-600" />
          分成对账单
          {data.livemode === false && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200">
              <FlaskConical className="h-3 w-3" /> Stripe 测试模式数据
            </span>
          )}
        </h3>
        <p className="mt-1 text-xs text-slate-500">
          口径:按 Stripe <b>实收净额</b>(客户付款 − 退款 − Stripe 手续费)逐月分成,
          FINDHOMEGO {Math.round(data.share_rate * 100)}% / 运营方 {Math.round((1 - data.share_rate) * 100)}%;
          月份按迪拜时间切分。每月转账后点「标记已结算」锁定快照。
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="本月实收净额" value={cur ? fmtMoney(cur.net_cents, cur.currency) : '—'} icon={<Banknote className="h-4 w-4" />} hint={cur ? `${cur.txn_count} 笔(进行中)` : '本月暂无收入'} />
        <StatCard label="本月 FINDHOMEGO 应得" value={cur ? fmtMoney(cur.share_findhomego_cents, cur.currency) : '—'} icon={<PiggyBank className="h-4 w-4" />} />
        <StatCard label="待结算(FINDHOMEGO)" value={pendingShare != null ? fmtMoney(pendingShare, currencies[0] || 'usd') : unsettled.length ? `${unsettled.length} 个月` : '$0.00'} icon={<Handshake className="h-4 w-4" />} hint={unsettled.length ? `${unsettled.length} 个已完结月未结算` : '全部结清'} />
        <StatCard label="已结算月份" value={done.filter((m) => m.settlement).length} icon={<CheckCircle2 className="h-4 w-4" />} />
      </div>

      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/[0.06]">
        <div className="border-b border-slate-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-800">逐月明细(近 12 个月)</h3>
        </div>
        {data.months.length === 0 ? (
          <p className="px-4 py-6 text-xs text-slate-400">还没有任何 Stripe 收入记录。</p>
        ) : (
          data.months.map((m) => <MonthRow key={`${m.month}|${m.currency}`} m={m} onChanged={load} />)
        )}
      </div>
    </div>
  )
}
