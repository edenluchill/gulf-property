import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { X, ArrowLeft } from 'lucide-react'
import { Dialog, DialogContent } from '../ui/dialog'
import { Button } from '../ui/button'
import { useAuth } from '../../contexts/AuthContext'
import { useUserProfile } from '../../contexts/UserProfileContext'
import { useFavorites } from '../../contexts/FavoritesContext'
import { ComparisonItem, ComparisonReport, ComparisonPropertyData } from '../../types/comparison'
import { ProfileForm } from './ProfileForm'
import { PropertyCompareView } from './PropertyCompareView'
import { AIAnalysisPanel } from './AIAnalysisPanel'
import { AnalysisReport } from './AnalysisReport'
import { getCachedProject } from '../../lib/projectCache'

type Step = 'select' | 'compare' | 'profile' | 'analyzing' | 'report'

interface CompareModalProps {
  open: boolean
  onClose: () => void
}

export function CompareModal({ open, onClose }: CompareModalProps) {
  const { t } = useTranslation('favorites')
  const { user } = useAuth()
  const { profile, hasProfile } = useUserProfile()
  const { favorites } = useFavorites()

  const [step, setStep] = useState<Step>('select')
  const [selectedItems, setSelectedItems] = useState<ComparisonItem[]>([])
  const [propertyData, setPropertyData] = useState<ComparisonPropertyData[]>([])
  const [report, setReport] = useState<ComparisonReport | null>(null)
  const [isLoadingData, setIsLoadingData] = useState(false)

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setStep('select')
      setSelectedItems([])
      setPropertyData([])
      setReport(null)
    }
  }, [open])

  // Load property data for selected items
  const loadPropertyData = useCallback(async (items: ComparisonItem[]) => {
    setIsLoadingData(true)
    const data: ComparisonPropertyData[] = []

    for (const item of items) {
      try {
        // Try cache first
        const cached = getCachedProject(item.projectId)

        if (cached) {
          const { project, units } = cached

          // If specific unit type selected
          if (item.unitTypeId) {
            const unit = units.find(u => u.id === item.unitTypeId)
            if (unit) {
              data.push({
                id: `${item.projectId}-${item.unitTypeId}`,
                projectId: item.projectId,
                unitTypeId: item.unitTypeId,
                projectName: project.project_name,
                developer: project.developer,
                area: project.area,
                address: project.address,
                unitTypeName: unit.unit_type_name,
                bedrooms: unit.bedrooms,
                bathrooms: unit.bathrooms,
                size: parseFloat(unit.area) || 0,
                price: unit.price || project.min_price || 0,
                pricePerSqft: unit.price_per_sqft,
                completionDate: project.completion_date,
                status: project.status,
                constructionProgress: typeof project.construction_progress === 'number'
                  ? project.construction_progress
                  : parseFloat(project.construction_progress as string) || 0,
                amenities: project.amenities || [],
                imageUrl: unit.floor_plan_image || project.project_images?.[0],
              })
            }
          } else {
            // Project level comparison
            data.push({
              id: item.projectId,
              projectId: item.projectId,
              projectName: project.project_name,
              developer: project.developer,
              area: project.area,
              address: project.address,
              bedrooms: project.max_bedrooms,
              size: 0, // Would need to calculate from units
              price: project.min_price || 0,
              completionDate: project.completion_date,
              status: project.status,
              constructionProgress: typeof project.construction_progress === 'number'
                ? project.construction_progress
                : parseFloat(project.construction_progress as string) || 0,
              amenities: project.amenities || [],
              imageUrl: project.project_images?.[0],
            })
          }
        } else {
          // Fetch from API if not cached
          const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3000'}/api/residential-projects/${item.projectId}`)
          if (response.ok) {
            const result = await response.json()
            if (result.success) {
              const project = result.project
              const units = result.units || []

              if (item.unitTypeId) {
                const unit = units.find((u: { id: string }) => u.id === item.unitTypeId)
                if (unit) {
                  data.push({
                    id: `${item.projectId}-${item.unitTypeId}`,
                    projectId: item.projectId,
                    unitTypeId: item.unitTypeId,
                    projectName: project.project_name,
                    developer: project.developer,
                    area: project.area,
                    address: project.address,
                    unitTypeName: unit.unit_type_name,
                    bedrooms: unit.bedrooms,
                    bathrooms: unit.bathrooms,
                    size: parseFloat(unit.area) || 0,
                    price: unit.price || project.min_price || 0,
                    pricePerSqft: unit.price_per_sqft,
                    completionDate: project.completion_date,
                    status: project.status,
                    constructionProgress: typeof project.construction_progress === 'number'
                      ? project.construction_progress
                      : parseFloat(project.construction_progress as string) || 0,
                    amenities: project.amenities || [],
                    imageUrl: unit.floor_plan_image || project.project_images?.[0],
                  })
                }
              } else {
                data.push({
                  id: item.projectId,
                  projectId: item.projectId,
                  projectName: project.project_name,
                  developer: project.developer,
                  area: project.area,
                  address: project.address,
                  bedrooms: project.max_bedrooms,
                  size: 0,
                  price: project.min_price || 0,
                  completionDate: project.completion_date,
                  status: project.status,
                  constructionProgress: typeof project.construction_progress === 'number'
                    ? project.construction_progress
                    : parseFloat(project.construction_progress as string) || 0,
                  amenities: project.amenities || [],
                  imageUrl: project.project_images?.[0],
                })
              }
            }
          }
        }
      } catch (error) {
        console.error('Error loading property data:', error)
      }
    }

    setPropertyData(data)
    setIsLoadingData(false)
  }, [])

  // Handle item selection from favorites
  const handleSelectItem = (item: ComparisonItem) => {
    setSelectedItems(prev => {
      const exists = prev.some(
        i => i.projectId === item.projectId && i.unitTypeId === item.unitTypeId
      )
      if (exists) {
        return prev.filter(
          i => !(i.projectId === item.projectId && i.unitTypeId === item.unitTypeId)
        )
      }
      if (prev.length >= 2) {
        return [prev[1], item]
      }
      return [...prev, item]
    })
  }

  // Handle proceed to compare
  const handleProceedToCompare = async () => {
    if (selectedItems.length >= 2) {
      await loadPropertyData(selectedItems)
      setStep('compare')
    }
  }

  // Handle start AI analysis
  const handleStartAnalysis = () => {
    if (!user) {
      // Could show login prompt here
      return
    }
    if (!hasProfile) {
      setStep('profile')
    } else {
      setStep('analyzing')
    }
  }

  // Handle profile form completion
  const handleProfileComplete = () => {
    setStep('analyzing')
  }

  // Handle analysis completion
  const handleAnalysisComplete = (newReport: ComparisonReport) => {
    setReport(newReport)
    setStep('report')
  }

  // Handle back navigation
  const handleBack = () => {
    switch (step) {
      case 'compare':
        setStep('select')
        break
      case 'profile':
        setStep('compare')
        break
      case 'analyzing':
        // Can't go back during analysis
        break
      case 'report':
        setStep('compare')
        break
      default:
        break
    }
  }

  // Get title based on step
  const getTitle = () => {
    switch (step) {
      case 'select':
        return t('compare.title')
      case 'compare':
        return t('compare.title')
      case 'profile':
        return t('profile.title')
      case 'analyzing':
        return t('compare.analyzing')
      case 'report':
        return t('report.title')
      default:
        return t('compare.title')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b pb-4">
          <div className="flex items-center gap-3">
            {step !== 'select' && step !== 'analyzing' && (
              <Button
                variant="ghost"
                size="icon"
                onClick={handleBack}
                className="h-8 w-8"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <h2 className="text-lg font-semibold">{getTitle()}</h2>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto py-4">
          {step === 'select' && (
            <div className="space-y-4">
              <p className="text-sm text-slate-600">{t('compare.selectItems')}</p>

              {/* Selection list from favorites */}
              <div className="space-y-2">
                {favorites.projects.map(fav => (
                  <div key={fav.projectId} className="space-y-2">
                    {/* Project level */}
                    <label className="flex items-center gap-3 p-3 border rounded-lg hover:bg-slate-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedItems.some(i => i.projectId === fav.projectId && !i.unitTypeId)}
                        onChange={() => handleSelectItem({ projectId: fav.projectId })}
                        className="h-4 w-4 text-teal-600 rounded border-slate-300 focus:ring-teal-500"
                      />
                      <span className="font-medium text-slate-800">
                        Project: {fav.projectId.slice(0, 8)}...
                      </span>
                    </label>

                    {/* Unit types under this project */}
                    {fav.unitTypeIds.map(unitTypeId => (
                      <label
                        key={unitTypeId}
                        className="flex items-center gap-3 p-3 ml-6 border rounded-lg hover:bg-slate-50 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedItems.some(
                            i => i.projectId === fav.projectId && i.unitTypeId === unitTypeId
                          )}
                          onChange={() => handleSelectItem({ projectId: fav.projectId, unitTypeId })}
                          className="h-4 w-4 text-teal-600 rounded border-slate-300 focus:ring-teal-500"
                        />
                        <span className="text-sm text-slate-600">
                          Unit: {unitTypeId.slice(0, 8)}...
                        </span>
                      </label>
                    ))}
                  </div>
                ))}

                {favorites.projects.length === 0 && (
                  <p className="text-center text-slate-500 py-8">
                    No favorites to compare. Add some properties first.
                  </p>
                )}
              </div>

              {/* Proceed button */}
              <Button
                onClick={handleProceedToCompare}
                disabled={selectedItems.length < 2}
                className="w-full bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-600 hover:to-emerald-600"
              >
                {t('compare.title')} ({selectedItems.length}/2)
              </Button>
            </div>
          )}

          {step === 'compare' && (
            <PropertyCompareView
              properties={propertyData}
              isLoading={isLoadingData}
              isLoggedIn={!!user}
              onStartAnalysis={handleStartAnalysis}
            />
          )}

          {step === 'profile' && (
            <ProfileForm onComplete={handleProfileComplete} />
          )}

          {step === 'analyzing' && profile && (
            <AIAnalysisPanel
              items={selectedItems}
              properties={propertyData}
              profile={profile}
              onComplete={handleAnalysisComplete}
            />
          )}

          {step === 'report' && report && (
            <AnalysisReport
              report={report}
              properties={propertyData}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
