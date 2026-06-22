import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Loader2, Wallet, Compass } from 'lucide-react'
import {
  fetchAffordability,
  fetchRecommendAreas,
  type AffordabilityResult,
  type RecommendedArea,
  type RecommendGoal,
} from '../../lib/api'
import { formatMoneyCompact } from '../../lib/money'
import DirhamSymbol from '../DirhamSymbol'
import AreaResultCard from './AreaResultCard'

type Tab = 'affordability' | 'recommend'
type Goal = 'self' | 'rent' | 'growth'

// UI goal → backend recommend goal. Self-use isn't a ranking signal on the
// backend (recommend orders by yield/growth), so 'self' maps to 'balanced'.
const GOAL_TO_RECOMMEND: Record<Goal, RecommendGoal> = {
  self: 'balanced',
  rent: 'yield',
  growth: 'growth',
}

const BEDROOM_OPTIONS: { value: number | undefined; labelKey: string }[] = [
  { value: undefined, labelKey: 'bedrooms.any' },
  { value: 0, labelKey: 'bedrooms.studio' },
  { value: 1, labelKey: 'bedrooms.n' },
  { value: 2, labelKey: 'bedrooms.n' },
  { value: 3, labelKey: 'bedrooms.n' },
]

const parseAmount = (raw: string): number | undefined => {
  const n = Number(raw.replace(/[^0-9.]/g, ''))
  return n > 0 ? n : undefined
}

interface FindHomeAssistantProps {
  isOpen: boolean
  onClose: () => void
  /** Fly the map to a recommended/affordable area by its DLD area name. */
  onViewArea: (areaName: string) => void
}

