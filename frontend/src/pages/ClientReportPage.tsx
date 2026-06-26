import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { Phone, MessageCircle, BadgeCheck, Loader2, Printer, ShieldCheck, TrendingUp, Building2 } from 'lucide-react'
import { formatMoneyCompact } from '../lib/money'
import DirhamSymbol from '../components/DirhamSymbol'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000'
const M = (v: number | null | undefined) => (v != null ? formatMoneyCompact(v, 'zh') : '—')
const Dh = ({ v }: { v: number | null | undefined }) => <><DirhamSymbol size="0.7em" className="text-slate-400" />{M(v)}</>

export default function ClientReportPage() {
  const { code } = useParams()
  const [data, setData] = useState<any>(null)
  const [state, setState] = useState<'loading' | 'generating' | 'ok' | 'error'>('loading')

  const load = useCallback(() => {
    fetch(`${API}/api/luna/public/client-report/${code}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => {
        if (j.status === 'ready') { setData(j); setState('ok') }
        else if (j.status === 'error') setState('error')
        else { setState('generating'); setTimeout(load, 2500) }
      })
      .catch(() => setState('error'))
  }, [code])
  useEffect(() => { load() }, [load])

  if (state === 'loading' || state === 'generating')
    return <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-slate-400"><Loader2 className="h-8 w-8 animate-spin text-teal-500" />{state === 'generating' ? '报告生成中…' : ''}</div>
  if (state === 'error' || !data) return <div className="flex min-h-screen items-center justify-center text-slate-400">报告不存在或已下线</div>

  const { agent, report } = data
  const r = report
  const wa = agent.whatsapp || agent.phone
  const contactHref = agent.whatsapp ? `https://wa.me/${agent.whatsapp.replace(/[^0-9]/g, '')}` : `tel:${agent.phone}`

  return (
    <div className="min-h-screen bg-slate-100 print:bg-white">
      <style>{`@media print { .no-print { display:none !important } .pg { box-shadow:none !important; margin:0 !important } body { background:#fff } }`}</style>

      {/* Toolbar */}
      <div className="no-print sticky top-0 z-50 flex items-center justify-between gap-2 border-b border-slate-200 bg-white/95 px-4 py-2.5 backdrop-blur">
        <div className="text-sm font-semibold text-slate-700">投资提案 · {r.client_name || '客户'}</div>
        <button onClick={() => window.print()} className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-900">
          <Printer className="h-4 w-4" />保存 PDF
        </button>
      </div>

      <div className="pg mx-auto my-4 max-w-3xl bg-white p-6 shadow-sm print:my-0 sm:p-8">
        {/* Header — agent brand */}
        <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
          {agent.photo
            ? <img src={agent.photo} alt={agent.name} className="h-14 w-14 rounded-full object-cover ring-2 ring-teal-100" />
            : <div className="flex h-14 w-14 items-center justify-center rounded-full bg-teal-500 text-xl font-bold text-white">{(agent.name || '?').slice(0, 1)}</div>}
          <div className="min-w-0 flex-1">
            <div className="text-lg font-bold text-slate-900">迪拜房产投资提案</div>
            <div className="text-sm text-slate-500">顾问 {agent.name}{agent.phone ? ` · ${agent.phone}` : ''}</div>
          </div>
          <BadgeCheck className="h-6 w-6 text-emerald-500" />
        </div>

        {/* Client + summary */}
        <div className="mt-4">
          <div className="text-sm text-slate-400">致 {r.client_name || '尊敬的客户'}</div>
          {r.profile && <div className="mt-0.5 text-xs text-slate-400">需求：{r.profile}</div>}
          {r.summary && <p className="mt-2 text-sm leading-relaxed text-slate-700">{r.summary}</p>}
        </div>

        {/* Market & policy */}
        {r.market && (
          <Section title="市场与政策" icon={<ShieldCheck className="h-4 w-4 text-teal-500" />}>
            <div className="mb-3 grid grid-cols-3 gap-2.5">
              <Stat label="区域平均回报" value={r.market.avg_yield_pct != null ? <span className="text-emerald-600">{r.market.avg_yield_pct}%</span> : '—'} />
              <Stat label="区域年增长" value={r.market.avg_growth_pct != null ? `${r.market.avg_growth_pct}%` : '—'} />
              <Stat label="在建供给" value={r.market.pipeline_units != null ? Number(r.market.pipeline_units).toLocaleString() : '—'} />
            </div>
            <ul className="space-y-1.5">
              {(r.market.policy || []).map((p: string, i: number) => (
                <li key={i} className="flex items-start gap-2 text-sm text-slate-600"><span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-teal-400" />{p}</li>
              ))}
            </ul>
          </Section>
        )}

        {/* Properties */}
        {(r.properties || []).map((p: any, i: number) => (
          <div key={i} className="mt-5 overflow-hidden rounded-2xl border border-slate-200">
            <div className="flex gap-3 bg-slate-50 p-3">
              {p.image && <img src={p.image} alt={p.name} className="h-20 w-28 flex-shrink-0 rounded-lg object-cover" />}
              <div className="min-w-0">
                <div className="text-[11px] font-semibold text-teal-600">候选 {i + 1}</div>
                <div className="truncate text-base font-bold text-slate-900">{p.name}</div>
                <div className="text-xs text-slate-500">{p.developer}{p.area ? ` · ${p.area}` : ''}</div>
              </div>
            </div>
            <div className="p-3.5">
              {p.reason && <p className="mb-3 text-sm leading-relaxed text-slate-600">{p.reason}</p>}

              {/* Returns */}
              {p.projection && (
                <>
                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                    <Stat label="买入" value={<Dh v={p.projection.buy} />} />
                    <Stat label="5 年后" value={<Dh v={p.projection.future} />} />
                    <Stat label="年化回报" value={<span className="text-emerald-600">{p.projection.annualized_return_pct != null ? `${Number(p.projection.annualized_return_pct).toFixed(1)}%` : '—'}</span>} />
                    <Stat label="回本" value={p.projection.payback_years != null ? `${Number(p.projection.payback_years).toFixed(0)} 年` : '—'} />
                  </div>
                  <FlowBar buy={p.projection.buy} appr={p.projection.appreciation_5yr} rent={p.projection.rental_income_5yr} />
                  {p.area_metrics && (
                    <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-400">
                      <TrendingUp className="h-3 w-3" />测算依据：{p.area} 真实成交 —— 回报 {p.area_metrics.rental_yield_pct != null ? `${Number(p.area_metrics.rental_yield_pct).toFixed(1)}%` : '—'}、年增长 {p.area_metrics.price_growth_pct != null ? `${Number(p.area_metrics.price_growth_pct).toFixed(1)}%` : '—'}{p.area_metrics.transaction_count ? `（${p.area_metrics.transaction_count} 笔）` : ''}
                    </div>
                  )}
                </>
              )}

              {/* Supply */}
              {p.supply && p.supply.units_pipeline > 0 && (
                <div className="mt-3 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  <Building2 className="h-3.5 w-3.5 text-slate-400" />区域在建 {Number(p.supply.units_pipeline).toLocaleString()} 套，1 年内交付 {Number(p.supply.units_handover_1y).toLocaleString()} 套
                </div>
              )}

              {/* Comps */}
              {p.comps?.length > 0 && (
                <div className="mt-3">
                  <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-slate-500"><BadgeCheck className="h-3 w-3 text-emerald-500" />近期真实成交（DLD）</div>
                  <div className="divide-y divide-slate-100 rounded-lg border border-slate-100">
                    {p.comps.map((c: any, k: number) => (
                      <div key={k} className="flex items-center justify-between px-2.5 py-1.5 text-xs">
                        <span className="truncate text-slate-600">{c.building || p.name} · {c.date}{c.sizeSqm ? ` · ${c.sizeSqm}㎡` : ''}</span>
                        <span className="font-semibold text-slate-800"><Dh v={c.price} /></span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Scenarios */}
              {p.scenarios && (
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <Scen color="emerald" label="乐观" text={p.scenarios.optimistic} />
                  <Scen color="slate" label="基准" text={p.scenarios.base} />
                  <Scen color="amber" label="保守" text={p.scenarios.conservative} />
                </div>
              )}
              {p.risks?.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {p.risks.map((rk: string, k: number) => <span key={k} className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700 ring-1 ring-amber-200">{rk}</span>)}
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Footer */}
        <div className="mt-5 rounded-xl bg-slate-50 px-4 py-3 text-[11px] leading-relaxed text-slate-400">
          {r.assumptions}<br />{r.disclaimer}
        </div>
      </div>

      {/* Sticky contact */}
      {wa && (
        <div className="no-print fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 p-3 backdrop-blur">
          <a href={contactHref} className="mx-auto flex max-w-3xl items-center justify-center gap-2 rounded-xl bg-teal-500 py-3 font-semibold text-white hover:bg-teal-600">
            {agent.whatsapp ? <MessageCircle className="h-5 w-5" /> : <Phone className="h-5 w-5" />}咨询 {agent.name}
          </a>
        </div>
      )}
    </div>
  )
}

function FlowBar({ buy, appr, rent }: { buy: number; appr: number | null; rent: number | null }) {
  const a = Math.max(0, appr ?? 0), rr = Math.max(0, rent ?? 0), total = buy + a + rr
  const seg = (v: number) => `${Math.max(2, (v / total) * 100)}%`
  return (
    <div className="mt-3 flex h-6 w-full overflow-hidden rounded-lg text-[10px] font-semibold text-white">
      <div className="flex items-center justify-center bg-slate-400" style={{ width: seg(buy) }}>本金</div>
      {a > 0 && <div className="flex items-center justify-center bg-teal-500" style={{ width: seg(a) }}>增值</div>}
      {rr > 0 && <div className="flex items-center justify-center bg-emerald-500" style={{ width: seg(rr) }}>租金</div>}
    </div>
  )
}
function Scen({ color, label, text }: { color: string; label: string; text: string }) {
  const c: any = { emerald: 'bg-emerald-50 text-emerald-700', slate: 'bg-slate-50 text-slate-600', amber: 'bg-amber-50 text-amber-700' }
  return <div className={`rounded-lg p-2.5 text-[11px] leading-relaxed ${c[color]}`}><div className="mb-0.5 font-semibold">{label}</div>{text}</div>
}
function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return <div className="mt-5"><div className="mb-3 flex items-center gap-2">{icon}<h3 className="text-sm font-bold text-slate-800">{title}</h3></div>{children}</div>
}
function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="rounded-lg bg-slate-50 px-2.5 py-1.5"><div className="text-[11px] text-slate-400">{label}</div><div className="mt-0.5 text-sm font-bold text-slate-800">{value}</div></div>
}
