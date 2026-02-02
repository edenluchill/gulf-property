import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { X, ArrowLeft, Building2, User, ChevronDown, ChevronUp, Check, Plus } from 'lucide-react'
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
  const [showProfileEditor, setShowProfileEditor] = useState(false)

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setStep('select')
      setSelectedItems([])
      setPropertyData([])
      setReport(null)
      setShowProfileEditor(false)
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
        // Replace the last item instead of doing nothing
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

  // Handle start AI analysis
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

  // Handle profile form completion
  const handleProfileComplete = () => {
    setShowProfileEditor(false)
    if (step === 'profile') {
      setStep('analyzing')
    }
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

  // Get profile summary text
  const getProfileSummary = () => {
    if (!profile) return null
    const parts: string[] = []

    if (profile.familyStatus) {
      const statusMap: Record<string, string> = {
        'single': 'Single',
        'couple': 'Couple',
        'family-small': 'Small Family',
        'family-large': 'Large Family',
      }
      parts.push(statusMap[profile.familyStatus] || profile.familyStatus)
    }

    if (profile.purpose) {
      const purposeMap: Record<string, string> = {
        'investment': 'Investment',
        'residence': 'Residence',
        'work': 'Work',
        'mixed': 'Mixed Use',
      }
      parts.push(purposeMap[profile.purpose] || profile.purpose)
    }

    if (profile.budget) {
      parts.push(`${formatPrice(profile.budget.min)} - ${formatPrice(profile.budget.max)}`)
    }

    return parts.join(' | ')
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
          <div className={`absolute top-2 left-2 z-10 w-6 h-6 rounded-full ${color?.bg} text-white flex items-center justify-center text-xs font-bold shadow-lg`}>
            {ITEM_LABELS[selectedIdx]}
          </div>
        )}

        {/* Image */}
        <div className="h-28 bg-slate-100 relative">
          {preview?.imageUrl ? (
            <img
              src={preview.imageUrl}
              alt={preview.projectName}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Building2 className="h-10 w-10 text-slate-300" />
            </div>
          )}
          {/* Selection overlay */}
          {selected && (
            <div className={`absolute inset-0 ${color?.bg} opacity-10`} />
          )}
        </div>

        {/* Info */}
        <div className="p-3 space-y-1">
          <h4 className="font-medium text-slate-800 text-sm truncate">
            {preview?.unitTypeName || preview?.projectName || 'Loading...'}
          </h4>
          {preview?.unitTypeName && (
            <p className="text-xs text-slate-500 truncate">{preview.projectName}</p>
          )}
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500 truncate">{preview?.area || '-'}</span>
            {preview?.bedrooms !== undefined && (
              <span className="text-slate-600 font-medium">
                {preview.bedrooms === 0 ? 'Studio' : `${preview.bedrooms}BR`}
              </span>
            )}
          </div>
          <p className={`text-sm font-semibold ${selected ? color?.text : 'text-teal-600'}`}>
            {preview?.price ? formatPrice(preview.price) : '-'}
          </p>
        </div>

        {/* Selection indicator */}
        <div className={`
          absolute bottom-2 right-2 w-5 h-5 rounded-full border-2 flex items-center justify-center
          ${selected
            ? `${color?.bg} border-transparent`
            : 'border-slate-300 bg-white'
          }
        `}>
          {selected && <Check className="w-3 h-3 text-white" />}
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
          relative flex items-center gap-2 px-3 py-2 rounded-lg border
          ${color.border} ${color.light}
        `}
      >
        <span className={`w-5 h-5 rounded-full ${color.bg} text-white flex items-center justify-center text-xs font-bold`}>
          {ITEM_LABELS[index]}
        </span>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium ${color.text} truncate`}>
            {preview?.unitTypeName || preview?.projectName || 'Loading...'}
          </p>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation()
            handleRemoveSelected(item)
          }}
          className="p-1 hover:bg-white/50 rounded transition-colors"
        >
          <X className="w-3.5 h-3.5 text-slate-500" />
        </button>
      </div>
    )
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
            <div className="space-y-5">
              {/* Selected items section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-slate-700">
                    {t('compare.selected', 'Selected')} ({selectedItems.length}/{MAX_COMPARE_ITEMS})
                  </h3>
                  {selectedItems.length > 0 && (
                    <button
                      onClick={() => setSelectedItems([])}
                      className="text-xs text-slate-500 hover:text-slate-700"
                    >
                      {t('compare.clearAll', 'Clear all')}
                    </button>
                  )}
                </div>

                {selectedItems.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {selectedItems.map((item, idx) => renderSelectedChip(item, idx))}
                    {selectedItems.length < MAX_COMPARE_ITEMS && (
                      <div className="flex items-center gap-1 px-3 py-2 rounded-lg border border-dashed border-slate-300 text-slate-400 text-sm">
                        <Plus className="w-4 h-4" />
                        <span>{t('compare.addMore', 'Add more')}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-slate-50 text-slate-500 text-sm">
                    <Plus className="w-4 h-4" />
                    <span>{t('compare.selectPrompt', 'Select 2-4 properties to compare')}</span>
                  </div>
                )}
              </div>

              {/* Profile section */}
              <div className="border rounded-lg overflow-hidden">
                <button
                  onClick={() => setShowProfileEditor(!showProfileEditor)}
                  className="w-full flex items-center justify-between p-3 bg-gradient-to-r from-slate-50 to-slate-100 hover:from-slate-100 hover:to-slate-150 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-teal-100 flex items-center justify-center">
                      <User className="w-4 h-4 text-teal-600" />
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-medium text-slate-700">
                        {t('profile.myProfile', 'My Profile')}
                      </p>
                      {hasProfile ? (
                        <p className="text-xs text-slate-500">{getProfileSummary()}</p>
                      ) : (
                        <p className="text-xs text-amber-600">
                          {t('profile.notSet', 'Not configured - click to set up')}
                        </p>
                      )}
                    </div>
                  </div>
                  {showProfileEditor ? (
                    <ChevronUp className="w-4 h-4 text-slate-400" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-slate-400" />
                  )}
                </button>

                {showProfileEditor && (
                  <div className="p-4 border-t bg-white">
                    <ProfileForm onComplete={handleProfileComplete} />
                  </div>
                )}
              </div>

              {/* Favorites selection grid */}
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-slate-700">
                  {t('compare.fromFavorites', 'From your favorites')}
                </h3>

                {isLoadingPreviews ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {[1, 2, 3, 4, 5, 6].map(i => (
                      <div key={i} className="border rounded-xl overflow-hidden animate-pulse">
                        <div className="h-28 bg-slate-200" />
                        <div className="p-3 space-y-2">
                          <div className="h-4 bg-slate-200 rounded w-3/4" />
                          <div className="h-3 bg-slate-200 rounded w-1/2" />
                          <div className="h-4 bg-slate-200 rounded w-1/3" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : favorites.projects.length > 0 ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {favorites.projects.flatMap(fav => {
                      const items: ComparisonItem[] = []

                      // Add unit types first (more specific)
                      fav.unitTypeIds.forEach(unitTypeId => {
                        items.push({ projectId: fav.projectId, unitTypeId })
                      })

                      // Add project if no unit types
                      if (fav.unitTypeIds.length === 0) {
                        items.push({ projectId: fav.projectId })
                      }

                      return items
                    }).map(item => renderSelectionCard(item))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-slate-500">
                    <Building2 className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                    <p>{t('compare.noFavorites', 'No favorites yet. Add some properties first.')}</p>
                  </div>
                )}
              </div>

              {/* Proceed button */}
              <Button
                onClick={handleProceedToCompare}
                disabled={selectedItems.length < MIN_COMPARE_ITEMS}
                className="w-full bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-600 hover:to-emerald-600 disabled:opacity-50"
              >
                {t('compare.title')} ({selectedItems.length}/{MIN_COMPARE_ITEMS}+)
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
