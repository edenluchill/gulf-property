import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, Building2, MapPin, Calendar, DollarSign, Activity, Bed, Home, TrendingUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatPrice, formatDate } from '../../lib/utils'

interface CollapsibleDetailsProps {
  project: {
    project_name: string
    developer: string
    area: string
    starting_price?: number
    min_bedrooms?: number
    max_bedrooms?: number
    total_units?: number
    completion_date?: string
    launch_date?: string
    construction_progress?: number
    status?: string
    description?: string
  }
  paymentPlan?: Array<{
    milestone: string
    percentage: number
    description?: string
  }>
  amenities?: string[]
}

interface SectionProps {
  title: string
  icon: React.ReactNode
  isOpen: boolean
  onToggle: () => void
  children: React.ReactNode
}

function Section({ title, icon, isOpen, onToggle, children }: SectionProps) {
  return (
    <div className="border-b border-slate-200 last:border-b-0">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between py-4 px-1 text-start hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-slate-600">{icon}</span>
          <span className="font-semibold text-slate-900">{title}</span>
        </div>
        <motion.span
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <ChevronDown className="h-5 w-5 text-slate-400" />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="overflow-hidden"
          >
            <div className="pb-4 px-1">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function CollapsibleDetails({ project, paymentPlan, amenities }: CollapsibleDetailsProps) {
  const { t } = useTranslation(['project', 'common'])
  const [openSections, setOpenSections] = useState<Set<string>>(new Set(['info']))

  const toggleSection = (section: string) => {
    setOpenSections(prev => {
      const newSet = new Set(prev)
      if (newSet.has(section)) {
        newSet.delete(section)
      } else {
        newSet.add(section)
      }
      return newSet
    })
  }

  const statusLabels: Record<string, string> = {
    'upcoming': t('common:status.upcoming'),
    'selling': t('common:status.selling'),
    'under-construction': t('common:status.underConstruction'),
    'completed': t('common:status.completed'),
    'handed-over': t('common:status.handedOver'),
    'sold-out': t('common:status.soldOut'),
  }

  const statusColors: Record<string, string> = {
    'upcoming': 'bg-blue-100 text-blue-800',
    'selling': 'bg-emerald-100 text-emerald-800',
    'under-construction': 'bg-yellow-100 text-yellow-800',
    'completed': 'bg-green-100 text-green-800',
    'handed-over': 'bg-green-100 text-green-800',
    'sold-out': 'bg-red-100 text-red-800',
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 mt-8">
      {/* Project Info Section */}
      <Section
        title={t('project:tabs.overview')}
        icon={<Building2 className="h-5 w-5" />}
        isOpen={openSections.has('info')}
        onToggle={() => toggleSection('info')}
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Developer */}
          <div className="bg-slate-50 rounded-lg p-3">
            <div className="text-xs text-slate-500 mb-1">{t('project:infoCard.developer', 'Developer')}</div>
            <div className="font-semibold text-slate-900">{project.developer}</div>
          </div>

          {/* Area */}
          <div className="bg-slate-50 rounded-lg p-3">
            <div className="flex items-center gap-1 text-xs text-slate-500 mb-1">
              <MapPin className="h-3 w-3" />
              {t('project:infoCard.location', 'Location')}
            </div>
            <div className="font-semibold text-slate-900">{project.area}</div>
          </div>

          {/* Price */}
          {project.starting_price && (
            <div className="bg-slate-50 rounded-lg p-3">
              <div className="flex items-center gap-1 text-xs text-slate-500 mb-1">
                <DollarSign className="h-3 w-3" />
                {t('common:price.startingPrice')}
              </div>
              <div className="font-semibold text-primary">{formatPrice(project.starting_price)}</div>
            </div>
          )}

          {/* Bedrooms */}
          {(project.min_bedrooms !== undefined || project.max_bedrooms !== undefined) && (
            <div className="bg-slate-50 rounded-lg p-3">
              <div className="flex items-center gap-1 text-xs text-slate-500 mb-1">
                <Bed className="h-3 w-3" />
                {t('common:units.bedrooms')}
              </div>
              <div className="font-semibold text-slate-900">
                {project.min_bedrooms === project.max_bedrooms
                  ? `${project.min_bedrooms} BR`
                  : `${project.min_bedrooms} - ${project.max_bedrooms} BR`}
              </div>
            </div>
          )}

          {/* Total Units */}
          {project.total_units && (
            <div className="bg-slate-50 rounded-lg p-3">
              <div className="flex items-center gap-1 text-xs text-slate-500 mb-1">
                <Home className="h-3 w-3" />
                {t('project:infoCard.totalUnits')}
              </div>
              <div className="font-semibold text-slate-900">{project.total_units}</div>
            </div>
          )}

          {/* Completion Date */}
          {project.completion_date && (
            <div className="bg-slate-50 rounded-lg p-3">
              <div className="flex items-center gap-1 text-xs text-slate-500 mb-1">
                <Calendar className="h-3 w-3" />
                {t('common:dates.completionDate')}
              </div>
              <div className="font-semibold text-slate-900">{formatDate(project.completion_date)}</div>
            </div>
          )}

          {/* Launch Date */}
          {project.launch_date && (
            <div className="bg-slate-50 rounded-lg p-3">
              <div className="flex items-center gap-1 text-xs text-slate-500 mb-1">
                <TrendingUp className="h-3 w-3" />
                {t('common:dates.launchDate')}
              </div>
              <div className="font-semibold text-slate-900">{formatDate(project.launch_date)}</div>
            </div>
          )}

          {/* Status */}
          {project.status && (
            <div className="bg-slate-50 rounded-lg p-3">
              <div className="text-xs text-slate-500 mb-1">{t('project:status', 'Status')}</div>
              <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[project.status] || 'bg-slate-100 text-slate-800'}`}>
                {statusLabels[project.status] || project.status}
              </span>
            </div>
          )}
        </div>

        {/* Construction Progress — only when we actually have a positive number
            (data is often null → don't render an empty "null%" bar). */}
        {Number(project.construction_progress) > 0 && project.status !== 'sold-out' && (
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <Activity className="h-4 w-4" />
                <span>{t('common:progress.constructionProgress')}</span>
              </div>
              <span className="font-semibold">{Number(project.construction_progress)}%</span>
            </div>
            <div className="w-full bg-slate-200 rounded-full h-2">
              <div
                className="bg-primary h-2 rounded-full transition-all"
                style={{ width: `${Number(project.construction_progress)}%` }}
              />
            </div>
          </div>
        )}

        {/* Description */}
        {project.description && (
          <p className="mt-4 text-slate-600 text-sm leading-relaxed">
            {project.description}
          </p>
        )}
      </Section>

      {/* Payment Plan Section */}
      {paymentPlan && paymentPlan.length > 0 && (
        <Section
          title={t('project:tabs.paymentPlan')}
          icon={<DollarSign className="h-5 w-5" />}
          isOpen={openSections.has('payment')}
          onToggle={() => toggleSection('payment')}
        >
          <div className="space-y-3">
            {paymentPlan.map((milestone, index) => (
              <div key={index} className="flex items-center justify-between bg-slate-50 rounded-lg p-3">
                <div>
                  <div className="font-medium text-slate-900">{milestone.milestone}</div>
                  {milestone.description && (
                    <div className="text-sm text-slate-500">{milestone.description}</div>
                  )}
                </div>
                <div className="font-bold text-primary">{milestone.percentage}%</div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Amenities Section */}
      {amenities && amenities.length > 0 && (
        <Section
          title={t('project:tabs.amenities')}
          icon={<Home className="h-5 w-5" />}
          isOpen={openSections.has('amenities')}
          onToggle={() => toggleSection('amenities')}
        >
          <div className="flex flex-wrap gap-2">
            {amenities.map((amenity, index) => (
              <span
                key={index}
                className="px-3 py-1.5 bg-slate-100 text-slate-700 rounded-full text-sm"
              >
                {amenity}
              </span>
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}
