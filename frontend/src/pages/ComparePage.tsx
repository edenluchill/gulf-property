import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Building2, Check, Plus, X, Sparkles, Lock, User, Send } from 'lucide-react'
import { Button } from '../components/ui/button'
import { useAuth } from '../contexts/AuthContext'
import { useUserProfile } from '../contexts/UserProfileContext'
import { useFavorites } from '../contexts/FavoritesContext'
import { ComparisonItem, ComparisonReport, ComparisonPropertyData } from '../types/comparison'
import { AIAnalysisPanel } from '../components/compare/AIAnalysisPanel'
import { AnalysisReport } from '../components/compare/AnalysisReport'
import { getCachedProject } from '../lib/projectCache'

const MAX_COMPARE_ITEMS = 4
const MIN_COMPARE_ITEMS = 2

// Color scheme for comparison items A, B, C, D
const ITEM_COLORS = [
  { bg: 'bg-teal-500', light: 'bg-teal-50', border: 'border-teal-500', text: 'text-teal-600', ring: 'ring-teal-200' },
  { bg: 'bg-emerald-500', light: 'bg-emerald-50', border: 'border-emerald-500', text: 'text-emerald-600', ring: 'ring-emerald-200' },
  { bg: 'bg-blue-500', light: 'bg-blue-50', border: 'border-blue-500', text: 'text-blue-600', ring: 'ring-blue-200' },
  { bg: 'bg-purple-500', light: 'bg-purple-50', border: 'border-purple-500', text: 'text-purple-600', ring: 'ring-purple-200' },
]

const ITEM_LABELS = ['A', 'B', 'C', 'D']

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

type Step = 'select' | 'compare' | 'analyzing' | 'report'

