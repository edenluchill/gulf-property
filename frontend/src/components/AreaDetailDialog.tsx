import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Building2, Sparkles, BadgeCheck } from 'lucide-react'
import { DubaiArea } from '../types'
import { formatMoneyCompact, formatMoneyFull } from '../lib/money'
import { fetchAreaInsights, AreaInsights } from '../lib/api'
import DirhamSymbol from './DirhamSymbol'

interface DeveloperSummary {
  name: string
  logoUrl?: string
  projectCount: number
  projectNames: string[]
}

interface AreaDetailDialogProps {
  isOpen: boolean
  onClose: () => void
  area: DubaiArea | null
  projects: any[]
  isLoading: boolean
}

// ── 迷你趋势图（无依赖 SVG）────────────────────────────────────────────────

function SparkLine({ data, color, showZero }: { data: (number | null)[]; color: string; showZero?: boolean }) {
  const w = 132, h = 36
  const vals = data.filter((v): v is number => v != null)
  if (vals.length < 2) {
    return <div className="flex h-9 items-center text-[10px] text-slate-300">—</div>
  }
  const min = Math.min(...vals, showZero ? 0 : Infinity)
  const max = Math.max(...vals, showZero ? 0 : -Infinity)
  const span = Math.max(max - min, 1e-9)
  const y = (v: number) => h - 3 - ((v - min) / span) * (h - 6)
  const pts: [number, number][] = []
  data.forEach((v, i) => {
    if (v != null) pts.push([(i / Math.max(data.length - 1, 1)) * w, y(v)])
  })
  const line = pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
  const fill = `${pts[0][0].toFixed(1)},${h} ${line} ${pts[pts.length - 1][0].toFixed(1)},${h}`
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-9 w-full" preserveAspectRatio="none">
      {showZero && min < 0 && max > 0 && (
        <line x1={0} x2={w} y1={y(0)} y2={y(0)} stroke="#cbd5e1" strokeWidth={1} strokeDasharray="3,3" />
      )}
      <polygon points={fill} fill={color} opacity={0.1} />
      <polyline points={line} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function SparkBars({ data, color }: { data: number[]; color: string }) {
  const w = 132, h = 36
  if (!data.length) return <div className="flex h-9 items-center text-[10px] text-slate-300">—</div>
  const max = Math.max(...data, 1)
  const bw = w / data.length
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-9 w-full" preserveAspectRatio="none">
      {data.map((v, i) => {
        const bh = Math.max((v / max) * (h - 4), v > 0 ? 1.5 : 0)
        return <rect key={i} x={i * bw + 0.5} y={h - bh} width={Math.max(bw - 1, 1)} height={bh} fill={color} opacity={0.55} rx={1} />
      })}
    </svg>
  )
}

