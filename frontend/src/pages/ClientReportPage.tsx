import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { Phone, MessageCircle, BadgeCheck, Loader2, Printer, ShieldCheck, Building2, ExternalLink, MapPin, TrendingUp, FileText, ListChecks } from 'lucide-react'
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
    <div className="min-h-screen bg-slate-100 pb-28 print:bg-white print:pb-0">
      <style>{`@media print { .no-print{display:none!important} .pg{box-shadow:none!important;margin:0!important} body{background:#fff} }`}</style>

      <div className="no-print sticky top-0 z-50 flex items-center justify-between gap-2 border-b border-slate-200 bg-white/95 px-4 py-2.5 backdrop-blur">
        <div className="text-sm font-semibold text-slate-700">投资提案 · {r.client_name || '客户'}</div>
        <button onClick={() => window.print()} className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-900"><Printer className="h-4 w-4" />保存 PDF</button>
      </div>

      <div className="pg mx-auto my-4 max-w-3xl bg-white p-6 shadow-sm print:my-0 sm:p-8">
        {/* Header — brand only, no chatty prose */}
        <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
          {agent.photo
            ? <img src={agent.photo} alt={agent.name} className="h-14 w-14 rounded-full object-cover ring-2 ring-teal-100" />
            : <div className="flex h-14 w-14 items-center justify-center rounded-full bg-teal-500 text-xl font-bold text-white">{(agent.name || '?').slice(0, 1)}</div>}
          <div className="min-w-0 flex-1">
            <div className="text-lg font-bold text-slate-900">迪拜房产投资提案</div>
            <div className="text-sm text-slate-500">顾问 {agent.name}{agent.phone ? ` · ${agent.phone}` : ''}</div>
          </div>
          <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200"><BadgeCheck className="h-3.5 w-3.5" />DLD 认证数据</span>
        </div>
        <div className="mt-3 text-sm text-slate-400">致 {r.client_name || '客户'}{r.profile ? ` · 需求：${r.profile}` : ''}</div>

        {/* 概要 — structured, data-driven summary (no chatty prose) */}
        {r.overview && (
          <Section title="概要" icon={<FileText className="h-4 w-4 text-teal-500" />}>
            <p className="text-sm leading-relaxed text-slate-700">
              为{r.client_name || '客户'}{r.profile ? `（${r.profile}）` : ''}精选 <b>{r.overview.count}</b> 个预算内项目。
              {r.overview.avg_net_annualized_pct != null && <>平均<b>净</b>年化回报 <b className="text-emerald-600">{r.overview.avg_net_annualized_pct}%</b></>}
              {r.overview.best_name && <>，其中 <b>{r.overview.best_name}</b> 最高（{r.overview.best_net_pct}%）</>}。
              以下测算均基于 DLD 真实成交，并已扣除过户费、中介费与物业费。
            </p>
            <div className="mt-3 grid grid-cols-3 gap-2.5">
              <Stat label="精选项目" value={`${r.overview.count} 个`} />
              <Stat label="平均净年化" value={r.overview.avg_net_annualized_pct != null ? <span className="text-emerald-600">{r.overview.avg_net_annualized_pct}%</span> : '—'} />
              <Stat label="价格区间" value={r.overview.price_min != null ? <span className="text-[13px]"><Dh v={r.overview.price_min} />–<Dh v={r.overview.price_max} /></span> : '—'} />
            </div>
          </Section>
        )}

        {/* Market & policy */}
        {r.market && (
          <Section title="市场与政策" icon={<ShieldCheck className="h-4 w-4 text-teal-500" />}>
            {(r.market.avg_growth_pct != null || r.market.pipeline_units != null) && (
              <div className="mb-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                {r.market.avg_yield_pct != null && <Stat label="区域平均回报" value={<span className="text-emerald-600">{r.market.avg_yield_pct}%</span>} />}
                {r.market.avg_growth_pct != null && <Stat label="区域年增长" value={`${r.market.avg_growth_pct}%`} />}
                {r.market.pipeline_units != null && <Stat label="在建供给" value={Number(r.market.pipeline_units).toLocaleString()} />}
              </div>
            )}
            <ul className="space-y-1.5">
              {(r.market.policy || []).map((p: string, i: number) => (
                <li key={i} className="flex items-start gap-2 text-sm text-slate-600"><span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-teal-400" />{p}</li>
              ))}
            </ul>
          </Section>
        )}

        {/* Featured project — one focused, detailed analysis */}
        <div className="mt-6 mb-1 flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-teal-500" />
          <h3 className="text-sm font-bold text-slate-800">主推项目</h3>
        </div>
        {(r.properties || []).slice(0, 1).map((p: any, i: number) => {
          const yoySane = p.yoy && p.yoy.growth_pct != null && Math.abs(p.yoy.growth_pct) <= 40
          return (
            <div key={i} className="mt-2 overflow-hidden rounded-2xl border-2 border-teal-200">
              {/* Clickable header → project page */}
              <a href={`/project/${p.project_id || p.id}`} target="_blank" rel="noreferrer" className="flex gap-3 bg-teal-50/60 p-3 hover:bg-teal-50">
                {p.image && <img src={p.image} alt={p.name} className="h-24 w-32 flex-shrink-0 rounded-lg object-cover" />}
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-semibold text-teal-600">主推 · 最佳匹配</div>
                  <div className="flex items-center gap-1 truncate text-lg font-bold text-slate-900">{p.name}<ExternalLink className="h-4 w-4 flex-shrink-0 text-slate-400" /></div>
                  <div className="text-xs text-slate-500">{p.developer}{p.area ? ` · ${p.area}` : ''}</div>
                  <div className="mt-1 text-[11px] text-teal-600">点击查看项目详情 →</div>
                </div>
              </a>

              <div className="p-3.5">
                {/* Transparent 5yr net profit calculation */}
                {p.net && (
                  <>
                    <div className="mb-2 text-xs font-bold text-slate-700">利润测算（净额 · 5 年）</div>
                    <div className="overflow-hidden rounded-xl border border-slate-100 text-sm">
                      <Row label="买入价" value={<Dh v={p.net.buy} />} />
                      <Row label={`资产增值（年增长 ${p.area_metrics?.price_growth_pct != null ? `${Number(p.area_metrics.price_growth_pct).toFixed(1)}%` : '约 7%'}）`} value={<span className="text-emerald-600">+<Dh v={p.net.appreciation} /></span>} />
                      <Row label="5 年净租金（扣物业费/维护约 25%）" value={<span className="text-emerald-600">+<Dh v={p.net.net_rent} /></span>} />
                      <Row label="过户费 DLD 4%" value={<span className="text-rose-500">−<Dh v={p.net.dld_fee} /></span>} />
                      <Row label="中介费 2%" value={<span className="text-rose-500">−<Dh v={p.net.agent_fee} /></span>} />
                      <Row label="5 年净利润" value={<span className="font-extrabold text-teal-700"><Dh v={p.net.net_profit} /></span>} strong />
                    </div>
                    <div className="mt-2 flex items-center justify-between rounded-lg bg-teal-50 px-3 py-2">
                      <span className="text-xs text-teal-700/80">净年化回报</span>
                      <span className="text-lg font-extrabold text-teal-700">{p.net.net_annualized_pct}%</span>
                    </div>
                    <div className="mt-3">
                      <div className="mb-1 flex items-center justify-between text-[11px] text-slate-400"><span>净资产价值（5 年）</span><span className="font-semibold text-emerald-600">+{Math.round((p.net.net_profit / p.net.buy) * 100)}%</span></div>
                      <GrowthCurve start={p.net.buy} end={p.net.buy + p.net.net_profit} />
                    </div>
                  </>
                )}

                {/* Growth evidence: real price trend + comp count + sane YoY */}
                {p.price_trend?.length > 1 && (
                  <div className="mt-3">
                    <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-slate-500"><TrendingUp className="h-3 w-3 text-teal-500" />增长依据 · {p.area} 真实成交（近 24 个月）</div>
                    <TrendChart trend={p.price_trend} />
                    <div className="mt-1 text-[11px] text-slate-400">
                      {yoySane
                        ? `中位价：去年 ${Number(p.yoy.last_year_sqm).toLocaleString()} → 今年 ${Number(p.yoy.this_year_sqm).toLocaleString()} /㎡（同比 ${p.yoy.growth_pct > 0 ? '+' : ''}${p.yoy.growth_pct}%，${p.yoy.count} 笔）`
                        : `基于 ${p.yoy?.count ?? p.area_metrics?.transaction_count ?? ''} 笔近期 DLD 成交。增长率取区域稳健均值，非单点同比。`}
                    </div>
                  </div>
                )}

                {/* Nearby */}
                {p.nearby && (p.nearby.metro?.length || p.nearby.pois?.length) && (
                  <div className="mt-3">
                    <div className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold text-slate-500"><MapPin className="h-3 w-3 text-teal-500" />附近环境</div>
                    <div className="flex flex-wrap gap-1.5">
                      {(p.nearby.metro || []).slice(0, 2).map((m: any, k: number) => <span key={k} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">🚇 {m.name} · {(m.distance_m / 1000).toFixed(1)}km</span>)}
                      {(p.nearby.pois || []).slice(0, 5).map((m: any, k: number) => <span key={k} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">{m.name} · {(m.distance_m / 1000).toFixed(1)}km</span>)}
                    </div>
                  </div>
                )}

                {/* Supply */}
                {p.supply && p.supply.units_pipeline > 0 && (
                  <div className="mt-3 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600"><Building2 className="h-3.5 w-3.5 text-slate-400" />区域在建 {Number(p.supply.units_pipeline).toLocaleString()} 套，1 年内交付 {Number(p.supply.units_handover_1y).toLocaleString()} 套</div>
                )}

                {/* Real comps */}
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

                {p.risks?.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {p.risks.map((rk: string, k: number) => <span key={k} className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700 ring-1 ring-amber-200">{rk}</span>)}
                  </div>
                )}
              </div>
            </div>
          )
        })}

        {/* 其他推荐 — compact alternatives at the bottom */}
        {(r.properties || []).length > 1 && (
          <div className="mt-6">
            <div className="mb-2 flex items-center gap-2"><ListChecks className="h-4 w-4 text-slate-400" /><h3 className="text-sm font-bold text-slate-800">其他推荐</h3></div>
            <div className="grid gap-2.5 sm:grid-cols-2">
              {r.properties.slice(1).map((p: any, i: number) => (
                <a key={i} href={`/project/${p.project_id || p.id}`} target="_blank" rel="noreferrer" className="flex gap-3 rounded-xl border border-slate-200 bg-white p-3 hover:border-teal-300">
                  {p.image && <img src={p.image} alt={p.name} className="h-16 w-20 flex-shrink-0 rounded-lg object-cover" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1 truncate text-sm font-semibold text-slate-800">{p.name}<ExternalLink className="h-3 w-3 flex-shrink-0 text-slate-300" /></div>
                    <div className="truncate text-[11px] text-slate-400">{p.developer}{p.area ? ` · ${p.area}` : ''}</div>
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
                      {p.net?.buy != null && <span className="text-slate-500">起 <Dh v={p.net.buy} /></span>}
                      {p.net?.net_annualized_pct != null && <span className="font-semibold text-emerald-600">净年化 {p.net.net_annualized_pct}%</span>}
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}

        <div className="mt-5 rounded-xl bg-slate-50 px-4 py-3 text-[11px] leading-relaxed text-slate-400">
          {r.assumptions}<br />{r.disclaimer}
        </div>
      </div>

      {wa && (
        <div className="no-print fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 p-3 backdrop-blur">
          <a href={contactHref} className="mx-auto flex max-w-3xl items-center justify-center gap-2 rounded-xl bg-teal-500 py-3 font-semibold text-white hover:bg-teal-600">{agent.whatsapp ? <MessageCircle className="h-5 w-5" /> : <Phone className="h-5 w-5" />}咨询 {agent.name}</a>
        </div>
      )}
    </div>
  )
}

function Row({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between px-3 py-2 ${strong ? 'bg-teal-50/50' : ''} border-b border-slate-50 last:border-0`}>
      <span className="text-slate-500">{label}</span><span className="font-medium text-slate-800">{value}</span>
    </div>
  )
}

function TrendChart({ trend }: { trend: { m: string; v: number | null }[] }) {
  const pts = trend.map((t, i) => ({ v: t.v, i })).filter((p) => p.v != null) as { v: number; i: number }[]
  if (pts.length < 2) return null
  const W = 320, H = 70, pad = 4
  const min = Math.min(...pts.map((p) => p.v)), max = Math.max(...pts.map((p) => p.v)), span = max - min || 1
  const x = (i: number) => pad + (i / (trend.length - 1)) * (W - 2 * pad)
  const y = (v: number) => H - pad - ((v - min) / span) * (H - 2 * pad)
  const line = pts.map((p, k) => `${k === 0 ? 'M' : 'L'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')
  const fill = `${line} L${x(pts[pts.length - 1].i).toFixed(1)},${H} L${x(pts[0].i).toFixed(1)},${H} Z`
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none" style={{ height: 70 }}>
      <defs><linearGradient id="tg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0d9488" stopOpacity="0.18" /><stop offset="100%" stopColor="#0d9488" stopOpacity="0" /></linearGradient></defs>
      <path d={fill} fill="url(#tg)" /><path d={line} fill="none" stroke="#0d9488" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  )
}
function GrowthCurve({ start, end }: { start: number; end: number }) {
  if (!start || !end || end <= start) return null
  const r = Math.pow(end / start, 1 / 5) - 1
  const pts = Array.from({ length: 6 }, (_, i) => start * Math.pow(1 + r, i))
  const W = 320, H = 60, pad = 3
  const min = start, max = end, span = max - min || 1
  const x = (i: number) => pad + (i / 5) * (W - 2 * pad)
  const y = (v: number) => H - pad - ((v - min) / span) * (H - 2 * pad)
  const line = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const fill = `${line} L${x(5)},${H} L${x(0)},${H} Z`
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none" style={{ height: 60 }}>
      <defs><linearGradient id="gcv" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#10b981" stopOpacity="0.2" /><stop offset="100%" stopColor="#10b981" stopOpacity="0" /></linearGradient></defs>
      <path d={fill} fill="url(#gcv)" /><path d={line} fill="none" stroke="#10b981" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  )
}
function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return <div className="mt-5"><div className="mb-3 flex items-center gap-2">{icon}<h3 className="text-sm font-bold text-slate-800">{title}</h3></div>{children}</div>
}
function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="rounded-lg bg-slate-50 px-2.5 py-1.5"><div className="text-[11px] text-slate-400">{label}</div><div className="mt-0.5 text-sm font-bold text-slate-800">{value}</div></div>
}
