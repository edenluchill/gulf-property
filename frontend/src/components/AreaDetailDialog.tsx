import { useMemo, useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Building2, Sparkles } from 'lucide-react'
import { DubaiArea } from '../types'
import { getImageUrl } from '../lib/image-utils'
import { satelliteThumbUrl, geomCenter } from '../lib/map/tiles'
import { useAreaInsights, AreaTrendGrid, AreaRecentTx } from './AreaInsightsPanel'
import { CONSUMER_SEGMENT, MarketSegment } from '../lib/marketSegment'

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
  /** 市场口径（地图筛选器联动），缺省取全站默认 */
  segment?: MarketSegment
}

// Usage filter — the dialog shows ALL property types by default; the user can
// narrow to one. The map stays 'all'; this lens lives only here. No data hidden.
const USAGE_FILTER = [
  { v: 'all', zh: '全部', en: 'All' },
  { v: 'residential', zh: '住宅', en: 'Residential' },
  { v: 'commercial', zh: '商业', en: 'Commercial' },
  { v: 'hospitality', zh: '酒店', en: 'Hotel' },
  { v: 'industrial', zh: '工业', en: 'Industrial' },
  { v: 'other', zh: '其他', en: 'Other' },
]

export default function AreaDetailDialog({ isOpen, onClose, area, projects, isLoading, segment = CONSUMER_SEGMENT }: AreaDetailDialogProps) {
  const { t, i18n } = useTranslation(['map', 'common'])
  const zh = (i18n.language || 'en').startsWith('zh')
  const langKey = (i18n.language || 'en').split('-')[0] // 'zh-CN' → 'zh'
  const tr = area?.translations?.[langKey ?? '']
  const isTranslated = !!tr

  // Usage lens lives here (default 全部). Reset to 'all' each time a new area opens.
  const [usage, setUsage] = useState<string>('all')
  // Right-panel tabs — flat 成交 / 租金 / 项目 (charts stay on the left).
  const [tab, setTab] = useState<'sales' | 'rentals' | 'projects'>('sales')
  useEffect(() => { setUsage('all'); setTab('sales') }, [area?.id])

  // 四指标月度序列 + 近期成交（按 usage + 市场口径,后端全区域预热,通常秒回）
  const { insights, loading: insightsLoading } = useAreaInsights(isOpen ? area?.id : undefined, usage, segment)

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

  const desc = (isTranslated && tr?.description) || area.description || null
  const projectTotal = developers.reduce((n, d) => n + d.projectCount, 0)
  // Header photo: prefer a project render from this area; otherwise fall back to a
  // satellite aerial of the area's location so EVERY area gets a recognisable image.
  const projImg: string | null = projects?.find((p: any) => p.primaryImage)?.primaryImage
    || projects?.find((p: any) => p.images?.[0])?.images?.[0] || null
  const center = geomCenter(area.boundary)
  const heroSrc: string | null = projImg
    ? getImageUrl(projImg, 'thumbnail')
    : (center ? satelliteThumbUrl(center.lat, center.lng) : null)

  // Reusable blocks — composed differently on mobile (stacked tabs) vs desktop
  // (2-column: charts left, transactions/projects right).
  const tilesEl = <AreaTrendGrid area={area} insights={insights} loading={insightsLoading} usageActive={usage !== 'all'} />
  const aiEl = (area.aiSummary || tr?.aiSummary) ? (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
      <div className="flex items-center gap-2 mb-1.5">
        <Sparkles className="w-4 h-4 text-purple-500" />
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">AI Analysis</span>
      </div>
      <p className="text-sm text-slate-600 leading-relaxed">{tr?.aiSummary || area.aiSummary}</p>
    </div>
  ) : null
  const devsEl = isLoading ? (
    <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
      <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-blue-600" />
      {t('map:areaDialog.loadingDevelopers')}
    </div>
  ) : developers.length > 0 ? (
    <div className="space-y-2.5">
      {developers.map((dev) => (
        <div key={dev.name} className="bg-white rounded-xl border border-slate-200 p-3.5">
          <div className="flex items-center gap-3">
            {dev.logoUrl ? (
              <img src={dev.logoUrl} alt={dev.name} className="w-9 h-9 object-contain rounded-lg border border-slate-100" />
            ) : (
              <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center">
                <Building2 className="w-5 h-5 text-slate-400" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm text-slate-800 truncate">{dev.name}</div>
              <div className="text-xs text-slate-500">{t('map:areaDialog.projectCount', { count: dev.projectCount })}</div>
            </div>
          </div>
          {dev.projectNames.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {dev.projectNames.map((name, i) => (
                <span key={i} className="inline-block px-2 py-0.5 bg-slate-50 text-slate-600 rounded text-[11px] border border-slate-100 truncate max-w-[180px]">{name}</span>
              ))}
              {dev.projectCount > 5 && <span className="inline-block px-2 py-0.5 text-slate-400 text-[11px]">+{dev.projectCount - 5}</span>}
            </div>
          )}
        </div>
      ))}
    </div>
  ) : (
    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-8 text-center text-sm text-slate-400">
      {zh ? '该区域暂无已收录的项目' : 'No projects on record for this area yet'}
    </div>
  )

  const RIGHT_TABS = [
    { id: 'sales' as const, label: zh ? '成交' : 'Sales' },
    { id: 'rentals' as const, label: zh ? '租金' : 'Rentals' },
    { id: 'projects' as const, label: `${zh ? '项目' : 'Projects'}${projectTotal ? ` (${projectTotal})` : ''}` },
  ]

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[10000]" onClick={onClose} />

      {/* Dialog — centered, FIXED height so switching tabs never resizes the window. */}
      <div className="fixed z-[10001] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col
                      bg-white shadow-2xl rounded-2xl overflow-hidden
                      w-[1000px] max-w-[95vw] h-[78vh] max-h-[760px]">
        {/* Header — small photo on the left, title + description stacked on the right */}
        <div className="flex items-start gap-3.5 px-5 pt-4 pb-3 border-b border-slate-100">
          {heroSrc && (
            <img
              src={heroSrc}
              alt={(isTranslated && tr?.name) || area.name}
              className="h-16 w-24 flex-shrink-0 rounded-xl object-cover ring-1 ring-slate-900/5"
            />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2.5 min-w-0">
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 translate-y-0.5" style={{ backgroundColor: area.color }} />
              <h2 className="font-bold text-xl text-slate-900 truncate">{(isTranslated && tr?.name) || area.name}</h2>
              {isTranslated && tr?.name && <span className="text-sm text-slate-400 truncate flex-shrink-0">{area.name}</span>}
            </div>
            {desc && <p className="mt-1 text-sm text-slate-500 leading-snug line-clamp-2">{desc}</p>}
          </div>
          <button onClick={onClose} className="flex-shrink-0 p-2 -mr-1 rounded-full hover:bg-slate-100 transition-colors">
            <X className="w-5 h-5 text-slate-600" />
          </button>
        </div>

        {/* Usage filter — instantly shows what's measured + how to switch */}
        <div className="px-5 py-2 border-b border-slate-100 flex items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <span className="text-[11px] font-medium text-slate-400 shrink-0">{zh ? '口径' : 'Usage'}</span>
          {USAGE_FILTER.map((u) => (
            <button
              key={u.v}
              onClick={() => setUsage(u.v)}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                usage === u.v ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              }`}
            >
              {zh ? u.zh : u.en}
            </button>
          ))}
        </div>

        {/* 2-column — charts left, flat 成交/租金/项目 tabs right */}
        <div className="flex flex-1 overflow-hidden">
          <div className="w-[380px] overflow-y-auto border-r border-slate-100 p-4 space-y-4">
            {tilesEl}
            {aiEl}
          </div>
          <div className="flex-1 flex flex-col overflow-hidden bg-slate-50/40">
            <div className="px-4 flex gap-1 border-b border-slate-100 bg-white">
              {RIGHT_TABS.map((tb) => (
                <button key={tb.id} onClick={() => setTab(tb.id)}
                  className={`border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                    tab === tb.id ? 'border-teal-500 text-teal-600' : 'border-transparent text-slate-500 hover:text-slate-700'
                  }`}>
                  {tb.label}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {tab === 'projects'
                ? devsEl
                : <AreaRecentTx areaId={area.id} insights={insights} loading={insightsLoading} kind={tab === 'rentals' ? 'rentals' : 'sales'} />}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