export default function FindHomeAssistant({ isOpen, onClose, onViewArea }: FindHomeAssistantProps) {
  const { t, i18n } = useTranslation('findhome')

  const [tab, setTab] = useState<Tab>('affordability')
  const [goal, setGoal] = useState<Goal>('rent')
  const [bedrooms, setBedrooms] = useState<number | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Affordability inputs
  const [affordMode, setAffordMode] = useState<'income' | 'cash'>('income')
  const [affordValue, setAffordValue] = useState('')
  const [affordResult, setAffordResult] = useState<AffordabilityResult | null>(null)

  // Recommend inputs
  const [budget, setBudget] = useState('')
  const [recommendResult, setRecommendResult] = useState<RecommendedArea[] | null>(null)

  const runAffordability = useCallback(async () => {
    const amount = parseAmount(affordValue)
    if (!amount) {
      setError(t('errors.needInput'))
      return
    }
    setError(null)
    setLoading(true)
    const res = await fetchAffordability({
      [affordMode]: amount,
      bedrooms,
    })
    setLoading(false)
    if (!res) {
      setError(t('errors.failed'))
      return
    }
    setAffordResult(res)
  }, [affordValue, affordMode, bedrooms, t])

  const runRecommend = useCallback(async () => {
    const amount = parseAmount(budget)
    if (!amount) {
      setError(t('errors.needInput'))
      return
    }
    setError(null)
    setLoading(true)
    const res = await fetchRecommendAreas({
      budget: amount,
      goal: GOAL_TO_RECOMMEND[goal],
      bedrooms,
      limit: 5,
    })
    setLoading(false)
    setRecommendResult(res)
  }, [budget, goal, bedrooms, t])

  if (!isOpen) return null

  const goalSelector = (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-slate-500">{t('goal.label')}</label>
      <div className="grid grid-cols-3 gap-1.5">
        {(['self', 'rent', 'growth'] as Goal[]).map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => setGoal(g)}
            className={`rounded-lg px-2 py-2 text-xs font-medium transition-colors ${
              goal === g ? 'bg-primary text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {t(`goal.${g}`)}
          </button>
        ))}
      </div>
    </div>
  )

  const bedroomSelector = (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-slate-500">{t('bedrooms.label')}</label>
      <div className="flex flex-wrap gap-1.5">
        {BEDROOM_OPTIONS.map((opt) => {
          const active = bedrooms === opt.value
          const label =
            opt.value && opt.value > 0 ? t('bedrooms.n', { count: opt.value }) : t(opt.labelKey as 'bedrooms.any')
          return (
            <button
              key={String(opt.value)}
              type="button"
              onClick={() => setBedrooms(opt.value)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                active ? 'bg-primary text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {label}
            </button>
          )
        })}
      </div>
    </div>
  )

  const body = (
    <div className="flex flex-col gap-4">
      {/* Tabs */}
      <div className="flex rounded-xl bg-slate-100 p-1">
        {(['affordability', 'recommend'] as Tab[]).map((tk) => {
          const Icon = tk === 'affordability' ? Wallet : Compass
          return (
            <button
              key={tk}
              type="button"
              onClick={() => {
                setTab(tk)
                setError(null)
              }}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold transition-colors ${
                tab === tk ? 'bg-white text-primary shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {t(`tabs.${tk}`)}
            </button>
          )
        })}
      </div>

      {tab === 'affordability' ? (
        <>
          {/* Income vs cash toggle */}
          <div className="flex rounded-lg border border-slate-200 p-0.5">
            {(['income', 'cash'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setAffordMode(m)}
                className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                  affordMode === m ? 'bg-primary/10 text-primary' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {t(`affordability.inputMode.${m}`)}
              </button>
            ))}
          </div>

          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
              <DirhamSymbol />
            </span>
            <input
              type="text"
              inputMode="numeric"
              value={affordValue}
              onChange={(e) => setAffordValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runAffordability()}
              placeholder={t(`affordability.${affordMode}Placeholder`)}
              className="h-11 w-full rounded-lg border border-slate-200 pl-9 pr-3 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {goalSelector}
          {bedroomSelector}

          <button
            type="button"
            onClick={runAffordability}
            disabled={loading}
            className="flex h-11 items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('affordability.submit')}
          </button>

          {error && <p className="text-center text-xs text-rose-500">{error}</p>}

          {affordResult && !loading && (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-3 gap-2">
                <Stat label={t('affordability.maxPrice')} value={affordResult.max_price_aed} lang={i18n.language} highlight />
                <Stat label={t('affordability.downPayment')} value={affordResult.down_payment_aed} lang={i18n.language} />
                <Stat
                  label={t('affordability.monthlyPayment')}
                  value={affordResult.monthly_payment_aed}
                  lang={i18n.language}
                />
              </div>

              <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
                {t('affordability.assumptions', {
                  downPct: Math.round(affordResult.assumptions.down_pct * 100),
                  rate: +(affordResult.assumptions.rate * 100).toFixed(1),
                  years: affordResult.assumptions.years,
                  dbr: Math.round(affordResult.assumptions.dbr * 100),
                })}
              </p>

              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  {t('affordability.areasTitle')}
                </h3>
                {affordResult.affordable_areas.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    {affordResult.affordable_areas.map((area, i) => (
                      <AreaResultCard key={area.area_name} area={area} rank={i + 1} onViewOnMap={onViewArea} />
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">{t('affordability.empty')}</p>
                )}
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-500">{t('recommend.budgetLabel')}</label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                <DirhamSymbol />
              </span>
              <input
                type="text"
                inputMode="numeric"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && runRecommend()}
                placeholder={t('recommend.budgetPlaceholder')}
                className="h-11 w-full rounded-lg border border-slate-200 pl-9 pr-3 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          {goalSelector}
          {bedroomSelector}

          <button
            type="button"
            onClick={runRecommend}
            disabled={loading}
            className="flex h-11 items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('recommend.submit')}
          </button>

          {error && <p className="text-center text-xs text-rose-500">{error}</p>}

          {recommendResult && !loading && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                {t('recommend.resultsTitle')}
              </h3>
              {recommendResult.length > 0 ? (
                <div className="flex flex-col gap-2">
                  {recommendResult.map((area, i) => (
                    <AreaResultCard key={area.area_name} area={area} rank={i + 1} onViewOnMap={onViewArea} />
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400">{t('recommend.empty')}</p>
              )}
            </div>
          )}
        </>
      )}

      <p className="text-[11px] leading-relaxed text-slate-400">{t('dataNote')}</p>
    </div>
  )

  const header = (
    <div className="flex items-start justify-between border-b border-slate-100 px-4 py-3">
      <div>
        <h2 className="text-base font-bold text-slate-900">{t('title')}</h2>
        <p className="mt-0.5 text-xs text-slate-500">{t('subtitle')}</p>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="-mr-1 rounded-full p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
        aria-label={t('close')}
      >
        <X className="h-5 w-5" />
      </button>
    </div>
  )

  return (
    <>
      {/* Mobile: bottom sheet */}
      <div className="fixed inset-0 z-[1600] md:hidden" onClick={onClose}>
        <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" />
        <div
          className="absolute inset-x-0 bottom-0 flex max-h-[85vh] flex-col rounded-t-2xl bg-white shadow-2xl animate-in slide-in-from-bottom duration-200"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex justify-center pt-2.5">
            <div className="h-1 w-10 rounded-full bg-slate-300" />
          </div>
          {header}
          <div className="overflow-y-auto px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{body}</div>
        </div>
      </div>

      {/* Desktop: floating left panel */}
      <div
        className="fixed bottom-4 left-4 top-20 z-[1600] hidden w-[360px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200 md:flex"
      >
        {header}
        <div className="overflow-y-auto px-4 py-4">{body}</div>
      </div>
    </>
  )
}

function Stat({
  label,
  value,
  lang,
  highlight,
}: {
  label: string
  value: number | null
  lang: string
  highlight?: boolean
}) {
  return (
    <div className={`rounded-lg px-2.5 py-2 ${highlight ? 'bg-primary/10' : 'bg-slate-50'}`}>
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={`mt-0.5 flex items-center gap-0.5 text-sm font-bold ${highlight ? 'text-primary' : 'text-slate-800'}`}>
        {value != null ? (
          <>
            <DirhamSymbol />
            <span>{formatMoneyCompact(value, lang)}</span>
          </>
        ) : (
          <span className="text-slate-400">—</span>
        )}
      </div>
    </div>
  )
}
