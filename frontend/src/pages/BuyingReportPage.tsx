/**
 * AI 买房决策报告 (功能 E)
 * 问卷 → 推荐区域 + 5年区间预测(保守/中性/乐观) + 假设与免责 + 可打印导出
 * 复用功能 C 区域分级 + investment-calculator。预测一律给区间，绝不给单一"稳赚"数字。
 */
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { generateBuyingReport, BuyingReport, Proj5yr } from '../lib/api'

interface AgentBrand { name: string; agency: string; rera: string; phone: string }
const BRAND_KEY = 'pinzos_agent_brand'

const GOAL_VALUES = ['invest_growth', 'invest_rent', 'invest_both', 'self_use', 'self_invest'] as const
const TAG_STYLE: Record<string, string> = {
  growth: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  mature: 'bg-sky-50 text-sky-700 ring-sky-200',
  future: 'bg-violet-50 text-violet-700 ring-violet-200',
  supply_pressure: 'bg-amber-50 text-amber-700 ring-amber-200',
  stable: 'bg-slate-100 text-slate-600 ring-slate-200',
  insufficient: 'bg-slate-100 text-slate-400 ring-slate-200'
}
const f = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('en-US'))

function ScenCol({ title, p, accent }: { title: string; p: Proj5yr | null; accent: string }) {
  const { t: tRaw } = useTranslation('report')
  const t = tRaw as (k: string, o?: Record<string, unknown>) => string
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className={`text-xs font-medium ${accent}`}>{title}</div>
      {p ? (
        <>
          <div className="mt-1 text-lg font-bold text-slate-800">{p.annualized_return_pct}%<span className="text-xs font-normal text-slate-400">{t('scenario.perYear')}</span></div>
          <div className="mt-1 text-[11px] text-slate-500">{t('scenario.totalReturn', { value: f(p.total_profit_5yr) })}</div>
          <div className="text-[11px] text-slate-400">{t('scenario.rentalAndAppreciation', { rental: f(p.rental_income_5yr), appreciation: f(p.appreciation_5yr) })}</div>
        </>
      ) : <div className="mt-1 text-sm text-slate-400">—</div>}
    </div>
  )
}

