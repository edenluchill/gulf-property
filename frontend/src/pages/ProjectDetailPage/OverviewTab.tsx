import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { ResidentialProject } from '../../types'
import { ProjectInsights } from '../../lib/api'
import { useTranslation } from 'react-i18next'
import { PriceCheckModule } from './PriceCheckModule'
import InvestmentScorecard from '../../components/project/InvestmentScorecard'

interface OverviewTabProps {
  project: ResidentialProject
  insights?: ProjectInsights | null
}

export function OverviewTab({ project, insights }: OverviewTabProps) {
  const { t, i18n } = useTranslation(['project', 'common'])

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
    {insights?.investment && <InvestmentScorecard insights={insights} lang={i18n.language} />}

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
      </CardContent>
    </Card>

      <PriceCheckModule projectId={project.id} />
    </div>
  )
}
