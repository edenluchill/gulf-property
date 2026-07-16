/**
 * 对比分析 tab —— 本盘 vs 区域(回报/价格) + 附近同类项目横评。
 * 把散在概览的 vs-区域对比收敛到这里,再加横向比附近盘,帮买家做决策。
 */
import { useTranslation } from 'react-i18next'
import { ResidentialProject } from '../../types'
import { ProjectInsights } from '../../lib/api'
import { YieldVsAreaModule } from './YieldVsAreaModule'
import { PriceCheckModule } from './PriceCheckModule'
import { NearbyProjectsCompare } from './NearbyProjectsCompare'

export function CompareTab({ project, insights }: { project: ResidentialProject; insights?: ProjectInsights | null }) {
  const { i18n } = useTranslation()
  const zh = (i18n.language || 'en').startsWith('zh')

  return (
    <div className="container mx-auto px-4 py-6 space-y-6">
      <div>
        <h2 className="text-lg font-bold text-slate-900">{zh ? '对比分析' : 'Comparison'}</h2>
        <p className="mt-1 text-sm text-slate-500">
          {zh ? '本盘 vs 所在区域，以及与附近同类项目的横向对比，帮你判断这盘值不值。' : 'This project vs its area, and side-by-side with nearby projects, to judge whether it stacks up.'}
        </p>
      </div>

      {/* 本盘 vs 区域:回报(含价格×租金分解) */}
      {insights?.yield_comparison && <YieldVsAreaModule insights={insights} lang={i18n.language} />}

      {/* 本盘 vs 区域:价格体检 */}
      <PriceCheckModule projectId={project.id} />

      {/* 附近同类项目横评 */}
      <NearbyProjectsCompare projectId={project.id} lang={i18n.language} />
    </div>
  )
}