export default function BuyingReportPage() {
  // casted t:tag/reason/perspective 的键运行时按 tag 拼,过不了 i18next 字面量联合类型。
  const { t: tRaw } = useTranslation(['report', 'common'])
  const t = tRaw as (k: string, o?: Record<string, unknown>) => string
  const [goal, setGoal] = useState('invest_both')
  const [budget, setBudget] = useState('')
  const [report, setReport] = useState<BuyingReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [brand, setBrand] = useState<AgentBrand>({ name: '', agency: '', rera: '', phone: '' })
  const [showBrand, setShowBrand] = useState(false)

  useEffect(() => {
    try {
      const s = localStorage.getItem(BRAND_KEY)
      if (s) setBrand(JSON.parse(s))
    } catch { /* ignore */ }
  }, [])
  const saveBrand = (b: AgentBrand) => {
    setBrand(b)
    try { localStorage.setItem(BRAND_KEY, JSON.stringify(b)) } catch { /* ignore */ }
  }
  const hasBrand = !!(brand.name || brand.agency)

  const run = async () => {
    setLoading(true)
    const r = await generateBuyingReport({
      goal,
      budgetMax: budget ? Number(budget) : undefined
    })
    setReport(r)
    setLoading(false)
  }

  return (
    <div className="flex-1 overflow-auto pb-20 md:pb-8">
    <div className="container mx-auto max-w-5xl px-4 py-6">
      <h1 className="text-2xl font-bold text-slate-800">{t('title')}</h1>
      <p className="mt-1 text-sm text-slate-500">
        {t('description')}
      </p>

      {/* 问卷 */}
      <div className="mt-5 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 print:hidden">
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-xs text-slate-500 sm:col-span-2">
            {t('form.goal')}
            <select value={goal} onChange={e => setGoal(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800">
              {GOAL_VALUES.map(v => <option key={v} value={v}>{t(`goals.${v}`)}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            {t('form.budgetMax')}
            <input value={budget} onChange={e => setBudget(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder={t('form.budgetPlaceholder')}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800" />
          </label>
        </div>
        <button onClick={run} disabled={loading}
          className="mt-4 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-white disabled:opacity-50">
          {loading ? t('form.generating') : t('form.generate')}
        </button>

        {/* 经纪人品牌（可选）—— 报告导出时带自己的署名 */}
        <div className="mt-4 border-t border-slate-100 pt-3">
          <button onClick={() => setShowBrand(s => !s)}
            className="text-xs font-medium text-primary hover:underline">
            {showBrand ? t('brand.collapse') : hasBrand ? t('brand.expandSet') : t('brand.expandOptional')}
          </button>
          {showBrand && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {(['name', 'agency', 'rera', 'phone'] as (keyof AgentBrand)[]).map(k => (
                <label key={k} className="flex flex-col gap-1 text-xs text-slate-500">
                  {t(`brand.${k}`)}
                  <input
                    value={brand[k]}
                    onChange={e => saveBrand({ ...brand, [k]: e.target.value })}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800"
                  />
                </label>
              ))}
              <p className="sm:col-span-2 text-[11px] text-slate-400">
                {t('brand.hint')}
              </p>
            </div>
          )}
        </div>
      </div>

      {report && (
        <div className="mt-6">
          {/* 经纪人品牌抬头（屏幕淡显，打印时完整呈现） */}
          {hasBrand && (
            <div className="mb-4 flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4">
              <div>
                <div className="text-base font-bold text-slate-800">{brand.name || brand.agency}</div>
                <div className="text-xs text-slate-500">
                  {[brand.agency && brand.name ? brand.agency : '', brand.rera && t('brand.reraLabel', { value: brand.rera }), brand.phone]
                    .filter(Boolean).join(' · ')}
                </div>
              </div>
              <div className="text-end text-[11px] text-slate-400">
                {t('brand.poweredBy')}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between print:hidden">
            <div className="text-sm text-slate-500">
              {t('result.goal')}<span className="font-medium text-slate-700">{report.goalLabel}</span>
              {report.budgetMax ? t('result.budget', { value: f(report.budgetMax) }) : ''}
              {t('result.generatedAt', { date: report.generatedAt })}
            </div>
            <button onClick={() => window.print()}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50">
              {t('result.print')}
            </button>
          </div>

          {report.recommendations.length === 0 && (
            <p className="mt-4 text-sm text-slate-400">{t('result.noRecommendations')}</p>
          )}

          <div className="mt-4 space-y-5">
            {report.recommendations.map((r, i) => (
              <div key={i} className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold text-slate-800">#{i + 1} {r.area}</span>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${TAG_STYLE[r.tag] || TAG_STYLE.stable}`}>{t(`tag.${r.tag}`)}</span>
                  </div>
                  <div className="text-xs text-slate-500">
                    {t('result.referencePrice', { price: f(r.assumedPrice), years: r.paybackYears ?? '—' })}
                  </div>
                </div>

                <ul className="mt-3 list-disc ps-5 text-xs text-slate-600 space-y-1">
                  {/* why 现在是 { code, params } —— 后端不再回中文句子。 */}
                  {r.why.map((w, j) => <li key={j}>{t(`reason.${w.code}`, w.params)}</li>)}
                </ul>

                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <ScenCol title={t('scenario.conservative')} p={r.projection.conservative} accent="text-sky-600" />
                  <ScenCol title={t('scenario.neutral')} p={r.projection.neutral} accent="text-slate-700" />
                  <ScenCol title={t('scenario.optimistic')} p={r.projection.optimistic} accent="text-emerald-600" />
                </div>
                {r.dataQualityNote && (
                  <p className="mt-2 text-[11px] text-amber-600">⚠ {t(`dataQuality.${r.dataQualityNote}`)}</p>
                )}

                <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
                  <div><span className="font-medium text-slate-700">{t('result.investPerspective')}</span>{t(`perspective.invest.${r.tag}`)}</div>
                  <div className="mt-1"><span className="font-medium text-slate-700">{t('result.livePerspective')}</span>{t(`perspective.live.${r.tag}`)}</div>
                </div>

                {r.matchingProjects.length > 0 && (
                  <div className="mt-3 text-xs text-slate-500">
                    {t('result.matchingProjects', {
                      count: r.matchingProjects.length,
                      developers: r.matchingProjects.map(p => p.developer).filter(Boolean).join('、') || '—'
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* 假设与免责 —— 必须显著 */}
          <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="text-sm font-semibold text-amber-800">{t('result.assumptionsTitle')}</div>
            <ul className="mt-2 list-disc ps-5 text-xs text-amber-800 space-y-1">
              {report.assumptions.map((a, i) => <li key={i}>{a}</li>)}
            </ul>
            <p className="mt-3 text-xs leading-relaxed text-amber-800">{report.disclaimer}</p>
          </div>
        </div>
      )}
    </div>
    </div>
  )
}