function StatCard({ label, value, valueClass = 'text-slate-900', chip, chipClass, loading, children }: {
  label: string
  value: ReactNode
  valueClass?: string
  chip?: string | null
  chipClass?: string
  loading?: boolean
  children?: ReactNode
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
      <div className="flex items-center justify-between gap-1">
        <span className="truncate text-xs font-medium text-slate-500">{label}</span>
        {chip && (
          <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${chipClass || 'bg-slate-100 text-slate-500'}`}>
            {chip}
          </span>
        )}
      </div>
      <div className={`mt-1 flex items-center gap-1 text-lg font-bold leading-tight ${valueClass}`}>{value}</div>
      <div className="mt-2">
        {loading ? <div className="h-9 animate-pulse rounded bg-slate-100" /> : children}
      </div>
    </div>
  )
}

export default function AreaDetailDialog({ isOpen, onClose, area, projects, isLoading }: AreaDetailDialogProps) {
  const { t, i18n } = useTranslation(['map', 'common'])
  const lang = i18n.language || 'en'
  const langKey = lang.split('-')[0] // 'zh-CN' → 'zh'
  const tr = area?.translations?.[langKey ?? '']
  const isTranslated = !!tr

  // 四指标月度序列 + 近期成交（按区域懒加载，后端缓存 6h）
  const [insights, setInsights] = useState<AreaInsights | null>(null)
  const [insightsLoading, setInsightsLoading] = useState(false)
  useEffect(() => {
    if (!isOpen || !area?.id) return
    let stale = false
    setInsights(null)
    setInsightsLoading(true)
    fetchAreaInsights(area.id).then(d => {
      if (stale) return
      setInsights(d)
      setInsightsLoading(false)
    })
    return () => { stale = true }
  }, [isOpen, area?.id])

  // Group projects by developer
  const developers: DeveloperSummary[] = useMemo(() => {
    if (!projects || projects.length === 0) return []
    const map = new Map<string, DeveloperSummary>()
    for (const p of projects) {
      const dev = p.developer || 'Unknown'
      if (!map.has(dev)) {
        map.set(dev, {
          name: dev,
          logoUrl: p.developerLogoUrl,
          projectCount: 0,
          projectNames: [],
        })
      }
      const entry = map.get(dev)!
      entry.projectCount++
      if (entry.projectNames.length < 5) {
        entry.projectNames.push(p.buildingName || p.projectName || '')
      }
    }
    return Array.from(map.values()).sort((a, b) => b.projectCount - a.projectCount)
  }, [projects])

  if (!isOpen || !area) return null

  const lastNonNull = (arr: (number | null)[] | undefined) => {
    if (!arr) return null
    for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i]
    return null
  }
  const growthNow = area.capitalAppreciation ?? lastNonNull(insights?.growth)
  const yieldNow = area.rentalYield ?? lastNonNull(insights?.rentalYield)
  const pctChip = (v: number | null | undefined) =>
    v == null ? null : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[10000]"
        onClick={onClose}
      />

      {/* Dialog */}
      <div
        className="fixed z-[10001] bg-white rounded-2xl shadow-2xl w-[1020px] max-h-[82vh] overflow-hidden flex"
        style={{
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
        }}
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-[10002] p-2 bg-white rounded-full shadow-lg hover:bg-gray-100 transition-colors"
        >
          <X className="w-5 h-5 text-gray-700" />
        </button>

        {/* Left Panel - Area Info & Trend Charts */}
        <div className="w-[420px] flex flex-col overflow-y-auto border-r border-slate-200">
          {/* Area Header */}
          <div className="px-6 pt-6 pb-4 border-b border-slate-100">
            <div className="flex items-center gap-2.5 mb-1">
              <div
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: area.color }}
              />
              <h2 className="font-bold text-2xl text-slate-900">{(isTranslated && tr?.name) || area.name}</h2>
            </div>
            {isTranslated && tr?.name && (
              <p className="text-sm text-slate-400 ml-[22px] mt-0.5">{area.name}</p>
            )}
            {!isTranslated && area.nameAr && (
              <p className="text-sm text-slate-500 font-arabic ml-[22px] mt-1">{area.nameAr}</p>
            )}
            {(isTranslated && tr?.description) ? (
              <p className="text-sm text-slate-600 mt-3 leading-relaxed">{tr.description}</p>
            ) : area.description ? (
              <p className="text-sm text-slate-600 mt-3 leading-relaxed">{area.description}</p>
            ) : null}
          </div>

          {/* Market Trends - 四指标各配 24 个月走势 */}
          <div className="px-6 py-5">
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
              {t('map:areaDialog.marketStatistics')}
            </h4>
            <div className="grid grid-cols-2 gap-3">
              <StatCard
                label={`${t('map:areaDialog.avgPrice')} (AED/m²)`}
                value={
                  area.medianPriceSqm != null ? (
                    <>
                      <DirhamSymbol size="0.75em" className="text-slate-400" />
                      {formatMoneyFull(area.medianPriceSqm)}
                    </>
                  ) : area.averagePrice != null ? (
                    <>
                      <DirhamSymbol size="0.75em" className="text-slate-400" />
                      {formatMoneyFull(area.averagePrice)}
                    </>
                  ) : '—'
                }
                chip={pctChip(growthNow)}
                chipClass={growthNow != null && growthNow >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'}
                loading={insightsLoading}
              >
                <SparkLine data={insights?.price || []} color="#0d9488" />
              </StatCard>

              <StatCard
                label={t('map:areaDialog.transactionCount')}
                value={area.transactionCount != null ? area.transactionCount.toLocaleString() : '—'}
                loading={insightsLoading}
              >
                <SparkBars data={insights?.volume || []} color="#3b82f6" />
              </StatCard>

              <StatCard
                label={t('map:areaDialog.capitalGrowth')}
                value={growthNow != null ? `${growthNow >= 0 ? '+' : ''}${growthNow.toFixed(1)}%` : '—'}
                valueClass={growthNow != null && growthNow >= 0 ? 'text-emerald-600' : 'text-rose-600'}
                loading={insightsLoading}
              >
                <SparkLine data={insights?.growth || []} color={growthNow != null && growthNow >= 0 ? '#059669' : '#e11d48'} showZero />
              </StatCard>

              <StatCard
                label={t('map:areaDialog.rentalYield')}
                value={yieldNow != null ? `${yieldNow.toFixed(1)}%` : '—'}
                loading={insightsLoading}
              >
                <SparkLine data={insights?.rentalYield || []} color="#7c3aed" />
              </StatCard>
            </div>
            <p className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-400">
              <BadgeCheck className="h-3.5 w-3.5 text-emerald-500" />
              {t('map:areaDialog.dldSource', { month: insights?.dataThrough || '—' })}
            </p>
          </div>

          {/* Area Tags */}
          {(area.areaType || area.wealthLevel || area.culturalAttribute) && (
            <div className="px-6 pb-6">
              <div className="flex flex-wrap gap-2 pt-3 border-t border-slate-100">
                {area.areaType && (
                  <span className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
                    {area.areaType}
                  </span>
                )}
                {area.wealthLevel && (
                  <span className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
                    {area.wealthLevel}
                  </span>
                )}
                {area.culturalAttribute && (
                  <span className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
                    {area.culturalAttribute}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* AI Analysis Section */}
          {(area.aiSummary || tr?.aiSummary || area.areaCategory) && (
            <div className="px-6 pb-6">
              <div className="pt-3 border-t border-slate-100">
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles className="w-4 h-4 text-purple-500" />
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    AI Analysis
                  </h4>
                  {area.areaCategory && (
                    <span className="ml-auto inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-purple-50 text-purple-700 border border-purple-200">
                      {area.areaCategory}
                    </span>
                  )}
                </div>
                {(tr?.aiSummary || area.aiSummary) && (
                  <p className="text-sm text-slate-600 leading-relaxed">
                    {tr?.aiSummary || area.aiSummary}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right Panel - Developers + 近期真实成交 */}
        <div className="flex-1 flex flex-col bg-slate-50 min-w-0">
          <div className="flex-1 overflow-y-auto p-4 pr-14 space-y-4">
            {/* Developers（有才显示，不再放大空状态） */}
            {isLoading ? (
              <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
                <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-blue-600" />
                {t('map:areaDialog.loadingDevelopers')}
              </div>
            ) : developers.length > 0 ? (
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  {t('map:areaDialog.developersInArea', { count: developers.length })}
                </div>
                <div className="space-y-2.5">
                  {developers.map((dev) => (
                    <div
                      key={dev.name}
                      className="bg-white rounded-xl border border-slate-200 p-3.5 hover:border-slate-300 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        {dev.logoUrl ? (
                          <img
                            src={dev.logoUrl}
                            alt={dev.name}
                            className="w-9 h-9 object-contain rounded-lg border border-slate-100"
                          />
                        ) : (
                          <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center">
                            <Building2 className="w-5 h-5 text-slate-400" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-sm text-slate-800 truncate">{dev.name}</div>
                          <div className="text-xs text-slate-500">
                            {t('map:areaDialog.projectCount', { count: dev.projectCount })}
                          </div>
                        </div>
                      </div>
                      {dev.projectNames.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {dev.projectNames.map((name, i) => (
                            <span
                              key={i}
                              className="inline-block px-2 py-0.5 bg-slate-50 text-slate-600 rounded text-[11px] border border-slate-100 truncate max-w-[180px]"
                            >
                              {name}
                            </span>
                          ))}
                          {dev.projectCount > 5 && (
                            <span className="inline-block px-2 py-0.5 text-slate-400 text-[11px]">
                              +{dev.projectCount - 5}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {/* 近期真实成交（DLD）——空开发商时这块撑起右栏，可信度核心 */}
            <div>
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  {t('map:areaDialog.recentTx')}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
                  <BadgeCheck className="h-3 w-3" />
                  Dubai Land Department
                </span>
              </div>
              {insightsLoading ? (
                <div className="space-y-2">
                  {[0, 1, 2, 3].map(i => (
                    <div key={i} className="h-12 animate-pulse rounded-xl bg-white border border-slate-200" />
                  ))}
                </div>
              ) : insights && insights.recentTransactions.length > 0 ? (
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
                  {insights.recentTransactions.map((tx, i) => (
                    <div key={i} className="flex items-center gap-3 px-3.5 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-slate-800">
                          {tx.building || '—'}
                        </div>
                        <div className="mt-0.5 text-xs text-slate-400">
                          {tx.date}
                          {tx.rooms ? ` · ${tx.rooms}` : ''}
                          {tx.sizeSqm ? ` · ${tx.sizeSqm} m²` : ''}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="flex items-center justify-end gap-1 text-sm font-bold text-slate-900">
                          {tx.price != null && <DirhamSymbol size="0.75em" className="text-slate-400" />}
                          {tx.price != null ? formatMoneyCompact(tx.price, lang) : '—'}
                        </div>
                        <span className={`text-[10px] font-medium ${tx.saleType === 'offplan' ? 'text-violet-600' : 'text-emerald-600'}`}>
                          {tx.saleType === 'offplan' ? t('map:areaDialog.offplan') : t('map:areaDialog.ready')}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-400">
                  {t('map:areaDialog.noRecentTx')}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
