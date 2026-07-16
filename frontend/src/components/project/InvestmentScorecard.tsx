import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Info, TrendingUp } from 'lucide-react'
import { AreaInvestment, ProjectInsights, fetchAreaInvestment } from '../../lib/api'
import { formatMoneyCompact } from '../../lib/money'
import DirhamSymbol from '../DirhamSymbol'
import ReturnsBar from './ReturnsBar'

/**
 * Investment outlook — the hero of the overview tab for this investment-focused
 * site. Surfaces rental yield, 5yr annualized return, payback and price growth
 * (from /insights), plus a 5yr returns breakdown bar. Honest: always shows the
 * reference price + data-as-of + a not-a-promise disclaimer.
 *
 * Net yield + service charge come from /ai/analytics/investment (area-level DLD),
 * fetched lazily by area + bedrooms. When the area doesn't resolve or has no
 * service-charge data we fall back to gross-only and omit the service-charge line.
 */
export default function InvestmentScorecard({
  insights,
  area,
  bedrooms,
  offplan,
  lang,
}: {
  insights: ProjectInsights
  area?: string | null
  bedrooms?: number | null
  offplan?: boolean | null
  lang: string
}) {
  const { t } = useTranslation('invest')
  const inv = insights.investment
  const insightArea = insights.area

  const [areaInv, setAreaInv] = useState<AreaInvestment | null>(null)
  useEffect(() => {
    let alive = true
    if (!area) {
      setAreaInv(null)
      return
    }
    fetchAreaInvestment(area, bedrooms, offplan).then((d) => {
      if (alive) setAreaInv(d)
    })
    return () => {
      alive = false
    }
  }, [area, bedrooms, offplan])

  if (!inv) return null

  const pct = (v?: number | null) => (v != null ? `${v}%` : '—')

  // 匹配层级词(本开发体/本社区/区域),供多处插值。
  const tierKey = insightArea?.tier === 'development' ? 'tierDev' : insightArea?.tier === 'area' ? 'tierArea' : 'tierZone'
  const unitWord = t(tierKey)

  // Prefer the development-precise gross yield (tier='development') over the
  // coarse area-level one; fall back to area when not development-matched.
  const grossYield =
    (insightArea?.tier === 'development' ? insightArea?.rental_yield_pct : null) ??
    areaInv?.gross_yield_pct ??
    insightArea?.rental_yield_pct
  // Service-charge drag (pct points) from the area net-yield calc, applied to
  // whichever gross we chose — so net stays consistent with the precise gross.
  const scDrag =
    areaInv?.gross_yield_pct != null && areaInv?.net_yield_pct != null
      ? areaInv.gross_yield_pct - areaInv.net_yield_pct
      : null
  const hasNet = scDrag != null && grossYield != null && areaInv?.service_charge_sqft != null
  const headlineYield = hasNet ? Math.round((grossYield! - scDrag!) * 100) / 100 : grossYield
  const headlineLabel = hasNet ? t('netYield') : t('rentalYield')

  const tiles = [
    { label: headlineLabel, value: pct(headlineYield), accent: 'text-teal-600' },
    { label: t('cagr5'), value: pct(inv.annualized_return_pct), accent: 'text-emerald-600' },
    { label: t('payback'), value: inv.payback_years != null ? t('paybackVal', { y: inv.payback_years }) : '—', accent: 'text-slate-800' },
    { label: t('growth', { unit: unitWord }), value: pct(insightArea?.price_growth_pct), accent: 'text-amber-600' },
  ]

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-900/[0.06]">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-teal-50 text-teal-600">
          <TrendingUp className="h-4 w-4" />
        </span>
        <h3 className="text-base font-semibold text-slate-900">{t('outlook')}</h3>
        {insightArea?.label && (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
              insightArea.tier === 'development'
                ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                : 'bg-slate-100 text-slate-600'
            }`}
            title={t('matchTitle')}
          >
            {t(insightArea.tier === 'development' ? 'matchDev' : insightArea.tier === 'area' ? 'matchArea' : 'matchZone')}
            「{insightArea.label}」
            {insightArea.tier === 'development' && t('precise')}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((tl) => (
          <div key={tl.label} className="rounded-xl bg-slate-50 p-3">
            <div className={`text-2xl font-bold ${tl.accent}`}>{tl.value}</div>
            <div className="mt-0.5 text-xs text-slate-500">{tl.label}</div>
          </div>
        ))}
      </div>

      {hasNet && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-teal-50/60 px-3 py-2 text-xs">
          <span className="text-slate-500">
            {t('grossYield')}{' '}
            <span className="font-semibold text-slate-700">{pct(grossYield)}</span>
          </span>
          <span className="text-slate-500">
            {t('serviceCharge')}{' '}
            <span className="font-semibold text-slate-700">
              <DirhamSymbol size="0.85em" className="mx-0.5" />
              {areaInv!.service_charge_sqft}/sqft
            </span>
          </span>
          <span className="inline-flex items-center gap-1 text-slate-400">
            <Info className="h-3 w-3 shrink-0" />
            {t('netFormula')}
          </span>
        </div>
      )}

      <div className="mt-4">
        <div className="mb-1.5 text-xs font-medium text-slate-500">{t('returns5yr')}</div>
        <ReturnsBar rental={inv.rental_income_5yr} appreciation={inv.appreciation_5yr} lang={lang} />
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-slate-400">
        {t('refPrice')}{' '}
        <DirhamSymbol size="0.85em" className="mx-0.5" />
        {formatMoneyCompact(inv.reference_price, lang)}
        {insightArea?.data_through && t('dataThrough', { unit: unitWord, date: insightArea.data_through })}
        {insightArea?.sales_transaction_count ? t('basedOn', { n: insightArea.sales_transaction_count.toLocaleString() }) : ''}
        {t('disclaimer', { unit: unitWord })}
      </p>
    </div>
  )
}
