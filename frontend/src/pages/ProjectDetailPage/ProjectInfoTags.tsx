import { useTranslation } from 'react-i18next'
import { formatPrice } from '../../lib/utils'

interface ProjectInfoTagsProps {
  projectName: string
  minBedrooms?: number
  maxBedrooms?: number
  startingPrice?: number
  completionDate?: string
  variant?: 'desktop' | 'tablet'
}

export function ProjectInfoTags({
  projectName,
  minBedrooms,
  maxBedrooms,
  startingPrice,
  completionDate,
  variant = 'desktop'
}: ProjectInfoTagsProps) {
  const { t } = useTranslation(['project', 'common', 'map'])

  // Format bedroom display
  const formatBedrooms = () => {
    if (minBedrooms === undefined && maxBedrooms === undefined) return null
    if (minBedrooms === maxBedrooms) {
      return minBedrooms === 0 ? t('map:studio', 'Studio') : `${minBedrooms} BR`
    }
    const minStr = minBedrooms === 0 ? t('map:studio', 'Studio') : `${minBedrooms}`
    return `${minStr} - ${maxBedrooms} BR`
  }

  // Format completion date as Quarter + Year
  const formatCompletion = () => {
    if (!completionDate) return null
    const date = new Date(completionDate)
    const quarter = Math.ceil((date.getMonth() + 1) / 3)
    return `Q${quarter} ${date.getFullYear()}`
  }

  const bedrooms = formatBedrooms()
  const completion = formatCompletion()

  // Desktop variant: left and right positioned tags
  if (variant === 'desktop') {
    return (
      <>
        {/* Left tag: Project name + Bedrooms */}
        <div className="absolute bottom-6 start-6 flex flex-col gap-2">
          <div className="backdrop-blur-md bg-black/40 text-white px-4 py-2 rounded-lg">
            <h1 className="text-xl font-bold">{projectName}</h1>
            {bedrooms && (
              <div className="text-sm text-white/80">{bedrooms}</div>
            )}
          </div>
        </div>

        {/* Right tag: Price + Completion */}
        <div className="absolute bottom-6 end-6 flex flex-col items-end gap-2">
          <div className="backdrop-blur-md bg-black/40 text-white px-4 py-2 rounded-lg text-end">
            {startingPrice && (
              <div className="text-xl font-bold">{formatPrice(startingPrice)}+</div>
            )}
            {completion && (
              <div className="text-sm text-white/80">
                {completion} {t('project:completion', 'Completion')}
              </div>
            )}
          </div>
        </div>
      </>
    )
  }

  // Tablet variant: bottom centered single tag
  return (
    <div className="absolute bottom-4 left-4 right-4">
      <div className="backdrop-blur-md bg-black/40 text-white px-4 py-3 rounded-xl">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <span className="font-bold text-lg">{projectName}</span>
            {bedrooms && (
              <>
                <span className="text-white/50">|</span>
                <span className="text-white/90">{bedrooms}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-3">
            {startingPrice && (
              <span className="font-bold">{formatPrice(startingPrice)}+</span>
            )}
            {completion && (
              <>
                <span className="text-white/50">|</span>
                <span className="text-white/90">{completion}</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
