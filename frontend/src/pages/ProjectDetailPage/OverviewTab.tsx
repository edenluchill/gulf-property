import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { ResidentialProject, UnitType } from '../../types'
import { ProjectInsights } from '../../lib/api'
import { useTranslation } from 'react-i18next'
import { PriceCheckModule } from './PriceCheckModule'
import InvestmentScorecard from '../../components/project/InvestmentScorecard'
import BuyerConfidence from '../../components/project/BuyerConfidence'

interface OverviewTabProps {
  project: ResidentialProject
  insights?: ProjectInsights | null
}

// 户型占比条的分段配色(相邻分段要能区分,顺序固定:studio,1,2,3,4,5+)
const MIX_COLORS = ['#94a3b8', '#0ea5e9', '#14b8a6', '#8b5cf6', '#f59e0b', '#ef4444']

export function OverviewTab({ project, insights }: OverviewTabProps) {
  const { t, i18n } = useTranslation(['project', 'common'])
  const isZh = (i18n.language || 'en').startsWith('zh')

  // 户型构成(unit mix):按卧室数聚合 unit_count(竞品对比结论——ARO 的
  // availability 占比环是买家速判"这盘偏大户还是小户"的好工具)。
  const unitMix = (() => {
    // 详情接口把 units 拼在 project 上(页面 state 是 any),接口类型里没有
    const units = (project as ResidentialProject & { units?: UnitType[] }).units || []
    const byBeds = new globalThis.Map<number, number>()
    for (const u of units) {
      if (u.bedrooms == null) continue
      byBeds.set(u.bedrooms, (byBeds.get(u.bedrooms) || 0) + (u.unit_count || 1))
    }
    const total = [...byBeds.values()].reduce((s, v) => s + v, 0)
    if (total <= 0) return null
    const rows = [...byBeds.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([beds, count]) => ({
        beds,
        count,
        pct: Math.round((count / total) * 100),
        label: beds === 0 ? (isZh ? '工作室' : 'Studio') : (isZh ? `${beds}室` : `${beds} BR`),
        color: MIX_COLORS[Math.min(beds, MIX_COLORS.length - 1)],
      }))
    return { rows, total }
  })()

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'upcoming': return t('common:status.upcoming')
      case 'under-construction': return t('common:status.underConstruction')
      case 'completed': return t('common:status.completed')
      case 'handed-over': return t('common:status.handedOver')
      default: return status
    }
  }

  return (
    <div className="space-y-6">
    {/* Investment outlook — the hero of this investment-focused page */}
    {insights?.investment && (
      <InvestmentScorecard
        insights={insights}
        area={project.area}
        bedrooms={project.min_bedrooms}
        offplan={project.status === 'upcoming' || project.status === 'under-construction'}
        lang={i18n.language}
      />
    )}

    {/* Investor-confidence: Golden Visa, freehold/tax-free, build progress + handover */}
    <BuyerConfidence project={project} />

    <Card>
      <CardHeader>
        <CardTitle>{t('project:overview.aboutProject')}</CardTitle>
      </CardHeader>
      <CardContent>
        {project.description ? (
          <p className="text-slate-600 leading-relaxed whitespace-pre-line">{project.description}</p>
        ) : (
          <p className="text-slate-600 leading-relaxed">
            {project.project_name} is a premium off-plan development by {project.developer} 
            located in {project.area}, Dubai. This {getStatusLabel(project.status)} project 
            offers {project.min_bedrooms === project.max_bedrooms ? 
            `${project.min_bedrooms}-bedroom` : 
            `${project.min_bedrooms} to ${project.max_bedrooms}-bedroom`} units.
          </p>
        )}
        
        {/* Project Statistics */}
        <div className="mt-6 grid grid-cols-2 md:grid-cols-3 gap-4">
          <div className="p-4 bg-slate-50 rounded-lg">
            <div className="text-2xl font-bold text-primary">{project.total_units}</div>
            <div className="text-sm text-slate-600">{t('project:overview.totalUnits')}</div>
          </div>
          <div className="p-4 bg-slate-50 rounded-lg">
            <div className="text-2xl font-bold text-primary">{project.total_unit_types}</div>
            <div className="text-sm text-slate-600">{t('project:overview.unitTypes')}</div>
          </div>
          {project.verified && (
            <div className="p-4 bg-slate-50 rounded-lg">
              <div className="text-2xl font-bold text-primary">✓</div>
              <div className="text-sm text-slate-600">Verified</div>
            </div>
          )}
        </div>

        {/* 户型构成:横向堆叠条 + 图例(按卧室数聚合 unit_count) */}
        {unitMix && (
          <div className="mt-6">
            <div className="mb-2 flex items-baseline justify-between">
              <div className="text-sm font-semibold text-slate-800">{isZh ? '户型构成' : 'Unit mix'}</div>
              <div className="text-xs text-slate-400">
                {isZh ? `共 ${unitMix.total} 套` : `${unitMix.total} units`}
              </div>
            </div>
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
              {unitMix.rows.map(r => (
                <div
                  key={r.beds}
                  style={{ width: `${(r.count / unitMix.total) * 100}%`, background: r.color }}
                  title={`${r.label} ${r.pct}%`}
                />
              ))}
            </div>
            <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
              {unitMix.rows.map(r => (
                <div key={r.beds} className="flex items-center gap-1.5 text-xs text-slate-600">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: r.color }} />
                  <span className="font-medium">{r.label}</span>
                  <span className="text-slate-400">{r.pct}% · {r.count}{isZh ? '套' : ''}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>

      <PriceCheckModule projectId={project.id} />
    </div>
  )
}
