import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Phone, MessageCircle, BadgeCheck, TrendingUp, Building2, MapPin, Loader2 } from 'lucide-react'
import { formatMoneyCompact } from '../lib/money'
import DirhamSymbol from '../components/DirhamSymbol'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000'

interface ReportData {
  report: { title: string | null }
  agent: { name: string; photo: string | null; phone: string | null; whatsapp: string | null; brand: any }
  project: any
  insights: any
  transactions: any
  supply: any
}

export default function ProjectReportPage() {
  const { code } = useParams()
  const [d, setD] = useState<ReportData | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading')

  useEffect(() => {
    fetch(`${API}/api/luna/public/project-report/${code}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => { setD(j); setState('ok') })
      .catch(() => setState('error'))
  }, [code])

  if (state === 'loading') return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-teal-500" /></div>
  if (state === 'error' || !d) return <div className="flex min-h-screen items-center justify-center text-slate-400">报告不存在或已下线</div>

  const { agent, project, insights, transactions, supply } = d
  const inv = insights?.investment
  const area = insights?.area
  const sales = transactions?.sales || []
  const wa = agent.whatsapp || agent.phone
  const D = ({ v }: { v: number | null | undefined }) => <><DirhamSymbol size="0.75em" className="text-slate-400" />{v != null ? formatMoneyCompact(v, 'zh') : '—'}</>

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      {/* Hero */}
      <div className="relative h-56 w-full overflow-hidden bg-slate-800 sm:h-72">
        {project.primary_image && <img src={project.primary_image} alt={project.project_name} className="h-full w-full object-cover opacity-90" />}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 mx-auto max-w-2xl px-5 pb-4 text-white">
          <div className="flex items-center gap-2 text-sm opacity-90"><MapPin className="h-4 w-4" />{project.area || '迪拜'}</div>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">{project.project_name}</h1>
          <div className="mt-1 text-sm opacity-90">{project.developer}{project.status ? ` · ${project.status}` : ''}</div>
        </div>
      </div>

      <div className="mx-auto max-w-2xl px-4">
        {/* Agent card */}
        <div className="-mt-6 flex items-center gap-3 rounded-2xl bg-white p-4 shadow-lg ring-1 ring-slate-900/[0.06]">
          {agent.photo
            ? <img src={agent.photo} alt={agent.name} className="h-14 w-14 rounded-full object-cover ring-2 ring-teal-100" />
            : <div className="flex h-14 w-14 items-center justify-center rounded-full bg-teal-500 text-xl font-bold text-white">{(agent.name || '?').slice(0, 1)}</div>}
          <div className="min-w-0 flex-1">
            <div className="text-xs text-slate-400">您的专属顾问</div>
            <div className="truncate text-lg font-bold text-slate-900">{agent.name}</div>
          </div>
          {wa && (
            <a href={agent.whatsapp ? `https://wa.me/${agent.whatsapp.replace(/[^0-9]/g, '')}` : `tel:${agent.phone}`}
               className="flex items-center gap-1.5 rounded-full bg-teal-500 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-600">
              {agent.whatsapp ? <MessageCircle className="h-4 w-4" /> : <Phone className="h-4 w-4" />}联系
            </a>
          )}
        </div>

        {/* Price + key facts */}
        <Section>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="起售价" value={<D v={project.starting_price || project.min_price} />} />
            <Stat label="卧室" value={project.min_bedrooms != null ? `${project.min_bedrooms}${project.max_bedrooms && project.max_bedrooms !== project.min_bedrooms ? `–${project.max_bedrooms}` : ''} 居` : '—'} />
            <Stat label="区域中位价/㎡" value={area?.median_price_sqm != null ? <D v={area.median_price_sqm} /> : '—'} />
            <Stat label="租金回报" value={area?.rental_yield_pct != null ? <span className="text-emerald-600">{Number(area.rental_yield_pct).toFixed(1)}%</span> : '—'} />
          </div>
        </Section>

        {/* Investment outlook */}
        {inv && (
          <Section title="5 年投资测算" icon={<TrendingUp className="h-4 w-4 text-teal-500" />}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="买入" value={<D v={inv.buy} />} />
              <Stat label="5 年后" value={<D v={inv.future} />} />
              <Stat label="年化回报" value={inv.annualized_return_pct != null ? <span className="text-emerald-600">{Number(inv.annualized_return_pct).toFixed(1)}%</span> : '—'} />
              <Stat label="回本年数" value={inv.payback_years != null ? `${Number(inv.payback_years).toFixed(1)} 年` : '—'} />
            </div>
            <p className="mt-2 text-[11px] text-slate-400">指示性测算,非保证。基于区域近期成交与租金。</p>
          </Section>
        )}

        {/* Supply pipeline (the new DLD signal) */}
        {supply && supply.units_pipeline > 0 && (
          <Section title="区域供给" icon={<Building2 className="h-4 w-4 text-teal-500" />}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Stat label="在建项目" value={`${supply.pipeline_projects} 个`} />
              <Stat label="在建单元" value={Number(supply.units_pipeline).toLocaleString()} />
              <Stat label="未来 1 年交付" value={Number(supply.units_handover_1y).toLocaleString()} />
            </div>
          </Section>
        )}

        {/* Recent real DLD transactions */}
        {sales.length > 0 && (
          <Section title="最近真实成交" icon={<BadgeCheck className="h-4 w-4 text-emerald-500" />} badge="Dubai Land Department">
            <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-100">
              {sales.slice(0, 5).map((r: any, i: number) => (
                <div key={i} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-800">{r.building || project.project_name}</div>
                    <div className="text-[11px] text-slate-400">{r.date}{r.rooms ? ` · ${r.rooms}` : ''}{r.sizeSqm ? ` · ${r.sizeSqm}㎡` : ''}</div>
                  </div>
                  <div className="shrink-0 text-sm font-bold text-slate-900"><D v={r.price} /></div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Nearby */}
        {insights?.nearby?.metro?.length > 0 && (
          <Section title="周边" icon={<MapPin className="h-4 w-4 text-teal-500" />}>
            <div className="flex flex-wrap gap-2">
              {insights.nearby.metro.slice(0, 2).map((m: any, i: number) => (
                <span key={i} className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">🚇 {m.name} · {(m.distance_m / 1000).toFixed(1)}km</span>
              ))}
              {(insights.nearby.pois || []).slice(0, 4).map((p: any, i: number) => (
                <span key={i} className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">{p.name} · {(p.distance_m / 1000).toFixed(1)}km</span>
              ))}
            </div>
          </Section>
        )}

        <p className="mt-6 text-center text-[11px] text-slate-400">数据来源 Dubai Land Department · 指示性,非投资建议</p>
      </div>

      {/* Sticky contact bar */}
      {wa && (
        <div className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 p-3 backdrop-blur">
          <a href={agent.whatsapp ? `https://wa.me/${agent.whatsapp.replace(/[^0-9]/g, '')}` : `tel:${agent.phone}`}
             className="mx-auto flex max-w-2xl items-center justify-center gap-2 rounded-xl bg-teal-500 py-3 font-semibold text-white hover:bg-teal-600">
            {agent.whatsapp ? <MessageCircle className="h-5 w-5" /> : <Phone className="h-5 w-5" />}联系 {agent.name} 了解更多
          </a>
        </div>
      )}
    </div>
  )
}

function Section({ title, icon, badge, children }: { title?: string; icon?: React.ReactNode; badge?: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-900/[0.04]">
      {title && (
        <div className="mb-3 flex items-center gap-2">
          {icon}<h3 className="text-sm font-semibold text-slate-800">{title}</h3>
          {badge && <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-200"><BadgeCheck className="h-3 w-3" />{badge}</span>}
        </div>
      )}
      {children}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2">
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className="mt-0.5 text-base font-bold leading-tight text-slate-900">{value}</div>
    </div>
  )
}
