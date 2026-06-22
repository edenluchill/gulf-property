import { useTranslation } from 'react-i18next'
import { TrendingUp, Percent, MapPin } from 'lucide-react'
import type { RecommendedArea } from '../../lib/api'
import { formatMoneyCompact } from '../../lib/money'
import DirhamSymbol from '../DirhamSymbol'

interface AreaResultCardProps {
  area: RecommendedArea
  rank?: number
  onViewOnMap: (areaName: string) => void
}

/** sales_count → 置信度档位（recommend_for_budget HAVING >=10，故 10 起步）。 */
function confidenceTier(samples: number): 'high' | 'medium' | 'low' {
  if (samples >= 100) return 'high'
  if (samples >= 30) return 'medium'
  return 'low'
}

export default function AreaResultCard({ area, rank, onViewOnMap }: AreaResultCardProps) {
  const { t, i18n } = useTranslation('findhome')
  const tier = confidenceTier(area.sales_count)
  const tierColor =
    tier === 'high' ? 'text-emerald-600 bg-emerald-50' : tier === 'medium' ? 'text-amber-600 bg-amber-50' : 'text-slate-500 bg-slate-100'

  return (
    <button
      type="button"
      onClick={() => onViewOnMap(area.area_name)}
      className="w-full text-left rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm transition-colors hover:border-primary/40 hover:bg-slate-50"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            {rank != null && (
              <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-white">
                {rank}
              </span>
            )}
            <h4 className="truncate text-sm font-semibold text-slate-900">{area.area_name}</h4>
          </div>
          <div className="mt-1 flex items-center gap-1 text-xs text-slate-500">
            <span>{t('card.median')}:</span>
            <DirhamSymbol />
            <span className="font-medium text-slate-700">{formatMoneyCompact(area.median_price_aed, i18n.language)}</span>
          </div>
        </div>
        <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${tierColor}`}>
          {t(`card.confidence${tier.charAt(0).toUpperCase() + tier.slice(1)}` as 'card.confidenceHigh')}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-slate-50 px-2.5 py-2">
          <div className="flex items-center gap-1 text-[11px] text-slate-500">
            <Percent className="h-3 w-3" />
            {t('card.yield')}
          </div>
          <div className="mt-0.5 text-sm font-bold text-emerald-600">
            {area.gross_yield_pct != null ? `${area.gross_yield_pct}%` : '—'}
          </div>
        </div>
        <div className="rounded-lg bg-slate-50 px-2.5 py-2">
          <div className="flex items-center gap-1 text-[11px] text-slate-500">
            <TrendingUp className="h-3 w-3" />
            {t('card.growth')}
          </div>
          <div className={`mt-0.5 text-sm font-bold ${(area.cagr_3y_pct ?? 0) >= 0 ? 'text-blue-600' : 'text-rose-600'}`}>
            {area.cagr_3y_pct != null ? `${area.cagr_3y_pct > 0 ? '+' : ''}${area.cagr_3y_pct}%` : '—'}
          </div>
        </div>
      </div>

      <div className="mt-2.5 flex items-center justify-between text-[11px] text-slate-400">
        <span>{t('card.samples', { count: area.sales_count })}</span>
        <span className="inline-flex items-center gap-1 font-medium text-primary">
          <MapPin className="h-3 w-3" />
          {t('card.viewOnMap')}
        </span>
      </div>
    </button>
  )
}
