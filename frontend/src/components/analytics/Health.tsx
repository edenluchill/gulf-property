/**
 * 健康度面板 —— 「我们现在到底健不健康」一屏可判。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 设计原则：**主角是绝对数，不是百分比。**
 *
 * 现阶段真实外部用户是个位数。n=1~3 时百分比会骗人：再来 1 个激活用户，激活率就从
 * 2% 跳到 4%（翻倍），但什么都没发生。所以：
 *   1. 绝对数用大字号排在最上面，比率排在下面且必须显示分母 n
 *   2. n < MIN_SAMPLE 时显示「样本不足」而不是假精度的百分比
 *   3. benchmark 只画成灰色参考线，**不做红绿告警** ——
 *      一个天天全红的面板，一周内就会变成墙纸，然后你就再也不看它了
 *
 * 唯一允许「报警色」的地方是 past_due（有人想付钱但扣款失败）——
 * 那是个具体待办事项，不是一个统计指标。
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { useEffect, useState } from 'react'
import { AlertCircle, ArrowDown, ArrowRight, ArrowUp, Info } from 'lucide-react'
import { fetchHealth, HealthSnapshot, HealthFeature, HealthFunnel } from '../../lib/analyticsApi'
import StatCard from './StatCard'

/** 分母低于这个数就不显示百分比 —— 再算下去只是给自己制造精确的幻觉。 */
const MIN_SAMPLE = 20

