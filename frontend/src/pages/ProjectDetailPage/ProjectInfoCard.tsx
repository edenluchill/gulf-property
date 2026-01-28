import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import {
  Heart,
  MapPin,
  Calendar,
  Building2,
  TrendingUp,
  Activity
} from 'lucide-react'
import { formatPrice, formatDate } from '../../lib/utils'
import { ResidentialProject } from '../../types'
import { useTranslation } from 'react-i18next'

interface ProjectInfoCardProps {
  project: ResidentialProject
  isFavorite: boolean
  onToggleFavorite: () => void
}

const statusColors = {
  'upcoming': 'bg-blue-100 text-blue-800',
  'under-construction': 'bg-yellow-100 text-yellow-800',
  'completed': 'bg-green-100 text-green-800',
  'handed-over': 'bg-green-100 text-green-800',
}

export function ProjectInfoCard({ project, isFavorite, onToggleFavorite }: ProjectInfoCardProps) {
  const { t } = useTranslation(['project', 'common'])

  const statusLabels: Record<string, string> = {
    'upcoming': t('common:status.upcoming'),
    'under-construction': t('common:status.underConstruction'),
    'completed': t('common:status.completed'),
    'handed-over': t('common:status.handedOver'),
  }

  return (
    <Card className="h-fit">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex flex-col md:flex-row md:items-center gap-2 mb-2">
              <CardTitle className="text-2xl md:text-3xl">{project.project_name}</CardTitle>
              <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[project.status]} self-start`}>
                {statusLabels[project.status]}
              </span>
            </div>
            <div className="flex items-center text-slate-600 mb-2">
              <Building2 className="h-4 w-4 mr-1" />
              <span className="font-medium">{project.developer}</span>
            </div>
            <div className="flex items-center text-slate-600 mb-4">
              <MapPin className="h-4 w-4 mr-1" />
              <span>{project.area}</span>
            </div>
          </div>
          <Button
            variant={isFavorite ? "default" : "outline"}
            size="icon"
            onClick={onToggleFavorite}
          >
            <Heart className={`h-5 w-5 ${isFavorite ? 'fill-current' : ''}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Price Information */}
        <div>
          <div className="text-sm text-slate-600 mb-1">{t('common:price.startingPrice')}</div>
          <div className="text-2xl md:text-3xl font-bold text-primary">
            {project.starting_price ? formatPrice(project.starting_price) : t('common:price.priceOnApplication')}
          </div>
        </div>

        {/* Property Details */}
        <div className="grid grid-cols-2 gap-4 pt-4 border-t">
          <div>
            <div className="text-sm text-slate-600">{t('common:units.bedrooms')}</div>
            <div className="font-semibold text-lg">
              {project.min_bedrooms === project.max_bedrooms 
                ? `${project.min_bedrooms}` 
                : `${project.min_bedrooms} - ${project.max_bedrooms}`}
            </div>
          </div>
          <div>
            <div className="text-sm text-slate-600">{t('project:infoCard.totalUnits')}</div>
            <div className="font-semibold text-lg">
              {project.total_units}
            </div>
          </div>
        </div>

        {/* Completion Progress */}
        {project.construction_progress !== undefined && (
          <div className="pt-4 border-t">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center text-sm text-slate-600">
                <Activity className="h-4 w-4 mr-1" />
                <span>{t('common:progress.constructionProgress')}</span>
              </div>
              <span className="font-semibold">{project.construction_progress}%</span>
            </div>
            <div className="w-full bg-slate-200 rounded-full h-2">
              <div 
                className="bg-primary h-2 rounded-full transition-all"
                style={{ width: `${project.construction_progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Dates */}
        <div className="space-y-2 pt-4 border-t">
          {project.launch_date && (
            <div className="flex items-center space-x-2 text-slate-600">
              <TrendingUp className="h-4 w-4" />
              <span>{t('common:dates.launchDate')}: {formatDate(project.launch_date)}</span>
            </div>
          )}
          {project.completion_date && (
            <div className="flex items-center space-x-2 text-slate-600">
              <Calendar className="h-4 w-4" />
              <span>{t('common:dates.completionDate')}: {formatDate(project.completion_date)}</span>
            </div>
          )}
        </div>

        {/* CTA Button */}
        <div className="pt-4 border-t">
          <Button className="w-full" size="lg">
            {t('common:buttons.requestInfo')}
          </Button>
          {project.brochure_url && (
            <Button 
              variant="outline" 
              className="w-full mt-2" 
              size="lg"
              onClick={() => window.open(project.brochure_url, '_blank')}
            >
              {t('common:buttons.downloadBrochure')}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
