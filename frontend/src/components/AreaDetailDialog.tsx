import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Building2 } from 'lucide-react'
import { DubaiArea } from '../types'

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
  const { t } = useTranslation(['map', 'common'])

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

  const formatValue = (value: number | undefined, type: 'price' | 'volume' | 'percent'): string => {
    if (value === undefined || value === null) return '-'
    if (type === 'percent') return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`
    if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M AED`
    if (value >= 1000) return `${(value / 1000).toFixed(0)}K AED`
    return `${value} AED`
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[10000]"
        onClick={onClose}
      />

      {/* Dialog */}
      <div
        className="fixed z-[10001] bg-white rounded-lg shadow-2xl w-[1000px] max-h-[80vh] overflow-hidden flex"
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

        {/* Left Panel - Area Info & Stats */}
        <div className="w-[400px] flex flex-col overflow-y-auto border-r border-slate-200">
          {/* Area Header */}
          <div className="px-6 pt-6 pb-4 border-b border-slate-100">
            <div className="flex items-center gap-2.5 mb-1">
              <div
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: area.color }}
              />
              <h2 className="font-bold text-2xl text-slate-900">{area.name}</h2>
            </div>
            {area.nameAr && (
              <p className="text-sm text-slate-500 font-arabic ml-[22px] mt-1">{area.nameAr}</p>
            )}
            {area.description && (
              <p className="text-sm text-slate-600 mt-3 leading-relaxed">{area.description}</p>
            )}
          </div>

          {/* Market Statistics */}
          <div className="px-6 py-5">
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">
              {t('map:areaDialog.marketStatistics')}
            </h4>
            <div className="grid grid-cols-2 gap-3">
              {area.projectCounts !== undefined && area.projectCounts > 0 && (
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                  <div className="text-xs text-slate-500 font-medium mb-1.5">{t('map:areaDialog.projects')}</div>
                  <div className="text-2xl font-bold text-slate-900">{area.projectCounts}</div>
                </div>
              )}

              {area.averagePrice !== undefined && area.averagePrice !== null && (
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                  <div className="text-xs text-slate-500 font-medium mb-1.5">{t('map:areaDialog.avgPrice')}</div>
                  <div className="text-xl font-bold text-slate-900">
                    {formatValue(area.averagePrice, 'price')}
                  </div>
                </div>
              )}

              {area.salesVolume !== undefined && area.salesVolume !== null && (
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                  <div className="text-xs text-slate-500 font-medium mb-1.5">{t('map:areaDialog.salesVolume')}</div>
                  <div className="text-xl font-bold text-slate-900">
                    {formatValue(area.salesVolume, 'volume')}
                  </div>
                </div>
              )}

              {area.capitalAppreciation !== undefined && area.capitalAppreciation !== null && (
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                  <div className="text-xs text-slate-500 font-medium mb-1.5">{t('map:areaDialog.capitalGrowth')}</div>
                  <div className={`text-xl font-bold ${area.capitalAppreciation >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {formatValue(area.capitalAppreciation, 'percent')}
                  </div>
                </div>
              )}

              {area.rentalYield !== undefined && area.rentalYield !== null && (
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                  <div className="text-xs text-slate-500 font-medium mb-1.5">{t('map:areaDialog.rentalYield')}</div>
                  <div className="text-xl font-bold text-slate-900">
                    {area.rentalYield.toFixed(1)}%
                  </div>
                </div>
              )}
            </div>
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
        </div>

        {/* Right Panel - Developers */}
        <div className="flex-1 flex flex-col bg-gray-50">
          {/* Header */}
          <div className="p-4 border-b border-gray-200 bg-white">
            <span className="text-sm text-gray-600">
              {isLoading
                ? t('map:areaDialog.loadingDevelopers')
                : t('map:areaDialog.developersInArea', { count: developers.length })}
            </span>
          </div>

          {/* Developer List */}
          <div className="flex-1 overflow-y-auto p-4">
            {isLoading ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center p-4">
                  <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-4 border-blue-600 mb-3"></div>
                  <p className="text-sm text-gray-600">{t('map:areaDialog.loadingDevelopers')}</p>
                </div>
              </div>
            ) : developers.length === 0 ? (
              <div className="flex items-center justify-center h-full text-gray-400">
                <div className="text-center">
                  <Building2 className="h-16 w-16 mx-auto mb-3" />
                  <p className="text-sm">{t('map:areaDialog.noDevelopers')}</p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {developers.map((dev) => (
                  <div
                    key={dev.name}
                    className="bg-white rounded-xl border border-slate-200 p-4 hover:border-slate-300 transition-colors"
                  >
                    <div className="flex items-center gap-3 mb-2">
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
            )}
          </div>
        </div>
      </div>
    </>
  )
}
