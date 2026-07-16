import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { Phone, MessageCircle, BadgeCheck, Loader2, Printer, ShieldCheck, Building2, ExternalLink, TrendingUp, Home, Star, Train, GraduationCap, Trees, ListChecks, Target, Check, X, AlertTriangle } from 'lucide-react'
import { formatMoneyCompact } from '../lib/money'
import i18n from '../i18n'
import DirhamSymbol from '../components/DirhamSymbol'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000'

type TFn = (k: string, o?: Record<string, unknown>) => string

// 报告是经纪为客户备好的正式文档:正文由 AI 按 report.lang 写好并存库,
// 语言在生成那一刻定死。渲染必须锁定同一语言(getFixedT 非响应式),不跟浏览者
// UI 语言走 —— 否则会出现「阿语标签 + 中文正文」,比全中文更糟。
const docNs = (lang: string): TFn =>
  (i18n.getFixedT as (l: string, ns: string) => TFn)(!lang || lang === 'zh' ? 'zh-CN' : lang, 'clientReport')

const M = (v: number | null | undefined, lang: string) => (v != null ? formatMoneyCompact(v, lang) : '—')
const Dh = ({ v, lang }: { v: number | null | undefined; lang: string }) => <><DirhamSymbol size="0.7em" className="text-slate-400" />{M(v, lang)}</>
const km = (m: number) => `${(m / 1000).toFixed(1)}km`

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

  // 加载/错误态没有报告可读 → 没有文档语言,只能跟浏览者 UI 语言。
  if (state === 'loading' || state === 'generating') {
    const tUi = docNs(i18n.language || 'en')
    return <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-slate-400"><Loader2 className="h-8 w-8 animate-spin text-teal-500" />{state === 'generating' ? tUi('generating') : ''}</div>
  }
  if (state === 'error' || !data) {
    const tUi = docNs(i18n.language || 'en')
    return <div className="flex min-h-screen items-center justify-center text-slate-400">{tUi('notFound')}</div>
  }

  const { agent, report } = data
  const lang: string = data.lang || 'zh'
  const t = docNs(lang)
  if (report?.kind === 'compare') return <CompareReport agent={agent} report={report} lang={lang} />
  const r = report
  const p = (r.properties || [])[0]            // the single featured project
  const others = (r.properties || []).slice(1)
  const yoySane = p?.yoy && p.yoy.growth_pct != null && Math.abs(p.yoy.growth_pct) <= 40
  const clientName = r.client_name || t('clientFallback')

  // categorise nearby into 交通 / 学校 / 环境
  const pois: any[] = p?.nearby?.pois || []
  const has = (x: any, ...ks: string[]) => ks.some((k) => String(x.category || x.type || '').toLowerCase().includes(k))
  const transit = [...(p?.nearby?.metro || []), ...pois.filter((x) => has(x, 'metro', 'transport', 'bus', 'tram'))]
  const schools = pois.filter((x) => has(x, 'school', 'educat', 'academy', 'universit', 'college', 'nursery'))
  const env = pois.filter((x) => !has(x, 'metro', 'transport', 'bus', 'tram', 'school', 'educat', 'academy', 'universit', 'college', 'nursery'))

  const profileLine = renderProfile(r.profile_struct, t, lang) || r.profile

  return (
    <div dir={lang === 'ar' ? 'rtl' : 'ltr'} className="relative min-h-screen bg-slate-100 pb-28 print:bg-white print:pb-0">
      <style>{`@media print { .no-print{display:none!important} .pg{box-shadow:none!important;margin:0!important} body{background:#fff} }`}</style>

      <TopBar title={p?.name || t('defaultTitle')} t={t} />

      <div className="pg relative mx-auto my-4 max-w-3xl bg-white p-6 shadow-sm print:my-0 sm:p-8">
        <AgentStamp agent={agent} t={t} />

        {/* Hero — the project IS the title */}
        {p && (
          <a href={`/project/${p.project_id || p.id}`} target="_blank" rel="noreferrer" className="block">
            {p.image && <img src={p.image} alt={p.name} className="h-44 w-full rounded-xl object-cover sm:h-56" />}
            <div className="mt-3 pe-24">
              <div className="text-[11px] font-semibold text-teal-600">{t('heroKicker', { name: clientName })}</div>
              <h1 className="flex items-center gap-2 text-2xl font-extrabold text-slate-900">{p.name}<ExternalLink className="h-5 w-5 flex-shrink-0 text-slate-300" /></h1>
              <div className="text-sm text-slate-500">{p.developer}{p.area ? ` · ${p.area}` : ''}</div>
            </div>
          </a>
        )}
        {profileLine && <div className="mt-2 text-sm text-slate-400">{t('profile.label')}{profileLine}</div>}

        {p && (
          <>
            {/* 投资评分 radar */}
            {p.scores?.length >= 3 && (
              <Section title={t('section.scores')} icon={<Star className="h-4 w-4 text-amber-400" />}>
                <div className="flex flex-col items-center gap-3 sm:flex-row">
                  <div className="flex-shrink-0"><RadarChart data={p.scores} /></div>
                  <div className="flex-1 space-y-1.5 self-stretch">
                    {p.scores.map((s: any) => (
                      <div key={s.k} className="flex items-center gap-2">
                        <span className="w-20 flex-shrink-0 text-xs text-slate-500">{s.k}</span>
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-teal-500" style={{ width: `${s.v}%` }} /></div>
                        <span className="w-7 flex-shrink-0 text-end text-xs font-semibold text-slate-700">{s.v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </Section>
            )}

            {/* ⭐ Layer 1 —— 项目 × 客户：为什么这个适合你
                这是整份报告的价值所在:不是数据罗列,是**论证**。
                取舍/风险也要显示 —— 一份全是优点的报告反而不可信,客户不傻。 */}
            {p.fit && (p.fit.project_why?.length > 0 || p.fit.project_tradeoffs?.length > 0) && (
              <Section title={t('section.fit')} icon={<Target className="h-4 w-4 text-teal-500" />}>
                {p.fit.project_fit != null && (
                  <div className="mb-3 flex items-center gap-3">
                    <span className="text-xs text-slate-500">{t('fit.score')}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-teal-500 transition-all" style={{ width: `${Math.max(0, Math.min(100, p.fit.project_fit))}%` }} />
                    </div>
                    <span className="w-8 text-end text-sm font-bold tabular-nums text-slate-800">{p.fit.project_fit}</span>
                  </div>
                )}
                <ul className="space-y-2">
                  {(p.fit.project_why || []).map((w: string, i: number) => (
                    <li key={i} className="flex gap-2 text-sm leading-relaxed text-slate-700">
                      <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-teal-500" /><span>{w}</span>
                    </li>
                  ))}
                </ul>
                {p.fit.project_tradeoffs?.length > 0 && (
                  <div className="mt-3 rounded-xl bg-amber-50/70 p-3">
                    <div className="mb-1.5 text-[11px] font-semibold text-amber-900">{t('fit.tradeoffs')}</div>
                    <ul className="space-y-1.5">
                      {p.fit.project_tradeoffs.map((w: string, i: number) => (
                        <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-amber-900/90">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" /><span>{w}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Section>
            )}

            {/* ⭐ Layer 2 —— 户型 × 客户：特点对特点
                「适合的户型」曾经是假的(就是最便宜的 8 个)。现在按客户画像真打分,
                并逐条论证「为什么这个户型适合你」+「**为什么不推另外那个**」。
                ⚠️ price 只有 51% 填充 —— 无价的显示「价格待定」,不隐藏、不猜。 */}
            {p.units?.length > 0 && (
              <Section title={t('section.units')} icon={<Home className="h-4 w-4 text-teal-500" />}>
                {p.fit?.unit_why?.length > 0 && (
                  <div className="mb-3 rounded-xl bg-teal-50/70 p-3">
                    {p.fit.recommended_unit && (
                      <div className="mb-1.5 text-sm font-bold text-teal-900">{t('units.recommended', { name: p.fit.recommended_unit })}</div>
                    )}
                    <ul className="space-y-1.5">
                      {p.fit.unit_why.map((w: string, i: number) => (
                        <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-teal-900/90">
                          <Check className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" /><span>{w}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="overflow-hidden rounded-xl border border-slate-100">
                  <div className="flex bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-400">
                    <span className="flex-1">{t('units.colName')}</span>
                    <span className="w-14 text-end">{t('units.colArea')}</span>
                    <span className="w-24 text-end">{t('units.colPrice')}</span>
                  </div>
                  {p.units.slice(0, 6).map((u: any, i: number) => {
                    const isTop = p.fit?.recommended_unit && String(u.name || '').includes(p.fit.recommended_unit)
                    return (
                      <div key={i} className={`border-t border-slate-50 px-3 py-2 ${isTop ? 'bg-teal-50/40' : ''}`}>
                        <div className="flex items-center text-sm">
                          <span className="flex flex-1 items-center gap-1.5 truncate text-slate-700">
                            {isTop && <span className="shrink-0 rounded bg-teal-500 px-1 text-[9px] font-bold text-white">{t('units.badge')}</span>}
                            <span className="truncate">{u.name || (u.bedrooms != null ? t('units.bedrooms', { n: u.bedrooms }) : t('units.fallbackName'))}</span>
                          </span>
                          <span className="w-14 text-end text-xs text-slate-500">{u.area != null ? `${Math.round(u.area)}ft²` : '—'}</span>
                          <span className="w-24 text-end font-semibold text-slate-800">
                            {u.price != null ? <Dh v={u.price} lang={lang} /> : <span className="text-xs font-normal text-slate-400">{t('units.priceTbd')}</span>}
                          </span>
                        </div>
                        {/* 配置 —— 「特点对特点」的原料(女佣房/洗衣房/开放厨房…) */}
                        {u.features?.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {u.features.slice(0, 5).map((f: string, k: number) => (
                              <span key={k} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{f}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* ⭐ 反向论证 —— 说清不推什么,比只夸一个更有说服力 */}
                {p.fit?.unit_why_not?.length > 0 && (
                  <div className="mt-3 rounded-xl bg-slate-50 p-3">
                    <div className="mb-1.5 text-[11px] font-semibold text-slate-600">{t('units.whyNot')}</div>
                    <ul className="space-y-1.5">
                      {p.fit.unit_why_not.map((w: string, i: number) => (
                        <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-slate-600">
                          <X className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-slate-400" /><span>{w}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Section>
            )}

            {/* 利润测算 */}
            {p.net && (
              <Section title={t('section.profit')} icon={<TrendingUp className="h-4 w-4 text-teal-500" />}>
                <div className="overflow-hidden rounded-xl border border-slate-100 text-sm">
                  <Row label={t('net.buy')} value={<Dh v={p.net.buy} lang={lang} />} />
                  <Row label={t('net.appreciation', { rate: p.area_metrics?.price_growth_pct != null ? `${Number(p.area_metrics.price_growth_pct).toFixed(1)}%` : t('net.growthFallback') })} value={<span className="text-emerald-600">+<Dh v={p.net.appreciation} lang={lang} /></span>} />
                  <Row label={t('net.netRent')} value={<span className="text-emerald-600">+<Dh v={p.net.net_rent} lang={lang} /></span>} />
                  <Row label={t('net.dldFee')} value={<span className="text-rose-500">−<Dh v={p.net.dld_fee} lang={lang} /></span>} />
                  <Row label={t('net.agentFee')} value={<span className="text-rose-500">−<Dh v={p.net.agent_fee} lang={lang} /></span>} />
                  <Row label={t('net.netProfit')} value={<span className="font-extrabold text-teal-700"><Dh v={p.net.net_profit} lang={lang} /></span>} strong />
                </div>
                <div className="mt-2 flex items-center justify-between rounded-lg bg-teal-50 px-3 py-2">
                  <span className="text-xs text-teal-700/80">{t('net.annualized')}</span><span className="text-lg font-extrabold text-teal-700">{p.net.net_annualized_pct}%</span>
                </div>
                <div className="mt-3">
                  <div className="mb-1 flex items-center justify-between text-[11px] text-slate-400"><span>{t('net.netAssetValue')}</span><span className="font-semibold text-emerald-600">+{Math.round((p.net.net_profit / p.net.buy) * 100)}%</span></div>
                  <GrowthCurve start={p.net.buy} end={p.net.buy + p.net.net_profit} />
                </div>
              </Section>
            )}

            {/* 价格走势 — real DLD, with axes */}
            {p.price_trend?.length > 1 && (
              <Section title={t('section.priceTrend')} icon={<TrendingUp className="h-4 w-4 text-teal-500" />}>
                <TrendChart trend={p.price_trend} />
                <div className="mt-1.5 text-[11px] text-slate-400">
                  {yoySane
                    ? t('trend.yoy', {
                        last: Number(p.yoy.last_year_sqm).toLocaleString(),
                        cur: Number(p.yoy.this_year_sqm).toLocaleString(),
                        delta: `${p.yoy.growth_pct > 0 ? '+' : ''}${p.yoy.growth_pct}%`,
                        n: p.yoy.count,
                      })
                    : t('trend.fallback', { n: p.yoy?.count ?? p.area_metrics?.transaction_count ?? '' })}
                </div>
              </Section>
            )}

            {/* 真实成交 */}
            {p.comps?.length > 0 && (
              <Section title={t('section.comps')} icon={<BadgeCheck className="h-4 w-4 text-emerald-500" />}>
                <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-100">
                  {p.comps.map((c: any, k: number) => (
                    <div key={k} className="flex items-center justify-between px-3 py-2 text-sm">
                      <span className="truncate text-slate-600">{c.building || p.name} · {c.date}{c.sizeSqm ? ` · ${c.sizeSqm}㎡` : ''}</span>
                      <span className="font-semibold text-slate-800"><Dh v={c.price} lang={lang} /></span>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* Detail sections: 交通 / 学校 / 环境 */}
            {transit.length > 0 && <NearbySection title={t('section.transit')} icon={<Train className="h-4 w-4 text-teal-500" />} intro={t('nearby.transitIntro')} items={transit} />}
            {schools.length > 0 && <NearbySection title={t('section.schools')} icon={<GraduationCap className="h-4 w-4 text-teal-500" />} intro={t('nearby.schoolsIntro')} items={schools} />}
            {env.length > 0 && <NearbySection title={t('section.env')} icon={<Trees className="h-4 w-4 text-teal-500" />} intro={t('nearby.envIntro')} items={env} />}

            {/* 区域供给 */}
            {p.supply && p.supply.units_pipeline > 0 && (
              <Section title={t('section.supply')} icon={<Building2 className="h-4 w-4 text-slate-400" />}>
                <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">{t('supply.text', { n: Number(p.supply.units_pipeline).toLocaleString(), h: Number(p.supply.units_handover_1y).toLocaleString() })}</div>
              </Section>
            )}
          </>
        )}

        {/* 市场与政策 */}
        {r.market && (
          <Section title={t('section.market')} icon={<ShieldCheck className="h-4 w-4 text-teal-500" />}>
            {(r.market.avg_growth_pct != null || r.market.pipeline_units != null) && (
              <div className="mb-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                {r.market.avg_yield_pct != null && <Stat label={t('market.avgYield')} value={<span className="text-emerald-600">{r.market.avg_yield_pct}%</span>} />}
                {r.market.avg_growth_pct != null && <Stat label={t('market.avgGrowth')} value={`${r.market.avg_growth_pct}%`} />}
                {r.market.pipeline_units != null && <Stat label={t('market.pipeline')} value={Number(r.market.pipeline_units).toLocaleString()} />}
              </div>
            )}
            <ul className="space-y-1.5">
              {(r.market.policy || []).map((pol: string, i: number) => (
                <li key={i} className="flex items-start gap-2 text-sm text-slate-600"><span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-teal-400" />{pol}</li>
              ))}
            </ul>
          </Section>
        )}

        {/* 其他推荐 */}
        {others.length > 0 && (
          <Section title={t('section.others')} icon={<ListChecks className="h-4 w-4 text-slate-400" />}>
            <div className="grid gap-2.5 sm:grid-cols-2">
              {others.map((o: any, i: number) => (
                <a key={i} href={`/project/${o.project_id || o.id}`} target="_blank" rel="noreferrer" className="flex gap-3 rounded-xl border border-slate-200 bg-white p-3 hover:border-teal-300">
                  {o.image && <img src={o.image} alt={o.name} className="h-16 w-20 flex-shrink-0 rounded-lg object-cover" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1 truncate text-sm font-semibold text-slate-800">{o.name}<ExternalLink className="h-3 w-3 flex-shrink-0 text-slate-300" /></div>
                    <div className="truncate text-[11px] text-slate-400">{o.developer}{o.area ? ` · ${o.area}` : ''}</div>
                    <div className="mt-1.5 flex flex-wrap gap-x-3 text-[11px]">
                      {o.net?.buy != null && <span className="text-slate-500">{t('others.from')} <Dh v={o.net.buy} lang={lang} /></span>}
                      {o.net?.net_annualized_pct != null && <span className="font-semibold text-emerald-600">{t('others.netAnnual', { pct: o.net.net_annualized_pct })}</span>}
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </Section>
        )}

        <div className="mt-5 rounded-xl bg-slate-50 px-4 py-3 text-[11px] leading-relaxed text-slate-400">{r.assumptions}<br />{r.disclaimer}</div>
      </div>

      <ContactBar agent={agent} t={t} />
    </div>
  )
}

/* ---- client profile line ----
   `profile_struct` 是后端存的**结构化**画像(ExtractedProfile)。以前这行读的是
   `r.profile` —— profileToOneLiner() 拼的中文串,于是公开页用中文向一个可能不懂
   中文的客户描述他自己。现在按报告语言渲染。
   历史报告没有 profile_struct → 调用处回退 `r.profile`(那些报告 lang 本就是 zh)。 */
const GOALS = ['live', 'invest', 'both']
const PAYMENTS = ['cash', 'installment', 'mortgage']
const HORIZONS = ['rent_long', 'flip', 'rent_then_live']

function renderProfile(ps: any, t: TFn, lang: string): string | null {
  if (!ps || typeof ps !== 'object') return null
  // 枚举值来自 AI 写的 jsonb —— 没白名单的话,一个意料外的值会把裸 key
  // (「profile.goal.xyz」)直接印给客户看。认不出就跳过这一条。
  const enumBit = (allowed: string[], v: unknown, prefix: string) =>
    typeof v === 'string' && allowed.includes(v) ? t(`${prefix}.${v}`) : null
  const bits: string[] = []
  if (ps.nationality) bits.push(String(ps.nationality))
  const goal = enumBit(GOALS, ps.goal, 'profile.goal')
  if (goal) bits.push(goal)
  if (ps.budget_min && ps.budget_max && ps.budget_min !== ps.budget_max) {
    bits.push(t('profile.budgetRange', { min: M(ps.budget_min, lang), max: M(ps.budget_max, lang) }))
  } else {
    const b = ps.budget_max ?? ps.budget_min
    if (b) bits.push(t('profile.budget', { amount: M(b, lang) }))
  }
  if (ps.bedrooms) bits.push(t('profile.bedrooms', { n: ps.bedrooms }))
  if (ps.family_size) bits.push(t('profile.familySize', { n: ps.family_size }))
  if (ps.has_children) bits.push(t('profile.hasChildren'))
  if (ps.has_maid) bits.push(t('profile.hasMaid'))
  if (ps.cooking === 'often') bits.push(t('profile.cookingOften'))
  const payment = enumBit(PAYMENTS, ps.payment, 'profile.payment')
  if (payment) bits.push(payment)
  const horizon = enumBit(HORIZONS, ps.horizon, 'profile.horizon')
  if (horizon) bits.push(horizon)
  if (ps.golden_visa) bits.push(t('profile.goldenVisa'))
  if (ps.first_time_buyer) bits.push(t('profile.firstTimeBuyer'))
  if (ps.offplan_ok === false) bits.push(t('profile.readyOnly'))
  if (ps.preferred_areas?.length) bits.push(t('profile.areas', { areas: ps.preferred_areas.join('/') }))
  return bits.length ? bits.join(t('profile.sep')) : null
}

/* ---- shared branded chrome (used by proposal + compare views) ---- */

function TopBar({ title, t }: { title: string; t: TFn }) {
  return (
    <div className="no-print sticky top-0 z-50 flex items-center justify-between gap-2 border-b border-slate-200 bg-white/95 px-4 py-2.5 backdrop-blur">
      <div className="truncate text-sm font-semibold text-slate-700">{title}</div>
      <button onClick={() => window.print()} className="flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-900"><Printer className="h-4 w-4" />{t('savePdf')}</button>
    </div>
  )
}

function AgentStamp({ agent, t }: { agent: any; t: TFn }) {
  return (
    <div className="absolute end-5 top-5 z-10 flex items-center gap-2 rounded-full border border-slate-200 bg-white/90 py-1 ps-1 pe-3 shadow-sm">
      {agent.photo
        ? <img src={agent.photo} alt={agent.name} className="h-8 w-8 rounded-full object-cover" />
        : <div className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-500 text-sm font-bold text-white">{(agent.name || '?').slice(0, 1)}</div>}
      <div className="leading-tight">
        <div className="text-[11px] font-semibold text-slate-700">{agent.name}</div>
        <div className="flex items-center gap-0.5 text-[9px] text-emerald-600"><BadgeCheck className="h-2.5 w-2.5" />{t('memberBadge')}</div>
      </div>
    </div>
  )
}

function ContactBar({ agent, t }: { agent: any; t: TFn }) {
  const wa = agent.whatsapp || agent.phone
  if (!wa) return null
  const contactHref = agent.whatsapp ? `https://wa.me/${agent.whatsapp.replace(/[^0-9]/g, '')}` : `tel:${agent.phone}`
  return (
    <div className="no-print fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 p-3 backdrop-blur">
      <a href={contactHref} className="mx-auto flex max-w-3xl items-center justify-center gap-2 rounded-xl bg-teal-500 py-3 font-semibold text-white hover:bg-teal-600">{agent.whatsapp ? <MessageCircle className="h-5 w-5" /> : <Phone className="h-5 w-5" />}{t('contactAgent', { name: agent.name })}</a>
    </div>
  )
}

/* ---- compare view (report.kind === 'compare') ---- */

function CompareReport({ agent, report, lang }: { agent: any; report: any; lang: string }) {
  const t = docNs(lang)
  const props: any[] = report.properties || []
  const cmp = report.comparison || null
  const rec = cmp?.recommendation || null
  const winnerIdx: number | null = rec?.winnerIndex != null ? rec.winnerIndex : null
  const winnerName = winnerIdx != null && props[winnerIdx] ? props[winnerIdx].name : report.overview?.winner_name
  const confLabel = rec?.confidence && ['high', 'medium', 'low'].includes(rec.confidence) ? t(`compare.conf.${rec.confidence}`) : ''
  const clientName = report.client_name || t('clientFallback')

  const DIMS: [string, string][] = [
    ['investment', t('compare.dim.investment')],
    ['lifestyle', t('compare.dim.lifestyle')],
    ['location', t('compare.dim.location')],
    ['value', t('compare.dim.value')],
  ]

  type RowDef = { label: string; render: (p: any) => React.ReactNode; val: (p: any) => number | null; best?: 'max' | 'min' }
  const rows: RowDef[] = [
    { label: t('compare.row.area'), render: (p) => p.area || '—', val: () => null },
    { label: t('compare.row.minPrice'), render: (p) => <Dh v={p.min_price ?? p.net?.buy} lang={lang} />, val: (p) => (p.min_price ?? p.net?.buy ?? null), best: 'min' },
    { label: t('compare.row.yield'), render: (p) => (p.area_metrics?.rental_yield_pct != null ? `${Number(p.area_metrics.rental_yield_pct).toFixed(1)}%` : '—'), val: (p) => p.area_metrics?.rental_yield_pct ?? null, best: 'max' },
    { label: t('compare.row.growth'), render: (p) => (p.area_metrics?.price_growth_pct != null ? `${Number(p.area_metrics.price_growth_pct).toFixed(1)}%` : '—'), val: (p) => p.area_metrics?.price_growth_pct ?? null, best: 'max' },
    { label: t('compare.row.netAnnual'), render: (p) => (p.net?.net_annualized_pct != null ? `${p.net.net_annualized_pct}%` : '—'), val: (p) => p.net?.net_annualized_pct ?? null, best: 'max' },
    { label: t('compare.row.payback'), render: (p) => (p.projection?.payback_years != null ? t('compare.years', { n: p.projection.payback_years }) : '—'), val: (p) => p.projection?.payback_years ?? null, best: 'min' },
  ]

  const bestIdxOf = (row: RowDef): number => {
    if (!row.best) return -1
    let bi = -1, bv = row.best === 'max' ? -Infinity : Infinity
    props.forEach((p, i) => {
      const v = row.val(p)
      if (v == null) return
      if ((row.best === 'max' && v > bv) || (row.best === 'min' && v < bv)) { bv = v; bi = i }
    })
    return bi
  }

  return (
    <div dir={lang === 'ar' ? 'rtl' : 'ltr'} className="relative min-h-screen bg-slate-100 pb-28 print:bg-white print:pb-0">
      <style>{`@media print { .no-print{display:none!important} .pg{box-shadow:none!important;margin:0!important} body{background:#fff} }`}</style>

      <TopBar title={t('compare.title')} t={t} />

      <div className="pg relative mx-auto my-4 max-w-3xl bg-white p-6 shadow-sm print:my-0 sm:p-8">
        <AgentStamp agent={agent} t={t} />

        <div className="pe-24">
          <div className="text-[11px] font-semibold text-teal-600">{t('compare.kicker', { name: clientName })}</div>
          <h1 className="text-2xl font-extrabold text-slate-900">{t('compare.heading', { name: clientName })}</h1>
          <div className="text-sm text-slate-500">{t('compare.subtitle', { n: props.length })}</div>
        </div>

        {/* AI 裁定 */}
        {cmp && (
          <>
            {rec && winnerName && (
              <div className="mt-6 rounded-2xl border border-teal-200 bg-teal-50/60 p-4">
                <div className="flex items-center gap-2 text-[11px] font-semibold text-teal-600"><Star className="h-3.5 w-3.5 text-amber-400" />{t('compare.aiPick')}</div>
                <div className="mt-1 flex flex-wrap items-baseline gap-2">
                  <span className="text-xl font-extrabold text-slate-900">{winnerName}</span>
                  {confLabel && <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-teal-700 ring-1 ring-teal-200">{t('compare.confidence', { level: confLabel })}</span>}
                </div>
                {Array.isArray(rec.reasons) && rec.reasons.length > 0 && (
                  <ul className="mt-2.5 space-y-1.5">
                    {rec.reasons.map((reason: string, i: number) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-slate-700"><span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-teal-500" />{reason}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {cmp.summary && (
              <Section title={t('compare.summary')} icon={<ListChecks className="h-4 w-4 text-teal-500" />}>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-600">{cmp.summary}</p>
              </Section>
            )}

            {cmp.dimensions && (
              <Section title={t('compare.dims')} icon={<Star className="h-4 w-4 text-amber-400" />}>
                <div className="space-y-4">
                  {DIMS.map(([key, label]) => {
                    const dim = cmp.dimensions[key]
                    if (!dim) return null
                    const scores: number[] = Array.isArray(dim.scores) ? dim.scores : []
                    const maxScore = Math.max(1, ...scores)
                    return (
                      <div key={key}>
                        <div className="mb-1.5 text-xs font-bold text-slate-700">{label}</div>
                        {scores.length > 0 && (
                          <div className="mb-2 space-y-1.5">
                            {props.map((p, i) => (
                              <div key={i} className="flex items-center gap-2">
                                <span className="w-24 flex-shrink-0 truncate text-[11px] text-slate-500">{p.name}</span>
                                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-teal-500" style={{ width: `${Math.min(100, ((scores[i] ?? 0) / maxScore) * 100)}%` }} /></div>
                                <span className="w-7 flex-shrink-0 text-end text-[11px] font-semibold text-slate-700">{scores[i] ?? '—'}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {dim.explanation && <p className="text-sm text-slate-600">{dim.explanation}</p>}
                      </div>
                    )
                  })}
                </div>
              </Section>
            )}

            {cmp.personalizedAdvice && (
              <Section title={t('compare.advice', { name: clientName })} icon={<ShieldCheck className="h-4 w-4 text-teal-500" />}>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-600">{cmp.personalizedAdvice}</p>
              </Section>
            )}
          </>
        )}

        {/* 并排对比表 */}
        <Section title={cmp ? t('compare.keyMetrics') : t('compare.dataCompare')} icon={<TrendingUp className="h-4 w-4 text-teal-500" />}>
          <div className="overflow-x-auto rounded-xl border border-slate-100">
            <table className="w-full min-w-[480px] border-collapse text-sm">
              <thead>
                <tr>
                  <th className="sticky start-0 z-10 bg-white p-2.5 text-start text-[11px] font-semibold text-slate-400" />
                  {props.map((p, i) => (
                    <th key={i} className={`min-w-[120px] border-s border-slate-100 p-2.5 align-top ${i === winnerIdx ? 'bg-teal-50/70' : 'bg-slate-50/60'}`}>
                      {p.primary_image && <img src={p.primary_image} alt={p.name} className="mb-1.5 h-16 w-full rounded-lg object-cover" />}
                      <div className="flex items-center gap-1 text-xs font-bold text-slate-800">{p.name}{i === winnerIdx && <Star className="h-3 w-3 flex-shrink-0 text-amber-400" />}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => {
                  const bi = bestIdxOf(row)
                  return (
                    <tr key={ri} className="border-t border-slate-50">
                      <td className="sticky start-0 z-10 bg-white p-2.5 text-start text-xs text-slate-500">{row.label}</td>
                      {props.map((p, i) => (
                        <td key={i} className={`border-s border-slate-100 p-2.5 text-center ${i === winnerIdx ? 'bg-teal-50/50' : ''} ${i === bi ? 'font-bold text-teal-700' : 'text-slate-700'}`}>
                          {row.render(p)}
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Section>

        {/* 市场与政策 */}
        {report.market && Array.isArray(report.market.policy) && report.market.policy.length > 0 && (
          <Section title={t('section.market')} icon={<ShieldCheck className="h-4 w-4 text-teal-500" />}>
            <ul className="space-y-1.5">
              {report.market.policy.map((pol: string, i: number) => (
                <li key={i} className="flex items-start gap-2 text-sm text-slate-600"><span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-teal-400" />{pol}</li>
              ))}
            </ul>
          </Section>
        )}
      </div>

      <ContactBar agent={agent} t={t} />
    </div>
  )
}

function NearbySection({ title, icon, intro, items }: { title: string; icon: React.ReactNode; intro: string; items: any[] }) {
  return (
    <Section title={title} icon={icon}>
      <p className="mb-2 text-sm text-slate-600">{intro}</p>
      <div className="flex flex-wrap gap-1.5">
        {items.slice(0, 8).map((m, k) => (
          <span key={k} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">{m.name} · {km(m.distance_m)}</span>
        ))}
      </div>
    </Section>
  )
}

function Row({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between px-3 py-2 ${strong ? 'bg-teal-50/50' : ''} border-b border-slate-50 last:border-0`}>
      <span className="text-slate-500">{label}</span><span className="font-medium text-slate-800">{value}</span>
    </div>
  )
}

function RadarChart({ data }: { data: { k: string; v: number }[] }) {
  const N = data.length, R = 64, cx = 110, cy = 100
  const ang = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / N
  const pt = (i: number, rad: number) => [cx + Math.cos(ang(i)) * rad, cy + Math.sin(ang(i)) * rad]
  const poly = data.map((d, i) => pt(i, R * Math.max(0.06, d.v / 100)).map((n) => n.toFixed(1)).join(',')).join(' ')
  const rings = [0.25, 0.5, 0.75, 1].map((f) => data.map((_, i) => pt(i, R * f).join(',')).join(' '))
  return (
    <svg viewBox="0 0 220 200" style={{ width: 240, maxWidth: '100%' }}>
      {rings.map((g, i) => <polygon key={i} points={g} fill="none" stroke="#e2e8f0" strokeWidth="1" />)}
      {data.map((_, i) => { const [x, y] = pt(i, R); return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="#e2e8f0" strokeWidth="1" /> })}
      <polygon points={poly} fill="#14b8a6" fillOpacity="0.25" stroke="#0d9488" strokeWidth="2" />
      {data.map((d, i) => { const [x, y] = pt(i, R + 16); return <text key={i} x={x} y={y} fontSize="10" fontWeight="600" textAnchor="middle" fill="#64748b" dominantBaseline="middle">{d.k}</text> })}
    </svg>
  )
}

function TrendChart({ trend }: { trend: { m: string; v: number | null }[] }) {
  const pts = trend.map((t, i) => ({ v: t.v, i })).filter((p) => p.v != null) as { v: number; i: number }[]
  if (pts.length < 2) return null
  const W = 320, H = 96, padL = 34, padR = 6, padT = 6, padB = 16
  const min = Math.min(...pts.map((p) => p.v)), max = Math.max(...pts.map((p) => p.v)), span = max - min || 1
  const x = (i: number) => padL + (i / (trend.length - 1)) * (W - padL - padR)
  const y = (v: number) => H - padB - ((v - min) / span) * (H - padT - padB)
  const line = pts.map((p, k) => `${k === 0 ? 'M' : 'L'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')
  const fill = `${line} L${x(pts[pts.length - 1].i).toFixed(1)},${H - padB} L${x(pts[0].i).toFixed(1)},${H - padB} Z`
  const fmtK = (v: number) => `${Math.round(v / 1000)}k`
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 110 }}>
      <defs><linearGradient id="tg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0d9488" stopOpacity="0.18" /><stop offset="100%" stopColor="#0d9488" stopOpacity="0" /></linearGradient></defs>
      <line x1={padL} y1={padT} x2={padL} y2={H - padB} stroke="#cbd5e1" strokeWidth="1" />
      <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="#cbd5e1" strokeWidth="1" />
      <text x={padL - 4} y={y(max)} fontSize="8" textAnchor="end" fill="#94a3b8" dominantBaseline="middle">{fmtK(max)}</text>
      <text x={padL - 4} y={y(min)} fontSize="8" textAnchor="end" fill="#94a3b8" dominantBaseline="middle">{fmtK(min)}</text>
      <text x={2} y={padT + 4} fontSize="7" fill="#94a3b8">AED/㎡</text>
      <text x={padL} y={H - 4} fontSize="8" textAnchor="start" fill="#94a3b8">{trend[0]?.m}</text>
      <text x={W - padR} y={H - 4} fontSize="8" textAnchor="end" fill="#94a3b8">{trend[trend.length - 1]?.m}</text>
      <path d={fill} fill="url(#tg)" /><path d={line} fill="none" stroke="#0d9488" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  )
}

function GrowthCurve({ start, end }: { start: number; end: number }) {
  if (!start || !end || end <= start) return null
  const rate = Math.pow(end / start, 1 / 5) - 1
  const pts = Array.from({ length: 6 }, (_, i) => start * Math.pow(1 + rate, i))
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
  return <div className="mt-6"><div className="mb-3 flex items-center gap-2">{icon}<h3 className="text-sm font-bold text-slate-800">{title}</h3></div>{children}</div>
}
function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="rounded-lg bg-slate-50 px-2.5 py-1.5"><div className="text-[11px] text-slate-400">{label}</div><div className="mt-0.5 text-sm font-bold text-slate-800">{value}</div></div>
}
