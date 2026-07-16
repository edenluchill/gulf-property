/**
 * 对比分析 tab —— 本盘 vs 区域(回报/价格) + 近期真实成交 + 附近同类项目横评。
 * i18n: t('compare:tab.*')。顶部「怎么看」是可选谦逊导读:给角度,不替客户下结论。
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Lightbulb } from 'lucide-react'
import { ResidentialProject } from '../../types'
import { ProjectInsights } from '../../lib/api'
import { YieldVsAreaModule } from './YieldVsAreaModule'
import { PriceCheckModule } from './PriceCheckModule'
import { RecentDealsCompact } from './RecentDealsCompact'
import { NearbyProjectsCompare } from './NearbyProjectsCompare'

function CompareGuide() {
  const { t } = useTranslation('compare')
  const tk = (k: string) => (t as (k: string) => string)(`tab.${k}`)
  const [open, setOpen] = useState(false)
  const points = [
    [tk('p1t'), tk('p1d')],
    [tk('p2t'), tk('p2d')],
    [tk('p3t'), tk('p3d')],
    [tk('p4t'), tk('p4d')],
  ]
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-4 py-3 text-start">
        <Lightbulb className="h-4 w-4 shrink-0 text-amber-500" />
        <span className="text-sm font-medium text-slate-700">{tk('guideToggle')}</span>
        <ChevronDown className={`ms-auto h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1">
          <p className="mb-3 text-[12px] text-slate-400">{tk('guideIntro')}</p>
          <div className="space-y-3">
            {points.map(([title, detail]) => (
              <div key={title} className="flex gap-2.5">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
                <div className="text-[13px] leading-relaxed text-slate-600"><b className="text-slate-800">{title}</b> —— {detail}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function CompareTab({ project, insights }: { project: ResidentialProject; insights?: ProjectInsights | null }) {
  const { t, i18n } = useTranslation('compare')
  const tk = (k: string) => (t as (k: string) => string)(`tab.${k}`)

  return (
    <div className="container mx-auto px-4 py-6 space-y-6">
      <div>
        <h2 className="text-lg font-bold text-slate-900">{tk('header')}</h2>
        <p className="mt-1 text-sm text-slate-500">{tk('subtitle')}</p>
      </div>

      <CompareGuide />

      {insights?.yield_comparison && <YieldVsAreaModule insights={insights} lang={i18n.language} />}
      <PriceCheckModule projectId={project.id} />
      <RecentDealsCompact projectId={project.id} lang={i18n.language} />
      <NearbyProjectsCompare projectId={project.id} lang={i18n.language} />
    </div>
  )
}