function Delta({ cur, prev }: { cur: number; prev: number }) {
  if (prev === 0 && cur === 0) return <span className="text-slate-300">—</span>
  const d = cur - prev
  if (d === 0) return <span className="inline-flex items-center gap-0.5 text-slate-400"><ArrowRight className="h-3 w-3" />持平</span>
  const up = d > 0
  return (
    <span className={`inline-flex items-center gap-0.5 ${up ? 'text-emerald-600' : 'text-rose-600'}`}>
      {up ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      {up ? '+' : ''}{d} <span className="text-slate-400">(上期 {prev})</span>
    </span>
  )
}

/** 产出 → 被消费。**这是整个面板最重要的一块。** */
function FeatureRow({ f }: { f: HealthFeature }) {
  const zeroConsumption = f.produced > 0 && f.consumed === 0
  const ratio = f.produced > 0 ? Math.round((f.consumed / f.produced) * 100) : null

  return (
    <div className="border-t border-slate-100 py-3 first:border-t-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-medium text-slate-800">{f.label}</span>
          {!f.canSplitInternal && (
            <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-amber-200">
              含内部测试
            </span>
          )}
        </div>
        <div className="text-sm tabular-nums">
          <span className="font-semibold text-slate-900">{f.produced}</span>
          <span className="text-slate-400"> 产出 → </span>
          <span className={`font-semibold ${zeroConsumption ? 'text-rose-600' : 'text-slate-900'}`}>
            {f.consumed}
          </span>
          <span className="text-slate-400"> 被消费</span>
          {ratio !== null && <span className="ml-1.5 text-slate-400">({ratio}%)</span>}
        </div>
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span className="text-slate-500">产出环比 <Delta cur={f.produced} prev={f.producedPrev} /></span>
        {f.consumedDetail && <span className="text-slate-500">{f.consumedDetail}</span>}
        {zeroConsumption && (
          <span className="font-medium text-rose-600">
            ⚠ 做出来了但一次都没被打开 —— 经纪自己都没发给客户
          </span>
        )}
      </div>

      <details className="mt-1">
        <summary className="cursor-pointer text-[11px] text-slate-400 hover:text-slate-600">口径</summary>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{f.note}</p>
      </details>
    </div>
  )
}

/** 比率 + 市场参考线。参考线是**灰色**的，不是红绿灯。 */
function FunnelRow({ f }: { f: HealthFunnel }) {
  const tooSmall = f.n < MIN_SAMPLE || f.value === null
  // 条形按「优秀线」做满标，这样中位和当前值的相对位置一眼可见
  const scale = Math.max(f.good, f.value ?? 0) * 1.15
  const pct = (v: number) => `${Math.min(100, (v / scale) * 100)}%`

  return (
    <div className="border-t border-slate-100 py-3 first:border-t-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm text-slate-700">{f.label}</span>
        <div className="text-sm tabular-nums">
          {tooSmall ? (
            <span className="text-slate-400">样本不足（n={f.n}）</span>
          ) : (
            <>
              <span className="font-semibold text-slate-900">{f.value}%</span>
              <span className="ml-1 text-xs text-slate-400">n={f.n}</span>
            </>
          )}
        </div>
      </div>

      {/* 参考线条形图。**刻意全灰** —— 见文件头，不做红绿告警。 */}
      <div className="relative mt-2 h-1.5 rounded-full bg-slate-100">
        {f.value !== null && (
          <div className="absolute inset-y-0 left-0 rounded-full bg-slate-700" style={{ width: pct(f.value) }} />
        )}
        <div className="absolute inset-y-[-3px] w-px bg-slate-400" style={{ left: pct(f.median) }} />
        <div className="absolute inset-y-[-3px] w-px bg-slate-300" style={{ left: pct(f.good) }} />
      </div>
      <div className="mt-1 flex gap-3 text-[11px] text-slate-400">
        <span>市场中位 {f.median}%</span>
        <span>优秀 {f.good}%</span>
        <span className="text-slate-300">· {f.source}</span>
      </div>
    </div>
  )
}

export default function Health({ days = 30 }: { days?: number }) {
  const [data, setData] = useState<HealthSnapshot | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let stale = false
    setData(null); setErr(null)
    fetchHealth(days)
      .then((d) => { if (!stale) setData(d) })
      .catch((e) => { if (!stale) setErr(String(e?.message || e)) })
    return () => { stale = true }
  }, [days])

  if (err) return <div className="p-6 text-sm text-rose-600">加载失败：{err}</div>
  if (!data) return <div className="p-6 text-sm text-slate-400">加载中…</div>

  const a = data.agents

  return (
    <div className="space-y-6">
      {/* ── 待办：有人想付钱但失败了。整个面板唯一允许用报警色的地方 ── */}
      {a.pastDue > 0 && (
        <div className="flex items-start gap-2 rounded-xl bg-rose-50 p-3 ring-1 ring-rose-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
          <div className="text-sm text-rose-900">
            <span className="font-semibold">{a.pastDue} 个账号扣款失败（past_due）</span>
            —— 有人想付钱但没扣成。这是今天就该去追的具体事项，不是趋势指标。
            去「订阅」tab 看是谁。
          </div>
        </div>
      )}

      {/* ── 绝对数：面板的主角 ── */}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-700">
          真实外部经纪
          <span className="ml-2 font-normal text-xs text-slate-400">已排除自己人</span>
        </h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <StatCard label="注册总数" value={a.total} />
          <StatCard label={`近 ${days} 天新注册`} value={a.newCur}
            hint={a.newPrev > 0 ? `上期 ${a.newPrev}` : undefined} />
          <StatCard label="开了试用" value={a.trialStarted} />
          <StatCard label="做出过产出物" value={a.activated}
            hint="tour / 报价单 / 报告，任一即算" />
          <StatCard label="注册日之后回来过" value={a.returned}
            hint={`≥3 天活动的有 ${a.deepUsers} 人`} />
          <StatCard label="真实付费" value={a.paying}
            hint="不含 owner 自己" />
        </div>
      </section>

      {/* ── 产出 → 被消费：最重要的一块 ── */}
      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-900/[0.06]">
        <h3 className="text-sm font-semibold text-slate-700">产出 → 被客户消费</h3>
        <p className="mb-1 mt-0.5 flex items-start gap-1 text-xs text-slate-500">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          生成了 ≠ 有价值。经纪做了东西却从没发给客户、或发了客户没打开，
          说明他自己都不信这东西值得发 —— 这比留存率更早暴露功能没被认可。
        </p>
        {data.features.map((f) => <FeatureRow key={f.key} f={f} />)}
      </section>

      {/* ── 比率：排在下面，且必须带 n ── */}
      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-900/[0.06]">
        <h3 className="text-sm font-semibold text-slate-700">漏斗 vs 市场基准</h3>
        <p className="mb-1 mt-0.5 text-xs text-slate-500">
          参考线是灰色的，不是红绿灯：现阶段样本量下这些比率长期不会好看，
          做成告警只会让你停止看这个面板。真正值得反应的是上面绝对数的变化。
        </p>
        {data.funnel.map((f) => <FunnelRow key={f.key} f={f} />)}
      </section>

      {/* ── 口径透明：不透明的面板没人敢信 ── */}
      <details className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500">
        <summary className="cursor-pointer font-medium text-slate-600">
          被算作「自己人」而排除的账号（{data.internalAgents.length}）
        </summary>
        <ul className="mt-2 space-y-0.5 font-mono text-[11px]">
          {data.internalAgents.map((e) => <li key={e}>{e}</li>)}
        </ul>
        <p className="mt-2 leading-relaxed">
          这份名单写死在 <code>backend/src/services/healthQueries.ts</code> 的
          <code> INTERNAL_AGENTS</code>，改它 = 改口径，会在 git 里留记录。
        </p>
      </details>
    </div>
  )
}
