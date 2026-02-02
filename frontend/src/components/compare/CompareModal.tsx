import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { X, ArrowLeft, Building2, Check, Plus } from 'lucide-react'
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

const MAX_COMPARE_ITEMS = 4
const MIN_COMPARE_ITEMS = 2

// Color scheme for comparison items A, B, C, D
const ITEM_COLORS = [
  { bg: 'bg-teal-500', light: 'bg-teal-50', border: 'border-teal-500', text: 'text-teal-700', ring: 'ring-teal-200' },
  { bg: 'bg-emerald-500', light: 'bg-emerald-50', border: 'border-emerald-500', text: 'text-emerald-700', ring: 'ring-emerald-200' },
  { bg: 'bg-blue-500', light: 'bg-blue-50', border: 'border-blue-500', text: 'text-blue-700', ring: 'ring-blue-200' },
  { bg: 'bg-purple-500', light: 'bg-purple-50', border: 'border-purple-500', text: 'text-purple-700', ring: 'ring-purple-200' },
]

const ITEM_LABELS = ['A', 'B', 'C', 'D']

interface CompareModalProps {
  open: boolean
  onClose: () => void
}

// Preview data for selection cards
interface SelectionPreview {
  projectId: string
  unitTypeId?: string
  projectName: string
  unitTypeName?: string
  developer: string
  area: string
  price: number
  imageUrl?: string
  bedrooms?: number
}

