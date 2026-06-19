// ============================================================================
// ProjectPreviewCard — modern preview shown when a project pin is clicked.
// Used inside a map Popup on desktop and a bottom sheet on mobile. Shows the
// instant info we already have (image/name/price/beds/completion), then fills
// in the intro from the full project once it loads. "View More" goes to the
// full detail page — clicking a pin no longer navigates away immediately.
// ============================================================================

import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X, ArrowRight, BedDouble, CalendarClock, Building2 } from 'lucide-react'
import { MapPinProject, fetchResidentialProjectById } from '../lib/api'
import { getImageUrl } from '../lib/image-utils'
import { formatMoneyCompact } from '../lib/money'
import DirhamSymbol from './DirhamSymbol'

interface ProjectPreviewCardProps {
  project: MapPinProject
  variant: 'popup' | 'sheet'
  onViewMore: () => void
  onClose: () => void
}

// status → localized label + accent color
const STATUS_META: Record<string, { zh: string; en: string; cls: string }> = {
  'upcoming': { zh: '即将发售', en: 'Upcoming', cls: 'bg-violet-500' },
  'under-construction': { zh: '在建', en: 'Under Construction', cls: 'bg-amber-500' },
  'completed': { zh: '已建成', en: 'Completed', cls: 'bg-emerald-500' },
  'handed-over': { zh: '已交付', en: 'Handed Over', cls: 'bg-emerald-600' },
  'sold-out': { zh: '已售罄', en: 'Sold Out', cls: 'bg-rose-600' },
}

export default function ProjectPreviewCard({ project, variant, onViewMore, onClose }: ProjectPreviewCardProps) {
  const { i18n } = useTranslation()
  const lang = i18n.language || 'en'
  const isZh = lang.startsWith('zh')

  // Pull the full project for the intro/description (not in the lightweight pin).
  const [description, setDescription] = useState<string | null>(null)
  const [loadingDesc, setLoadingDesc] = useState(true)

  useEffect(() => {
    let alive = true
    setDescription(null)
    setLoadingDesc(true)
    fetchResidentialProjectById(project.id)
      .then(res => {
        if (!alive) return
        const desc = res?.project?.description
        setDescription(typeof desc === 'string' && desc.trim() ? desc.trim() : '')
      })
      .catch(() => { if (alive) setDescription('') })
      .finally(() => { if (alive) setLoadingDesc(false) })
    return () => { alive = false }
  }, [project.id])

  const priceText = useMemo(() => {
    if (project.minPrice && project.maxPrice && project.minPrice !== project.maxPrice) {
      return `${formatMoneyCompact(project.minPrice, lang)} - ${formatMoneyCompact(project.maxPrice, lang)}`
    }
    const p = project.minPrice || project.maxPrice
    if (p) return isZh ? `${formatMoneyCompact(p, lang)} 起` : `From ${formatMoneyCompact(p, lang)}`
    return null
  }, [project.minPrice, project.maxPrice, lang, isZh])

  const bedText = project.minBeds != null && project.maxBeds != null
    ? (project.minBeds === project.maxBeds ? `${project.minBeds} BR` : `${project.minBeds}-${project.maxBeds} BR`)
    : project.minBeds != null ? `${project.minBeds}+ BR` : null

  const completionText = useMemo(() => {
    if (!project.completionDate) return null
    try {
      const d = new Date(project.completionDate)
      return `Q${Math.ceil((d.getMonth() + 1) / 3)} ${d.getFullYear()}`
    } catch { return null }
  }, [project.completionDate])

  const status = STATUS_META[project.status]
  const isSheet = variant === 'sheet'

  return (
    <div className={`relative bg-white overflow-hidden ${isSheet ? 'w-full rounded-t-2xl' : 'w-[300px] rounded-2xl shadow-2xl'}`}>
      {/* Cover image */}
      <div className={`relative w-full ${isSheet ? 'h-44' : 'h-[150px]'} bg-slate-200`}>
        {project.image ? (
          <img
            src={getImageUrl(project.image, isSheet ? 'medium' : 'thumbnail')}
            alt={project.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-700 to-slate-900">
            <Building2 className="w-8 h-8 text-white/60" />
          </div>
        )}
        {/* subtle bottom gradient for legibility if we ever overlay */}
        <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/25 to-transparent" />

        {/* Status badge */}
        {status && (
          <span className={`absolute top-3 left-3 ${status.cls} text-white text-[11px] font-semibold px-2.5 py-1 rounded-full shadow-sm`}>
            {isZh ? status.zh : status.en}
          </span>
        )}

        {/* Close button */}
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-2.5 right-2.5 w-7 h-7 flex items-center justify-center rounded-full bg-white/90 hover:bg-white text-slate-700 shadow-sm transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Body */}
      <div className="p-4">
        <h3 className="text-[15px] font-bold text-slate-900 leading-snug">{project.name}</h3>
        <p className="mt-0.5 text-[12.5px] text-slate-500 truncate">
          {[project.developer, project.area].filter(Boolean).join(' · ')}
        </p>

        {/* Price */}
        {priceText && (
          <div className="mt-2.5 flex items-center gap-1 text-teal-600 font-bold text-[15px]">
            <DirhamSymbol size="1em" />
            <span>{priceText}</span>
          </div>
        )}

        {/* Fact pills */}
        <div className="mt-2.5 flex flex-wrap gap-2">
          {bedText && (
            <span className="inline-flex items-center gap-1 bg-slate-100 text-slate-600 text-[12px] px-2 py-1 rounded-lg">
              <BedDouble className="w-3.5 h-3.5" /> {bedText}
            </span>
          )}
          {completionText && (
            <span className="inline-flex items-center gap-1 bg-slate-100 text-slate-600 text-[12px] px-2 py-1 rounded-lg">
              <CalendarClock className="w-3.5 h-3.5" /> {completionText}
            </span>
          )}
        </div>

        {/* Intro / description */}
        <div className="mt-3 min-h-[20px]">
          {loadingDesc ? (
            <div className="space-y-1.5">
              <div className="h-2.5 bg-slate-100 rounded w-full animate-pulse" />
              <div className="h-2.5 bg-slate-100 rounded w-4/5 animate-pulse" />
            </div>
          ) : description ? (
            <p className="text-[12.5px] leading-relaxed text-slate-600 line-clamp-3">{description}</p>
          ) : null}
        </div>

        {/* View More */}
        <button
          onClick={onViewMore}
          className="mt-3.5 w-full flex items-center justify-center gap-1.5 bg-teal-600 hover:bg-teal-700 active:bg-teal-800 text-white text-[13.5px] font-semibold py-2.5 rounded-xl transition-colors"
        >
          {isZh ? '查看详情' : 'View More'}
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
