import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Phone, MessageCircle, BadgeCheck, TrendingUp, Building2, MapPin, Loader2, Info } from 'lucide-react'
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
  const [series, setSeries] = useState<{ months: string[]; price: (number | null)[] } | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading')

  useEffect(() => {
    fetch(`${API}/api/luna/public/project-report/${code}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j: ReportData) => {
        setD(j); setState('ok')
        const areaId = j?.insights?.area?.id
        if (areaId) {
          fetch(`${API}/api/market/area-insights?areaId=${encodeURIComponent(areaId)}`)
            .then((r) => (r.ok ? r.json() : null)).then((s) => s && setSeries({ months: s.months, price: s.price })).catch(() => {})
        }
      })
      .catch(() => setState('error'))
  }, [code])

  if (state === 'loading') return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-teal-500" /></div>
  if (state === 'error' || !d) return <div className="flex min-h-screen items-center justify-center text-slate-400">报告不存在或已下线</div>

  const { agent, project, insights, transactions, supply } = d
  const inv = insights?.investment
  const area = insights?.area
  const sales = transactions?.sales || []
  const wa = agent.whatsapp || agent.phone
  const contactHref = agent.whatsapp ? `https://wa.me/${agent.whatsapp.replace(/[^0-9]/g, '')}` : `tel:${agent.phone}`
  const M = (v: number | null | undefined) => v != null ? formatMoneyCompact(v, 'zh') : '—'
  const D = ({ v }: { v: number | null | undefined }) => <><DirhamSymbol size="0.72em" className="text-slate-400" />{M(v)}</>

  return (
    <div className="min-h-screen bg-slate-50 pb-24 text-slate-900">
      {/* Hero */}
      <div className="relative h-52 w-full overflow-hidden bg-slate-800 sm:h-64">
        {project.primary_image && <img src={project.primary_image} alt={project.project_name} className="h-full w-full object-cover" />}
        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 mx-auto max-w-xl px-5 pb-4 text-white">
          <div className="flex items-center gap-1.5 text-xs opacity-90"><MapPin className="h-3.5 w-3.5" />{project.area || '迪拜'}</div>
          <h1 className="mt-0.5 text-2xl font-bold leading-tight sm:text-3xl">{project.project_name}</h1>
          <div className="mt-0.5 text-sm opacity-80">{project.developer}</div>
        </div>
      </div>

      <div className="mx-auto max-w-xl px-4">
        {/* Agent card */}
        <div className="-mt-7 flex items-center gap-3 rounded-2xl bg-white p-4 shadow-lg ring-1 ring-slate-900/[0.06]">
          {agent.photo
            ? <img src={agent.photo} alt={agent.name} className="h-16 w-16 rounded-full object-cover ring-2 ring-teal-100" />
            : <div className="flex h-16 w-16 items-center justify-center rounded-full bg-teal-500 text-2xl font-bold text-white">{(agent.name || '?').slice(0, 1)}</div>}
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-medium uppercase tracking-wide text-teal-600">您的专属顾问</div>
            <div className="truncate text-lg font-bold">{agent.name}</div>
            {agent.phone && <div className="text-xs text-slate-400">{agent.phone}</div>}
          </div>
          {wa && (
            <a href={contactHref} className="flex items-center gap-1.5 rounded-full bg-teal-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-teal-600">
              {agent.whatsapp ? <MessageCircle className="h-4 w-4" /> : <Phone className="h-4 w-4" />}咨询
            </a>
          )}
        </div>

        {/* Key facts */}
        <Section>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <Stat label="起售价" value={<D v={project.starting_price || project.min_price} />} />
            <Stat label="户型" value={project.min_bedrooms != null ? `${project.min_bedrooms}${project.max_bedrooms && project.max_bedrooms !== project.min_bedrooms ? `–${project.max_bedrooms}` : ''} 居` : '—'} />
            <Stat label="区域均价/㎡" value={area?.median_price_sqm != null ? <D v={area.median_price_sqm} /> : '—'} />
            <Stat label="租金回报" value={area?.rental_yield_pct != null ? <span className="text-emerald-600">{Number(area.rental_yield_pct).toFixed(1)}%</span> : '—'} />
          </div>
        </Section>

        {/* Investment — simple, evidence-backed, with chart */}
        {inv && (
          <Section title="5 年投资测算" icon={<TrendingUp className="h-4 w-4 text-teal-500" />}>
            {/* Headline */}
            <div className="mb-3 flex items-end justify-between gap-3 rounded-xl bg-teal-50 px-4 py-3">
              <div>
                <div className="text-[11px] text-teal-700/70">投入 <DirhamSymbol size="0.7em" />{M(inv.buy)},5 年预计总回报</div>
                <div className="text-2xl font-extrabold text-teal-700"><DirhamSymbol size="0.7em" className="text-teal-500" />{M(inv.total_profit_5yr)}</div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-extrabold text-emerald-600">{inv.annualized_return_pct != null ? `${Number(inv.annualized_return_pct).toFixed(1)}%` : '—'}</div>
                <div className="text-[11px] text-slate-500">年化回报{inv.payback_years != null ? ` · ${Number(inv.payback_years).toFixed(0)} 年回本` : ''}</div>
              </div>
            </div>

            {/* How it's made — money flow bar */}
            <FlowBar buy={inv.buy} appr={inv.appreciation_5yr} rent={inv.rental_income_5yr} fmt={M} />

            {/* Evidence */}
            <div className="mt-3 flex items-start gap-1.5 rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
              <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
              <span>
                测算依据：{project.area || '该区域'} 近 12 个月真实 DLD 成交
                {sales.length ? `（${sales.length}+ 笔可比）` : ''} —— 租金回报 {area?.rental_yield_pct != null ? `${Number(area.rental_yield_pct).toFixed(1)}%` : '—'}、
                年增长 {area?.price_growth_pct != null ? `${Number(area.price_growth_pct).toFixed(1)}%` : '—'}。
                总回报 = 5 年租金收入 + 资产增值。<b>指示性测算，非投资保证。</b>
              </span>
            </div>
          </Section>
        )}

        {/* Price trend — real DLD evidence chart */}
        {series && series.price.some((v) => v != null) && (
          <Section title="区域价格走势" icon={<TrendingUp className="h-4 w-4 text-teal-500" />} badge="近 24 个月 · DLD">
            <TrendChart months={series.months} price={series.price} />
            <p className="mt-1 text-[11px] text-slate-400">{project.area} 每平方米成交中位价（AED），来自 Dubai Land Department 真实成交。</p>
          </Section>
        )}

        {/* Supply */}
        {supply && supply.units_pipeline > 0 && (
          <Section title="区域供给" icon={<Building2 className="h-4 w-4 text-teal-500" />}>
            <div className="grid grid-cols-3 gap-2.5">
              <Stat label="在建项目" value={`${supply.pipeline_projects}`} />
              <Stat label="在建单元" value={Number(supply.units_pipeline).toLocaleString()} />
              <Stat label="1 年内交付" value={Number(supply.units_handover_1y).toLocaleString()} />
            </div>
          </Section>
        )}

        {/* Recent real DLD comps */}
        {sales.length > 0 && (
          <Section title="最近真实成交" icon={<BadgeCheck className="h-4 w-4 text-emerald-500" />} badge="Dubai Land Department">
            <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-100">
              {sales.slice(0, 5).map((r: any, i: number) => (
                <div key={i} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-800">{r.building || project.project_name}</div>
                    <div className="text-[11px] text-slate-400">{r.date}{r.rooms ? ` · ${r.rooms}` : ''}{r.sizeSqm ? ` · ${r.sizeSqm}㎡` : ''}</div>
                  </div>
                  <div className="shrink-0 text-sm font-bold"><D v={r.price} /></div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Nearby */}
        {insights?.nearby?.metro?.length > 0 && (
          <Section title="周边配套" icon={<MapPin className="h-4 w-4 text-teal-500" />}>
            <div className="flex flex-wrap gap-1.5">
              {insights.nearby.metro.slice(0, 2).map((m: any, i: number) => (
                <span key={i} className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">🚇 {m.name} · {(m.distance_m / 1000).toFixed(1)}km</span>
              ))}
              {(insights.nearby.pois || []).slice(0, 4).map((p: any, i: number) => (
                <span key={i} className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">{p.name} · {(p.distance_m / 1000).toFixed(1)}km</span>
              ))}
            </div>
          </Section>
        )}

        <p className="mt-6 text-center text-[11px] text-slate-400">数据来源 Dubai Land Department · 指示性信息，非投资建议</p>
      </div>

      {/* Sticky contact */}
      {wa && (
        <div className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 p-3 backdrop-blur">
          <a href={contactHref} className="mx-auto flex max-w-xl items-center justify-center gap-2 rounded-xl bg-teal-500 py-3 font-semibold text-white shadow-sm hover:bg-teal-600">
            {agent.whatsapp ? <MessageCircle className="h-5 w-5" /> : <Phone className="h-5 w-5" />}咨询 {agent.name} 了解更多
          </a>
        </div>
      )}
    </div>
  )
}

/** Money-flow bar: how the 5-yr return is built (本金 + 增值 + 租金). */
function FlowBar({ buy, appr, rent, fmt }: { buy: number; appr: number | null; rent: number | null; fmt: (v: number | null) => string }) {
  const a = Math.max(0, appr ?? 0), r = Math.max(0, rent ?? 0)
  const total = buy + a + r
  const seg = (v: number) => `${Math.max(2, (v / total) * 100)}%`
  return (
    <div>
      <div className="flex h-7 w-full overflow-hidden rounded-lg text-[10px] font-semibold text-white">
        <div className="flex items-center justify-center bg-slate-400" style={{ width: seg(buy) }}>本金</div>
        {a > 0 && <div className="flex items-center justify-center bg-teal-500" style={{ width: seg(a) }}>增值</div>}
        {r > 0 && <div className="flex items-center justify-center bg-emerald-500" style={{ width: seg(r) }}>租金</div>}
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
        <Leg color="bg-slate-400" label="本金投入" value={<><DirhamSymbol size="0.7em" className="text-slate-400" />{fmt(buy)}</>} />
        <Leg color="bg-teal-500" label="5 年增值" value={<><DirhamSymbol size="0.7em" className="text-slate-400" />{fmt(a)}</>} />
        <Leg color="bg-emerald-500" label="5 年租金" value={<><DirhamSymbol size="0.7em" className="text-slate-400" />{fmt(r)}</>} />
      </div>
    </div>
  )
}
function Leg({ color, label, value }: { color: string; label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-center gap-1 text-[11px] text-slate-400"><span className={`h-2 w-2 rounded-full ${color}`} />{label}</div>
      <div className="text-sm font-bold text-slate-800">{value}</div>
    </div>
  )
}

/** Area price trend (median AED/sqm) as a smooth area chart. */
function TrendChart({ months, price }: { months: string[]; price: (number | null)[] }) {
  const pts = price.map((v, i) => ({ v, i })).filter((p) => p.v != null) as { v: number; i: number }[]
  if (pts.length < 2) return null
  const W = 320, H = 90, pad = 4
  const min = Math.min(...pts.map((p) => p.v)), max = Math.max(...pts.map((p) => p.v))
  const span = max - min || 1
  const x = (i: number) => pad + (i / (price.length - 1)) * (W - 2 * pad)
  const y = (v: number) => H - pad - ((v - min) / span) * (H - 2 * pad)
  const line = pts.map((p, k) => `${k === 0 ? 'M' : 'L'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')
  const fill = `${line} L${x(pts[pts.length - 1].i).toFixed(1)},${H} L${x(pts[0].i).toFixed(1)},${H} Z`
  const last = pts[pts.length - 1].v
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none" style={{ height: 90 }}>
        <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0d9488" stopOpacity="0.18" /><stop offset="100%" stopColor="#0d9488" stopOpacity="0" /></linearGradient></defs>
        <path d={fill} fill="url(#g)" />
        <path d={line} fill="none" stroke="#0d9488" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-slate-400">
        <span>{months[pts[0].i]}</span>
        <span className="font-semibold text-slate-600">最新 {Math.round(last).toLocaleString()} /㎡</span>
        <span>{months[pts[pts.length - 1].i]}</span>
      </div>
    </div>
  )
}

function Section({ title, icon, badge, children }: { title?: string; icon?: React.ReactNode; badge?: string; children: React.ReactNode }) {
  return (
    <div className="mt-3.5 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-900/[0.04]">
      {title && (
        <div className="mb-3 flex items-center gap-2">
          {icon}<h3 className="text-sm font-bold text-slate-800">{title}</h3>
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
      <div className="mt-0.5 text-base font-bold leading-tight">{value}</div>
    </div>
  )
}
