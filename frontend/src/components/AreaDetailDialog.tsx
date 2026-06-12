import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Building2, Sparkles } from 'lucide-react'
import { DubaiArea } from '../types'
import { useAreaInsights, AreaTrendGrid, AreaRecentTx } from './AreaInsightsPanel'

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

export default function AreaDetailDialog({ isOpen, onClose, area, projects, isLoading }: AreaDetailDialogProps) {
  const { t, i18n } = useTranslation(['map', 'common'])
  const langKey = (i18n.language || 'en').split('-')[0] // 'zh-CN' → 'zh'
  const tr = area?.translations?.[langKey ?? '']
  const isTranslated = !!tr

  // 四指标月度序列 + 近期成交（后端全区域预热，通常秒回）
  const { insights, loading: insightsLoading } = useAreaInsights(isOpen ? area?.id : undefined)

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
            <AreaTrendGrid area={area} insights={insights} loading={insightsLoading} />
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

            {/* 近期真实成交（DLD）——可加载更多 */}
            <AreaRecentTx areaId={area.id} insights={insights} loading={insightsLoading} />
          </div>
        </div>
      </div>
    </>
  )
}