export default function ComparePage() {
  const { t } = useTranslation('favorites')
  const navigate = useNavigate()
  const { user } = useAuth()
  const { profile, hasProfile, saveProfile } = useUserProfile()
  const { favorites } = useFavorites()

  const [step, setStep] = useState<Step>('select')
  const [selectedItems, setSelectedItems] = useState<ComparisonItem[]>([])
  const [selectionPreviews, setSelectionPreviews] = useState<Map<string, SelectionPreview>>(new Map())
  const [propertyData, setPropertyData] = useState<ComparisonPropertyData[]>([])
  const [report, setReport] = useState<ComparisonReport | null>(null)
  const [isLoadingPreviews, setIsLoadingPreviews] = useState(false)

  // Simple profile input
  const [showProfileInput, setShowProfileInput] = useState(false)
  const [profileText, setProfileText] = useState('')
  const [isSavingProfile, setIsSavingProfile] = useState(false)

  // Load preview data for favorites
  useEffect(() => {
    if (favorites.projects.length > 0) {
      loadSelectionPreviews()
    }
  }, [favorites])

  const loadSelectionPreviews = useCallback(async () => {
    setIsLoadingPreviews(true)
    const previews = new Map<string, SelectionPreview>()

    for (const fav of favorites.projects) {
      try {
        const cached = getCachedProject(fav.projectId)

        if (cached) {
          const { project, units } = cached

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

  const loadPropertyData = useCallback(async (items: ComparisonItem[]) => {
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
  }, [])

  const getItemKey = (item: ComparisonItem) => {
    return item.unitTypeId ? `${item.projectId}-${item.unitTypeId}` : item.projectId
  }

  const isItemSelected = (item: ComparisonItem) => {
    return selectedItems.some(
      i => i.projectId === item.projectId && i.unitTypeId === item.unitTypeId
    )
  }

  const getSelectedIndex = (item: ComparisonItem) => {
    return selectedItems.findIndex(
      i => i.projectId === item.projectId && i.unitTypeId === item.unitTypeId
    )
  }

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

  const handleRemoveSelected = (item: ComparisonItem) => {
    setSelectedItems(prev => prev.filter(
      i => !(i.projectId === item.projectId && i.unitTypeId === item.unitTypeId)
    ))
  }

  const handleProceedToCompare = async () => {
    if (selectedItems.length >= MIN_COMPARE_ITEMS) {
      await loadPropertyData(selectedItems)
      setStep('compare')
    }
  }

  const handleSaveProfile = () => {
    if (!profileText.trim()) return

    setIsSavingProfile(true)
    try {
      // Save as free-form description
      saveProfile({
        freeformDescription: profileText.trim(),
      })
      setShowProfileInput(false)
      // Start analysis after saving
      setStep('analyzing')
    } catch (error) {
      console.error('Error saving profile:', error)
    } finally {
      setIsSavingProfile(false)
    }
  }

  const handleStartAnalysis = () => {
    if (!user) {
      navigate('/login')
      return
    }
    // If has profile (either structured or freeform), start analysis directly
    if (hasProfile || profile?.freeformDescription) {
      setStep('analyzing')
    } else {
      // Show simple profile input
      setShowProfileInput(true)
    }
  }

  const handleAnalysisComplete = (newReport: ComparisonReport) => {
    setReport(newReport)
    setStep('report')
  }

  const handleBack = () => {
    switch (step) {
      case 'compare':
        setStep('select')
        setShowProfileInput(false)
        break
      case 'report':
        setStep('compare')
        break
      default:
        break
    }
  }

  const formatPrice = (price: number) => {
    if (price >= 1000000) {
      return `AED ${(price / 1000000).toFixed(1)}M`
    }
    return `AED ${(price / 1000).toFixed(0)}K`
  }

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-'
    try {
      const date = new Date(dateStr)
      return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short' })
    } catch {
      return dateStr
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
      case 'handed-over':
        return 'text-emerald-600 bg-emerald-50'
      case 'under-construction':
        return 'text-amber-600 bg-amber-50'
      default:
        return 'text-blue-600 bg-blue-50'
    }
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
        {selected && (
          <div className={`absolute top-2 start-2 z-10 w-6 h-6 rounded-full ${color?.bg} text-white flex items-center justify-center text-xs font-bold shadow-lg`}>
            {ITEM_LABELS[selectedIdx]}
          </div>
        )}

        <div className="h-32 bg-slate-100 relative">
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
          {selected && (
            <div className={`absolute inset-0 ${color?.bg} opacity-10`} />
          )}
        </div>

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

        <div className={`
          absolute bottom-2 end-2 w-5 h-5 rounded-full border-2 flex items-center justify-center
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

  // Render selected chip
  const renderSelectedChip = (item: ComparisonItem, index: number) => {
    const key = getItemKey(item)
    const preview = selectionPreviews.get(key)
    const color = ITEM_COLORS[index]

    return (
      <div
        key={key}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${color.border} ${color.light}`}
      >
        <span className={`w-5 h-5 rounded-full ${color.bg} text-white flex items-center justify-center text-xs font-bold`}>
          {ITEM_LABELS[index]}
        </span>
        <span className={`${color.text} truncate max-w-[120px] text-sm font-medium`}>
          {preview?.unitTypeName || preview?.projectName || '...'}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation()
            handleRemoveSelected(item)
          }}
          className="p-0.5 hover:bg-white/50 rounded"
        >
          <X className="w-3.5 h-3.5 text-slate-500" />
        </button>
      </div>
    )
  }

  return (
    <div className="h-[calc(100vh-73px)] md:h-[calc(100vh-73px)] flex flex-col bg-slate-50 pb-16 md:pb-0">
      {/* Fixed Header */}
      <div className="bg-white border-b flex-shrink-0">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => step === 'select' ? navigate(-1) : handleBack()}
            className="h-9 w-9"
          >
            <ArrowLeft className="h-5 w-5 rtl:-scale-x-100" />
          </Button>
          <div>
            <h1 className="text-lg font-bold text-slate-800">
              {step === 'select' && t('compare.title', 'Compare Properties')}
              {step === 'compare' && t('compare.title', 'Compare Properties')}
              {step === 'analyzing' && t('compare.analyzing', 'Analyzing...')}
              {step === 'report' && t('report.title', 'Analysis Report')}
            </h1>
            {step === 'select' && (
              <p className="text-sm text-slate-500">
                {t('compare.selectPrompt', 'Select 2-4 properties to compare')}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-4 py-4">
          {/* Step: Select */}
          {step === 'select' && (
            <div className="space-y-4">
              {/* Selected items */}
              <div className="bg-white rounded-xl p-4 border">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-medium text-slate-700">
                    {t('compare.selected', 'Selected')} ({selectedItems.length}/{MAX_COMPARE_ITEMS})
                  </h2>
                  {selectedItems.length > 0 && (
                    <button
                      onClick={() => setSelectedItems([])}
                      className="text-xs text-slate-500 hover:text-slate-700"
                    >
                      {t('compare.clearAll', 'Clear all')}
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  {selectedItems.map((item, idx) => renderSelectedChip(item, idx))}
                  {selectedItems.length < MAX_COMPARE_ITEMS && (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-slate-300 text-slate-400 text-sm">
                      <Plus className="w-4 h-4" />
                      <span>{t('compare.addMore', 'Add more')}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Favorites Grid */}
              <div>
                <h2 className="text-sm font-medium text-slate-700 mb-3">
                  {t('compare.fromFavorites', 'From your favorites')}
                </h2>

                {isLoadingPreviews ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                    {[1, 2, 3, 4, 5, 6].map(i => (
                      <div key={i} className="border rounded-xl overflow-hidden animate-pulse">
                        <div className="h-32 bg-slate-200" />
                        <div className="p-3 space-y-2">
                          <div className="h-4 bg-slate-200 rounded w-3/4" />
                          <div className="h-3 bg-slate-200 rounded w-1/2" />
                          <div className="h-4 bg-slate-200 rounded w-1/3" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : favorites.projects.length > 0 ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
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
                  <div className="text-center py-12 bg-white rounded-xl border">
                    <Building2 className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                    <p className="text-slate-500">{t('compare.noFavorites', 'No favorites yet.')}</p>
                    <Button
                      variant="outline"
                      onClick={() => navigate('/map')}
                      className="mt-4"
                    >
                      {t('browse', 'Browse Properties')}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step: Compare */}
          {step === 'compare' && (
            <div className="space-y-4">
              {/* Property Cards Grid - Horizontal scroll on mobile */}
              <div className="flex md:grid gap-3 overflow-x-auto pb-2 md:pb-0 md:overflow-visible snap-x snap-mandatory md:snap-none -mx-4 px-4 md:mx-0 md:px-0 md:grid-cols-2 lg:grid-cols-4">
                {propertyData.map((prop, idx) => {
                  const color = ITEM_COLORS[idx]
                  return (
                    <div key={prop.id} className={`flex-shrink-0 w-36 md:w-auto snap-start bg-white rounded-xl border overflow-hidden ${color.border}`}>
                      <div className="h-24 md:h-32 bg-slate-100 relative">
                        {prop.imageUrl ? (
                          <img src={prop.imageUrl} alt={prop.projectName} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Building2 className="h-10 w-10 text-slate-300" />
                          </div>
                        )}
                        <span className={`absolute top-2 start-2 px-2 py-1 text-xs font-bold rounded ${color.bg} text-white`}>
                          {ITEM_LABELS[idx]}
                        </span>
                      </div>
                      <div className="p-3">
                        <h3 className="font-semibold text-slate-800 text-sm truncate">
                          {prop.unitTypeName || prop.projectName}
                        </h3>
                        {prop.unitTypeName && (
                          <p className="text-xs text-slate-500 truncate">{prop.projectName}</p>
                        )}
                        <p className={`text-base font-bold mt-1 ${color.text}`}>
                          {formatPrice(prop.price)}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Comparison Table - Horizontal scroll on mobile */}
              <div className="bg-white rounded-xl border overflow-x-auto">
                <table className="w-full text-sm min-w-[400px]">
                  <thead className="bg-slate-50 border-b">
                    <tr>
                      <th className="px-3 md:px-4 py-2 text-start text-slate-600 font-medium text-xs md:text-sm sticky start-0 bg-slate-50 z-10 w-20 md:w-auto"></th>
                      {propertyData.map((_, idx) => (
                        <th key={idx} className={`px-2 md:px-4 py-2 text-center font-semibold text-xs md:text-sm ${ITEM_COLORS[idx].text}`}>
                          {ITEM_LABELS[idx]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    <tr>
                      <td className="px-3 md:px-4 py-2 text-slate-600 font-medium text-xs md:text-sm sticky start-0 bg-white z-10">Price</td>
                      {propertyData.map((prop, idx) => (
                        <td key={idx} className="px-4 py-2 text-center font-semibold text-slate-800">
                          {formatPrice(prop.price)}
                        </td>
                      ))}
                    </tr>
                    {propertyData.some(p => p.size > 0) && (
                      <tr className="bg-slate-50/50">
                        <td className="px-4 py-2 text-slate-600 font-medium">Area</td>
                        {propertyData.map((prop, idx) => (
                          <td key={idx} className="px-4 py-2 text-center text-slate-700">
                            {prop.size > 0 ? `${prop.size.toLocaleString()} sqft` : '-'}
                          </td>
                        ))}
                      </tr>
                    )}
                    {propertyData.some(p => p.pricePerSqft) && (
                      <tr>
                        <td className="px-4 py-2 text-slate-600 font-medium">Price/sqft</td>
                        {propertyData.map((prop, idx) => (
                          <td key={idx} className="px-4 py-2 text-center text-slate-700">
                            {prop.pricePerSqft ? `AED ${prop.pricePerSqft.toLocaleString()}` : '-'}
                          </td>
                        ))}
                      </tr>
                    )}
                    <tr className="bg-slate-50/50">
                      <td className="px-4 py-2 text-slate-600 font-medium">Bedrooms</td>
                      {propertyData.map((prop, idx) => (
                        <td key={idx} className="px-4 py-2 text-center text-slate-700">
                          {prop.bedrooms === 0 ? 'Studio' : prop.bedrooms}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td className="px-4 py-2 text-slate-600 font-medium">Location</td>
                      {propertyData.map((prop, idx) => (
                        <td key={idx} className="px-4 py-2 text-center text-slate-700">{prop.area}</td>
                      ))}
                    </tr>
                    <tr className="bg-slate-50/50">
                      <td className="px-4 py-2 text-slate-600 font-medium">Completion</td>
                      {propertyData.map((prop, idx) => (
                        <td key={idx} className="px-4 py-2 text-center text-slate-700">
                          {formatDate(prop.completionDate)}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td className="px-4 py-2 text-slate-600 font-medium">Status</td>
                      {propertyData.map((prop, idx) => (
                        <td key={idx} className="px-4 py-2 text-center">
                          <span className={`inline-block px-2 py-0.5 text-xs rounded ${getStatusColor(prop.status)}`}>
                            {prop.status.replace('-', ' ')}
                          </span>
                        </td>
                      ))}
                    </tr>
                    {propertyData.some(p => p.constructionProgress) && (
                      <tr className="bg-slate-50/50">
                        <td className="px-4 py-2 text-slate-600 font-medium">Progress</td>
                        {propertyData.map((prop, idx) => (
                          <td key={idx} className="px-4 py-2">
                            <div className="flex items-center justify-center gap-2">
                              <div className="w-12 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                                <div
                                  className={`h-full ${ITEM_COLORS[idx].bg} rounded-full`}
                                  style={{ width: `${prop.constructionProgress || 0}%` }}
                                />
                              </div>
                              <span className="text-xs text-slate-600">{prop.constructionProgress || 0}%</span>
                            </div>
                          </td>
                        ))}
                      </tr>
                    )}
                    <tr>
                      <td className="px-4 py-2 text-slate-600 font-medium">Developer</td>
                      {propertyData.map((prop, idx) => (
                        <td key={idx} className="px-4 py-2 text-center text-slate-700 text-xs">{prop.developer}</td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Profile Section - Show saved profile or input */}
              <div className="bg-white rounded-xl border p-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center">
                    <User className="w-4 h-4 text-slate-500" />
                  </div>
                  <div>
                    <h3 className="font-medium text-slate-800 text-sm">{t('compare.yourProfile', 'Your Profile')}</h3>
                    <p className="text-xs text-slate-500">{t('compare.profileHelps', 'Helps AI provide personalized recommendations')}</p>
                  </div>
                </div>

                {/* Show edit input when showProfileInput is true */}
                {showProfileInput ? (
                  <div className="space-y-3">
                    <textarea
                      value={profileText}
                      onChange={(e) => setProfileText(e.target.value)}
                      placeholder={t('compare.profilePlaceholder', 'Tell us about yourself, e.g., "I\'m a family of 4 with 2 kids, budget around 2M AED, looking for investment property near good schools, prefer ready or near completion..."')}
                      className="w-full p-3 border border-slate-200 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                      rows={3}
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowProfileInput(false)}
                        className="text-slate-600"
                      >
                        {t('cancel', 'Cancel')}
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleSaveProfile}
                        disabled={!profileText.trim() || isSavingProfile}
                        className="bg-teal-500 hover:bg-teal-600 text-white"
                      >
                        {isSavingProfile ? (
                          <span className="flex items-center gap-2">
                            <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            {t('saving', 'Saving...')}
                          </span>
                        ) : (
                          <span className="flex items-center gap-2">
                            <Send className="w-3 h-3" />
                            {t('compare.saveAndAnalyze', 'Save & Analyze')}
                          </span>
                        )}
                      </Button>
                    </div>
                  </div>
                ) : (hasProfile || profile?.freeformDescription) ? (
                  /* Show saved profile when not editing */
                  <div className="bg-slate-50 rounded-lg p-3">
                    <p className="text-sm text-slate-700">
                      {profile?.freeformDescription || `Budget: ${profile?.budget}, Purpose: ${profile?.purpose}`}
                    </p>
                    <button
                      onClick={() => {
                        setProfileText(profile?.freeformDescription || '')
                        setShowProfileInput(true)
                      }}
                      className="text-xs text-teal-600 hover:text-teal-700 mt-2"
                    >
                      {t('compare.editProfile', 'Edit')}
                    </button>
                  </div>
                ) : (
                  /* Show add profile button when no profile exists */
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowProfileInput(true)}
                    className="w-full text-slate-600"
                  >
                    <Plus className="w-4 h-4 me-2" />
                    {t('compare.addProfile', 'Add your profile for personalized analysis')}
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Step: Analyzing */}
          {step === 'analyzing' && profile && (
            <div className="max-w-2xl mx-auto">
              <div className="bg-white rounded-xl border p-6">
                <AIAnalysisPanel
                  items={selectedItems}
                  properties={propertyData}
                  profile={profile}
                  onComplete={handleAnalysisComplete}
                />
              </div>
            </div>
          )}

          {/* Step: Report */}
          {step === 'report' && report && (
            <div className="max-w-3xl mx-auto space-y-4">
              <div className="bg-white rounded-xl border p-6">
                <AnalysisReport
                  report={report}
                  properties={propertyData}
                />
              </div>

              <div className="flex gap-4">
                <Button
                  variant="outline"
                  onClick={() => setStep('compare')}
                  className="flex-1"
                >
                  {t('back', 'Back to Comparison')}
                </Button>
                <Button
                  onClick={() => {
                    setStep('select')
                    setSelectedItems([])
                    setReport(null)
                  }}
                  className="flex-1 bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-600 hover:to-emerald-600"
                >
                  {t('compare.newComparison', 'New Comparison')}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Fixed Footer - Only for select step */}
      {step === 'select' && selectedItems.length >= MIN_COMPARE_ITEMS && (
        <div className="bg-white border-t flex-shrink-0 px-4 py-3">
          <div className="max-w-6xl mx-auto">
            <Button
              onClick={handleProceedToCompare}
              className="w-full bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-600 hover:to-emerald-600"
            >
              {t('compare.title', 'Compare')} ({selectedItems.length})
            </Button>
          </div>
        </div>
      )}

      {/* Fixed Footer - For compare step */}
      {step === 'compare' && !showProfileInput && (
        <div className="bg-white border-t flex-shrink-0 px-4 py-3">
          <div className="max-w-6xl mx-auto">
            {user ? (
              <Button
                onClick={handleStartAnalysis}
                className="w-full bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-600 hover:to-emerald-600"
              >
                <Sparkles className="w-4 h-4 me-2" />
                {t('compare.startAnalysis', 'Start AI Analysis')}
              </Button>
            ) : (
              <Button
                onClick={() => navigate('/login')}
                variant="outline"
                className="w-full"
              >
                <Lock className="w-4 h-4 me-2" />
                {t('compare.loginRequired', 'Login to use AI Analysis')}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