export function CompareModal({ open, onClose }: CompareModalProps) {
  const { t } = useTranslation('favorites')
  const { user } = useAuth()
  const { profile, hasProfile } = useUserProfile()
  const { favorites } = useFavorites()

  const [step, setStep] = useState<Step>('select')
  const [selectedItems, setSelectedItems] = useState<ComparisonItem[]>([])
  const [selectionPreviews, setSelectionPreviews] = useState<Map<string, SelectionPreview>>(new Map())
  const [propertyData, setPropertyData] = useState<ComparisonPropertyData[]>([])
  const [report, setReport] = useState<ComparisonReport | null>(null)
  const [isLoadingData, setIsLoadingData] = useState(false)
  const [isLoadingPreviews, setIsLoadingPreviews] = useState(false)

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setStep('select')
      setSelectedItems([])
      setPropertyData([])
      setReport(null)
    }
  }, [open])

  // Load preview data for favorites when modal opens
  useEffect(() => {
    if (open && favorites.projects.length > 0) {
      loadSelectionPreviews()
    }
  }, [open, favorites])

  // Load preview data for all favorites
  const loadSelectionPreviews = useCallback(async () => {
    setIsLoadingPreviews(true)
    const previews = new Map<string, SelectionPreview>()

    for (const fav of favorites.projects) {
      try {
        const cached = getCachedProject(fav.projectId)

        if (cached) {
          const { project, units } = cached

          // Add project-level preview
          previews.set(fav.projectId, {
            projectId: fav.projectId,
            projectName: project.project_name,
            developer: project.developer,
            area: project.area,
            price: project.min_price || 0,
            imageUrl: project.project_images?.[0],
            bedrooms: project.max_bedrooms,
          })

          // Add unit-type previews
          for (const unitTypeId of fav.unitTypeIds) {
            const unit = units.find(u => u.id === unitTypeId)
            if (unit) {
              previews.set(`${fav.projectId}-${unitTypeId}`, {
                projectId: fav.projectId,
                unitTypeId,
                projectName: project.project_name,
                unitTypeName: unit.unit_type_name,
                developer: project.developer,
                area: project.area,
                price: unit.price || project.min_price || 0,
                imageUrl: unit.floor_plan_image || project.project_images?.[0],
                bedrooms: unit.bedrooms,
              })
            }
          }
        } else {
          // Fetch from API if not cached
          const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3000'}/api/residential-projects/${fav.projectId}`)
          if (response.ok) {
            const result = await response.json()
            if (result.success) {
              const project = result.project
              const units = result.units || []

              previews.set(fav.projectId, {
                projectId: fav.projectId,
                projectName: project.project_name,
                developer: project.developer,
                area: project.area,
                price: project.min_price || 0,
                imageUrl: project.project_images?.[0],
                bedrooms: project.max_bedrooms,
              })

              for (const unitTypeId of fav.unitTypeIds) {
                const unit = units.find((u: { id: string }) => u.id === unitTypeId)
                if (unit) {
                  previews.set(`${fav.projectId}-${unitTypeId}`, {
                    projectId: fav.projectId,
                    unitTypeId,
                    projectName: project.project_name,
                    unitTypeName: unit.unit_type_name,
                    developer: project.developer,
                    area: project.area,
                    price: unit.price || project.min_price || 0,
                    imageUrl: unit.floor_plan_image || project.project_images?.[0],
                    bedrooms: unit.bedrooms,
                  })
                }
              }
            }
          }
        }
      } catch (error) {
        console.error('Error loading preview:', error)
      }
    }

    setSelectionPreviews(previews)
    setIsLoadingPreviews(false)
  }, [favorites])

  // Load property data for selected items
  const loadPropertyData = useCallback(async (items: ComparisonItem[]) => {
    setIsLoadingData(true)
    const data: ComparisonPropertyData[] = []

    for (const item of items) {
      try {
        const cached = getCachedProject(item.projectId)

        if (cached) {
          const { project, units } = cached

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
        } else {
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

  // Get unique key for comparison item
  const getItemKey = (item: ComparisonItem) => {
    return item.unitTypeId ? `${item.projectId}-${item.unitTypeId}` : item.projectId
  }

  // Check if item is selected
  const isItemSelected = (item: ComparisonItem) => {
    return selectedItems.some(
      i => i.projectId === item.projectId && i.unitTypeId === item.unitTypeId
    )
  }

  // Get selected item index (for color assignment)
  const getSelectedIndex = (item: ComparisonItem) => {
    return selectedItems.findIndex(
      i => i.projectId === item.projectId && i.unitTypeId === item.unitTypeId
    )
  }

  // Handle item selection
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
      if (prev.length >= MAX_COMPARE_ITEMS) {
        return [...prev.slice(0, -1), item]
      }
      return [...prev, item]
    })
  }

  // Handle removing a selected item
  const handleRemoveSelected = (item: ComparisonItem) => {
    setSelectedItems(prev => prev.filter(
      i => !(i.projectId === item.projectId && i.unitTypeId === item.unitTypeId)
    ))
  }

  // Handle proceed to compare
  const handleProceedToCompare = async () => {
    if (selectedItems.length >= MIN_COMPARE_ITEMS) {
      await loadPropertyData(selectedItems)
      setStep('compare')
    }
  }

  // Handle start AI analysis - show profile form if no profile
  const handleStartAnalysis = () => {
    if (!user) {
      return
    }
    if (!hasProfile) {
      setStep('profile')
    } else {
      setStep('analyzing')
    }
  }

  // Handle profile form completion - save and start analysis
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

  // Format price for display
  const formatPrice = (price: number) => {
    if (price >= 1000000) {
      return `AED ${(price / 1000000).toFixed(1)}M`
    }
    return `AED ${(price / 1000).toFixed(0)}K`
  }

  // Render selection card
  const renderSelectionCard = (item: ComparisonItem) => {
    const key = getItemKey(item)
    const preview = selectionPreviews.get(key)
    const selected = isItemSelected(item)
    const selectedIdx = getSelectedIndex(item)
    const color = selected ? ITEM_COLORS[selectedIdx] : null

    return (
      <div
        key={key}
        onClick={() => handleSelectItem(item)}
        className={`
          relative border rounded-xl overflow-hidden cursor-pointer transition-all
          ${selected
            ? `${color?.border} ${color?.light} ring-2 ${color?.ring}`
            : 'border-slate-200 hover:border-slate-300 hover:shadow-md'
          }
        `}
      >
        {/* Selected badge */}
        {selected && (
          <div className={`absolute top-1.5 left-1.5 z-10 w-5 h-5 rounded-full ${color?.bg} text-white flex items-center justify-center text-xs font-bold shadow-lg`}>
            {ITEM_LABELS[selectedIdx]}
          </div>
        )}

        {/* Image */}
        <div className="h-24 bg-slate-100 relative">
          {preview?.imageUrl ? (
            <img
              src={preview.imageUrl}
              alt={preview.projectName}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Building2 className="h-8 w-8 text-slate-300" />
            </div>
          )}
          {selected && (
            <div className={`absolute inset-0 ${color?.bg} opacity-10`} />
          )}
        </div>

        {/* Info */}
        <div className="p-2 space-y-0.5">
          <h4 className="font-medium text-slate-800 text-xs truncate">
            {preview?.unitTypeName || preview?.projectName || 'Loading...'}
          </h4>
          {preview?.unitTypeName && (
            <p className="text-[10px] text-slate-500 truncate">{preview.projectName}</p>
          )}
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-slate-500 truncate">{preview?.area || '-'}</span>
            {preview?.bedrooms !== undefined && (
              <span className="text-slate-600 font-medium">
                {preview.bedrooms === 0 ? 'Studio' : `${preview.bedrooms}BR`}
              </span>
            )}
          </div>
          <p className={`text-xs font-semibold ${selected ? color?.text : 'text-teal-600'}`}>
            {preview?.price ? formatPrice(preview.price) : '-'}
          </p>
        </div>

        {/* Selection indicator */}
        <div className={`
          absolute bottom-1.5 right-1.5 w-4 h-4 rounded-full border-2 flex items-center justify-center
          ${selected
            ? `${color?.bg} border-transparent`
            : 'border-slate-300 bg-white'
          }
        `}>
          {selected && <Check className="w-2.5 h-2.5 text-white" />}
        </div>
      </div>
    )
  }

  // Render selected item chip
  const renderSelectedChip = (item: ComparisonItem, index: number) => {
    const key = getItemKey(item)
    const preview = selectionPreviews.get(key)
    const color = ITEM_COLORS[index]

    return (
      <div
        key={key}
        className={`
          flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs
          ${color.border} ${color.light}
        `}
      >
        <span className={`w-4 h-4 rounded-full ${color.bg} text-white flex items-center justify-center text-[10px] font-bold flex-shrink-0`}>
          {ITEM_LABELS[index]}
        </span>
        <span className={`${color.text} truncate max-w-[80px] font-medium`}>
          {preview?.unitTypeName || preview?.projectName || '...'}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation()
            handleRemoveSelected(item)
          }}
          className="p-0.5 hover:bg-white/50 rounded transition-colors flex-shrink-0"
        >
          <X className="w-3 h-3 text-slate-500" />
        </button>
      </div>
    )
  }

  // Check if we can go back
  const canGoBack = step === 'compare' || step === 'profile' || step === 'report'

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl h-[85vh] p-0 overflow-hidden flex flex-col">
        {/* Fixed Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b bg-white flex-shrink-0">
          <div className="flex items-center gap-2">
            {canGoBack && (
              <Button
                variant="ghost"
                size="icon"
                onClick={handleBack}
                className="h-8 w-8"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <h2 className="text-base font-semibold">{getTitle()}</h2>
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

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto">
          {step === 'select' && (
            <div className="p-4">
              {/* Selected items row */}
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-slate-600">
                    {t('compare.selected', 'Selected')} ({selectedItems.length}/{MAX_COMPARE_ITEMS})
                  </span>
                  {selectedItems.length > 0 && (
                    <button
                      onClick={() => setSelectedItems([])}
                      className="text-[10px] text-slate-500 hover:text-slate-700"
                    >
                      {t('compare.clearAll', 'Clear all')}
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {selectedItems.map((item, idx) => renderSelectedChip(item, idx))}
                  {selectedItems.length < MAX_COMPARE_ITEMS && (
                    <div className="flex items-center gap-1 px-2 py-1 rounded-md border border-dashed border-slate-300 text-slate-400 text-xs">
                      <Plus className="w-3 h-3" />
                      <span>{t('compare.addMore', 'Add more')}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Favorites grid */}
              <div>
                <h3 className="text-xs font-medium text-slate-600 mb-2">
                  {t('compare.fromFavorites', 'From your favorites')}
                </h3>

                {isLoadingPreviews ? (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {[1, 2, 3, 4, 5, 6].map(i => (
                      <div key={i} className="border rounded-xl overflow-hidden animate-pulse">
                        <div className="h-24 bg-slate-200" />
                        <div className="p-2 space-y-1">
                          <div className="h-3 bg-slate-200 rounded w-3/4" />
                          <div className="h-2 bg-slate-200 rounded w-1/2" />
                          <div className="h-3 bg-slate-200 rounded w-1/3" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : favorites.projects.length > 0 ? (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {favorites.projects.flatMap(fav => {
                      const items: ComparisonItem[] = []
                      fav.unitTypeIds.forEach(unitTypeId => {
                        items.push({ projectId: fav.projectId, unitTypeId })
                      })
                      if (fav.unitTypeIds.length === 0) {
                        items.push({ projectId: fav.projectId })
                      }
                      return items
                    }).map(item => renderSelectionCard(item))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-slate-500">
                    <Building2 className="w-10 h-10 mx-auto mb-2 text-slate-300" />
                    <p className="text-sm">{t('compare.noFavorites', 'No favorites yet.')}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 'compare' && (
            <div className="p-4">
              <PropertyCompareView
                properties={propertyData}
                isLoading={isLoadingData}
                isLoggedIn={!!user}
                onStartAnalysis={handleStartAnalysis}
              />
            </div>
          )}

          {step === 'profile' && (
            <div className="p-4">
              <div className="mb-4 p-3 bg-teal-50 border border-teal-200 rounded-lg">
                <p className="text-sm text-teal-800">
                  {t('profile.aiPrompt', 'Tell us about yourself for personalized AI analysis. Your profile will be saved for future comparisons.')}
                </p>
              </div>
              <ProfileForm onComplete={handleProfileComplete} />
            </div>
          )}

          {step === 'analyzing' && profile && (
            <div className="p-4">
              <AIAnalysisPanel
                items={selectedItems}
                properties={propertyData}
                profile={profile}
                onComplete={handleAnalysisComplete}
              />
            </div>
          )}

          {step === 'report' && report && (
            <div className="p-4">
              <AnalysisReport
                report={report}
                properties={propertyData}
              />
            </div>
          )}
        </div>

        {/* Fixed Footer - only for select step */}
        {step === 'select' && (
          <div className="px-4 py-3 border-t bg-white flex-shrink-0">
            <Button
              onClick={handleProceedToCompare}
              disabled={selectedItems.length < MIN_COMPARE_ITEMS}
              className="w-full bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-600 hover:to-emerald-600 disabled:opacity-50"
            >
              {t('compare.title')} ({selectedItems.length}/{MIN_COMPARE_ITEMS}+)
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
