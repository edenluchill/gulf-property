import { useMemo, useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Building2, Sparkles } from 'lucide-react'
import { DubaiArea } from '../types'
import { getImageUrl } from '../lib/image-utils'
import { satelliteThumbUrl, geomCenter } from '../lib/map/tiles'
import { useAreaInsights, AreaTrendGrid, AreaRecentTx, AreaPlaceSearch, type AreaPlaceSel } from './AreaInsightsPanel'
import FindAgentChip from './agentMatch/FindAgentChip'
import { CONSUMER_SEGMENT, MarketSegment } from '../lib/marketSegment'

interface DeveloperSummary {
  name: string
  logoUrl?: string
  projectCount: number
  projectNames: string[]
}

/** 右侧面板的 tab —— 也是 collab 同步的 canonical 值(移动 sheet 向下合并到两档)。 */
export type AreaTab = 'sales' | 'rentals' | 'projects'

interface AreaDetailDialogProps {
  isOpen: boolean
  onClose: () => void
  area: DubaiArea | null
  projects: any[]
  isLoading: boolean
  /** 市场口径（地图筛选器联动），缺省取全站默认 */
  segment?: MarketSegment
  /** 受控 tab / 口径 —— collab 带看时由页面提升到 MapPage 并广播给客户。
   *  不传则退回内部自管(普通浏览场景)。 */
  tab?: AreaTab
  usage?: string
  onTabChange?: (tab: AreaTab) => void
  onUsageChange?: (usage: string) => void
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

export default function AreaDetailDialog({
  isOpen, onClose, area, projects, isLoading, segment = CONSUMER_SEGMENT,
  tab: tabProp, usage: usageProp, onTabChange, onUsageChange,
}: AreaDetailDialogProps) {
  const { t, i18n } = useTranslation(['map', 'common', 'misc'])
  const zh = (i18n.language || 'en').startsWith('zh')
  const langKey = (i18n.language || 'en').split('-')[0] // 'zh-CN' → 'zh'
  const tr = area?.translations?.[langKey ?? '']
  const isTranslated = !!tr

  // Usage lens + right-panel tabs (成交 / 租金 / 项目; charts stay on the left).
  //
  // 受控优先:collab 带看时 MapPage 提升这两个状态并广播给客户(经纪切 tab,客户跟着切)。
  // 非受控时退回内部自管 —— 普通浏览不该背 collab 的包袱。
  const [usageLocal, setUsageLocal] = useState<string>('all')
  const [tabLocal, setTabLocal] = useState<AreaTab>('sales')
  const controlled = tabProp !== undefined || usageProp !== undefined
  const usage = usageProp ?? usageLocal
  const tab = tabProp ?? tabLocal
  const setUsage = (u: string) => { onUsageChange ? onUsageChange(u) : setUsageLocal(u) }
  const setTab = (t: AreaTab) => { onTabChange ? onTabChange(t) : setTabLocal(t) }
  // 受控时由 owner 负责重置(MapPage 在 area 变化时重置),这里别抢
  useEffect(() => { if (!controlled) { setUsageLocal('all'); setTabLocal('sales') } }, [area?.id, controlled])

  // 本区内下钻(搜楼盘/楼栋)。状态在这里而不在 AreaRecentTx 里 —— 切到「项目」
  // tab 时那个组件会卸载,选中的地点不能跟着没。
  // TODO: collab 带看时还没广播给客户(tab/usage 已经广播了) —— 经纪下钻到某栋,
  //       客户看到的仍是全区。接 collab 协议时补上。
  const [place, setPlace] = useState<AreaPlaceSel | null>(null)
  useEffect(() => { setPlace(null) }, [area?.id])

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
      {t('misc:noProjectsOnRecord')}
    </div>
  )

  const RIGHT_TABS = [
    { id: 'sales' as const, label: t('misc:sales') },
    { id: 'rentals' as const, label: t('misc:rentals') },
    { id: 'projects' as const, label: `${t('misc:projects')}${projectTotal ? ` (${projectTotal})` : ''}` },
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
          <button onClick={onClose} className="flex-shrink-0 p-2 -me-1 rounded-full hover:bg-slate-100 transition-colors">
            <X className="w-5 h-5 text-slate-600" />
          </button>
        </div>

        {/* Usage filter — instantly shows what's measured + how to switch */}
        <div className="px-5 py-2 border-b border-slate-100 flex items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <span className="text-[11px] font-medium text-slate-400 shrink-0">{t('misc:usage')}</span>
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
          <div className="w-[380px] overflow-y-auto border-e border-slate-100 p-4 space-y-4">
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
            {/* 在本区内搜楼盘/楼栋 —— 只作用于成交/租约。「项目」tab 是我们自己的
                项目库,与 DLD 楼盘名对不上(阿语原名,匹配率极低),拿 DLD 名字去筛
                只会筛出空集,像个 bug —— 所以那个 tab 干脆不给搜索框。 */}
            {tab !== 'projects' && (
              <div className="border-b border-slate-100 bg-white px-4 py-2">
                <AreaPlaceSearch areaId={area.id} value={place} onChange={setPlace} compact />
              </div>
            )}
            <div className="flex-1 overflow-y-auto p-4">
              {tab === 'projects'
                ? devsEl
                : <AreaRecentTx areaId={area.id} areaName={area.name} insights={insights} loading={insightsLoading}
                                kind={tab === 'rentals' ? 'rentals' : 'sales'} place={place} usage={usage} />}
              {/* 「找经纪帮我」放在这里而不是地图别处:`area_detail` 是全站**第一大事件**
                  (30 天 2,339 次,远超房源详情),买家真正停留的地方就是这个弹窗。
                  放在列表下方而不是顶部 —— 先让他看数据,看完了才是想找人的时刻。
                  池子空时组件自己不渲染,不会留个空壳。 */}
              {/* 用 chip + 弹窗,和项目页/地图入口一致 —— 直接铺一张表单会把
                  这个本来就挤的弹窗撑开,而且买家还没想找人时就摆输入框很吵。 */}
              <div className="mt-4 flex justify-center">
                <FindAgentChip standalone />
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
