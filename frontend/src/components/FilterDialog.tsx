import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { X, DollarSign, Grid3x3, MapPin, Calendar, Activity, Building2 } from 'lucide-react'
import { PropertyFilters } from '../types'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Button } from './ui/button'
import { Input } from './ui/input'

interface FilterDialogProps {
  isOpen: boolean
  onClose: () => void
  filters: PropertyFilters
  onFiltersChange: (filters: PropertyFilters) => void
  developers: string[]
  areas: string[]
  projects: { project_name: string; developer: string }[]
}

export default function FilterDialog({
  isOpen,
  onClose,
  filters,
  onFiltersChange,
  developers,
  areas,
  projects,
}: FilterDialogProps) {
  const { t } = useTranslation('filter')
  const [localFilters, setLocalFilters] = useState<PropertyFilters>(filters)

  // Update local filters when props change
  useEffect(() => {
    setLocalFilters(filters)
  }, [filters])

  // Apply changes to parent component
  const handleApplyFilter = () => {
    onFiltersChange(localFilters)
  }

  // Auto-apply on any change
  useEffect(() => {
    handleApplyFilter()
  }, [localFilters])

  const handleClear = () => {
    const clearedFilters: PropertyFilters = {}
    setLocalFilters(clearedFilters)
    onFiltersChange(clearedFilters)
  }

  const updateFilter = (key: keyof PropertyFilters, value: any) => {
    setLocalFilters(prev => ({
      ...prev,
      [key]: value === 'all' || value === '' ? undefined : value,
    }))
  }

  // Price range presets
  const priceRanges = [
    { key: 'price.anyPrice', label: t('price.anyPrice'), min: undefined, max: undefined },
    { key: 'price.upTo500K', label: t('price.upTo500K'), min: undefined, max: 500000 },
    { key: 'price.500K_1M', label: t('price.500K_1M'), min: 500000, max: 1000000 },
    { key: 'price.1M_2M', label: t('price.1M_2M'), min: 1000000, max: 2000000 },
    { key: 'price.2M_5M', label: t('price.2M_5M'), min: 2000000, max: 5000000 },
    { key: 'price.5M_10M', label: t('price.5M_10M'), min: 5000000, max: 10000000 },
    { key: 'price.10MPlus', label: t('price.10MPlus'), min: 10000000, max: undefined },
  ]

  const getCurrentPriceRange = () => {
    const range = priceRanges.find(
      r => r.min === localFilters.minPrice && r.max === localFilters.maxPrice
    )
    return range?.label || t('price.custom')
  }

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[9998]"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
        <div 
          className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-primary/5 to-primary/10">
            <h2 className="text-2xl font-bold text-slate-900">{t('title')}</h2>
            <button
              onClick={onClose}
              className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-white/80 transition-colors"
            >
              <X className="h-6 w-6 text-slate-600" />
            </button>
          </div>

          {/* Content - Scrollable */}
          <div className="flex-1 overflow-y-auto p-6">
            <div className="space-y-8">
              {/* Price Section */}
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <DollarSign className="h-5 w-5 text-primary" />
                  <h3 className="text-lg font-semibold text-slate-900">{t('price.title')}</h3>
                </div>
                
                <div className="space-y-4">
                  {/* Price Range Preset */}
                  <div>
                    <label className="text-sm font-medium text-slate-700 mb-2 block">{t('price.range')}</label>
                    <Select
                      value={getCurrentPriceRange()}
                      onValueChange={(value) => {
                        const range = priceRanges.find(r => r.label === value)
                        if (range) {
                          setLocalFilters(prev => ({
                            ...prev,
                            minPrice: range.min,
                            maxPrice: range.max,
                          }))
                        }
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {priceRanges.map((range) => (
                          <SelectItem key={range.key} value={range.label}>
                            {range.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Custom Price Inputs */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm text-slate-600 mb-1 block">{t('price.minPrice')}</label>
                      <Input
                        type="number"
                        placeholder={t('price.noMin')}
                        value={localFilters.minPrice || ''}
                        onChange={(e) => updateFilter('minPrice', e.target.value ? parseInt(e.target.value) : undefined)}
                        className="w-full"
                      />
                    </div>
                    <div>
                      <label className="text-sm text-slate-600 mb-1 block">{t('price.maxPrice')}</label>
                      <Input
                        type="number"
                        placeholder={t('price.noMax')}
                        value={localFilters.maxPrice || ''}
                        onChange={(e) => updateFilter('maxPrice', e.target.value ? parseInt(e.target.value) : undefined)}
                        className="w-full"
                      />
                    </div>
                  </div>

                  {/* Price Per Sqft */}
                  <div>
                    <label className="text-sm font-medium text-slate-700 mb-2 block">{t('price.priceSqft')}</label>
                    <div className="grid grid-cols-2 gap-4">
                      <Input
                        type="number"
                        placeholder={t('price.min')}
                        value={localFilters.minPriceSqft || ''}
                        onChange={(e) => updateFilter('minPriceSqft', e.target.value ? parseInt(e.target.value) : undefined)}
                      />
                      <Input
                        type="number"
                        placeholder={t('price.max')}
                        value={localFilters.maxPriceSqft || ''}
                        onChange={(e) => updateFilter('maxPriceSqft', e.target.value ? parseInt(e.target.value) : undefined)}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Size Section */}
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <Grid3x3 className="h-5 w-5 text-primary" />
                  <h3 className="text-lg font-semibold text-slate-900">{t('size.title')}</h3>
                </div>

                <div className="space-y-4">
                  {/* Bedrooms */}
                  <div>
                    <label className="text-sm font-medium text-slate-700 mb-2 block">{t('size.bedrooms')}</label>
                    <div className="flex gap-2 flex-wrap">
                      {([
                        { key: 'Any', label: t('size.any') },
                        { key: 'Studio', label: t('size.studio') },
                        { key: '1', label: '1' },
                        { key: '2', label: '2' },
                        { key: '3', label: '3' },
                        { key: '4', label: '4' },
                        { key: '5+', label: t('size.5plus') },
                      ]).map((bed) => (
                        <button
                          key={bed.key}
                          onClick={() => {
                            const value = bed.key === 'Any' ? undefined :
                                        bed.key === 'Studio' ? 0 :
                                        bed.key === '5+' ? 5 : parseInt(bed.key)
                            updateFilter('minBedrooms', value)
                          }}
                          className={`px-4 py-2 rounded-lg border transition-all ${
                            (bed.key === 'Any' && localFilters.minBedrooms === undefined) ||
                            (bed.key === 'Studio' && localFilters.minBedrooms === 0) ||
                            (bed.key !== 'Any' && bed.key !== 'Studio' && bed.key !== '5+' && localFilters.minBedrooms === parseInt(bed.key)) ||
                            (bed.key === '5+' && localFilters.minBedrooms === 5)
                              ? 'bg-primary text-white border-primary'
                              : 'bg-white text-slate-700 border-slate-300 hover:border-primary'
                          }`}
                        >
                          {bed.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Property Size */}
                  <div>
                    <label className="text-sm font-medium text-slate-700 mb-2 block">{t('size.propertySize')}</label>
                    <div className="grid grid-cols-2 gap-4">
                      <Input
                        type="number"
                        placeholder={t('size.minSize')}
                        value={localFilters.minSize || ''}
                        onChange={(e) => updateFilter('minSize', e.target.value ? parseInt(e.target.value) : undefined)}
                      />
                      <Input
                        type="number"
                        placeholder={t('size.maxSize')}
                        value={localFilters.maxSize || ''}
                        onChange={(e) => updateFilter('maxSize', e.target.value ? parseInt(e.target.value) : undefined)}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Location Section */}
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <MapPin className="h-5 w-5 text-primary" />
                  <h3 className="text-lg font-semibold text-slate-900">{t('location.title')}</h3>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {/* Developer */}
                  <div>
                    <label className="text-sm font-medium text-slate-700 mb-2 block">{t('location.developer')}</label>
                    <Select
                      value={localFilters.developer || 'all'}
                      onValueChange={(value) => updateFilter('developer', value)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t('location.allDevelopers')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t('location.allDevelopers')}</SelectItem>
                        {developers.slice(0, 100).map((dev) => (
                          <SelectItem key={dev} value={dev}>
                            {dev}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Area */}
                  <div>
                    <label className="text-sm font-medium text-slate-700 mb-2 block">{t('location.area')}</label>
                    <Select
                      value={localFilters.area || 'all'}
                      onValueChange={(value) => updateFilter('area', value)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t('location.allAreas')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t('location.allAreas')}</SelectItem>
                        {areas.slice(0, 100).map((area) => (
                          <SelectItem key={area} value={area}>
                            {area}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Project */}
                  <div className="col-span-2">
                    <label className="text-sm font-medium text-slate-700 mb-2 block">{t('location.project')}</label>
                    <Select
                      value={localFilters.project || 'all'}
                      onValueChange={(value) => updateFilter('project', value)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t('location.allProjects')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t('location.allProjects')}</SelectItem>
                        {projects.slice(0, 100).map((proj) => (
                          <SelectItem key={proj.project_name} value={proj.project_name}>
                            {proj.project_name} ({proj.developer})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              {/* Status & Progress Section */}
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <Activity className="h-5 w-5 text-primary" />
                  <h3 className="text-lg font-semibold text-slate-900">{t('statusProgress.title')}</h3>
                </div>

                <div className="space-y-4">
                  {/* Status */}
                  <div>
                    <label className="text-sm font-medium text-slate-700 mb-2 block">{t('statusProgress.projectStatus')}</label>
                    <div className="flex gap-2">
                      {[
                        { value: undefined, label: t('statusProgress.all') },
                        { value: 'upcoming', label: t('statusProgress.upcoming') },
                        { value: 'under-construction', label: t('statusProgress.underConstruction') },
                        { value: 'completed', label: t('statusProgress.completed') },
                      ].map((status) => (
                        <button
                          key={status.label}
                          onClick={() => updateFilter('status', status.value)}
                          className={`px-4 py-2 rounded-lg border transition-all flex-1 ${
                            localFilters.status === status.value
                              ? 'bg-primary text-white border-primary'
                              : 'bg-white text-slate-700 border-slate-300 hover:border-primary'
                          }`}
                        >
                          {status.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Completion Percentage */}
                  <div>
                    <label className="text-sm font-medium text-slate-700 mb-2 block">{t('statusProgress.completionProgress')}</label>
                    <div className="grid grid-cols-2 gap-4">
                      <Input
                        type="number"
                        placeholder={t('statusProgress.minPercent')}
                        min="0"
                        max="100"
                        value={localFilters.minCompletionPercent ?? ''}
                        onChange={(e) => updateFilter('minCompletionPercent', e.target.value ? parseInt(e.target.value) : undefined)}
                      />
                      <Input
                        type="number"
                        placeholder={t('statusProgress.maxPercent')}
                        min="0"
                        max="100"
                        value={localFilters.maxCompletionPercent ?? ''}
                        onChange={(e) => updateFilter('maxCompletionPercent', e.target.value ? parseInt(e.target.value) : undefined)}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Dates Section */}
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <Calendar className="h-5 w-5 text-primary" />
                  <h3 className="text-lg font-semibold text-slate-900">{t('dates.title')}</h3>
                </div>

                <div className="space-y-4">
                  {/* Launch Date */}
                  <div>
                    <label className="text-sm font-medium text-slate-700 mb-2 block">{t('dates.launchDate')}</label>
                    <div className="grid grid-cols-2 gap-4">
                      <Input
                        type="date"
                        value={localFilters.launchDateStart || ''}
                        onChange={(e) => updateFilter('launchDateStart', e.target.value)}
                      />
                      <Input
                        type="date"
                        value={localFilters.launchDateEnd || ''}
                        onChange={(e) => updateFilter('launchDateEnd', e.target.value)}
                      />
                    </div>
                  </div>

                  {/* Completion Date */}
                  <div>
                    <label className="text-sm font-medium text-slate-700 mb-2 block">{t('dates.completionDate')}</label>
                    <div className="grid grid-cols-2 gap-4">
                      <Input
                        type="date"
                        value={localFilters.completionDateStart || ''}
                        onChange={(e) => updateFilter('completionDateStart', e.target.value)}
                      />
                      <Input
                        type="date"
                        value={localFilters.completionDateEnd || ''}
                        onChange={(e) => updateFilter('completionDateEnd', e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t bg-slate-50 flex justify-between items-center">
            <Button
              variant="outline"
              onClick={handleClear}
              className="flex items-center gap-2"
            >
              <Building2 className="h-4 w-4" />
              {t('footer.clearAll')}
            </Button>
            <div className="text-sm text-slate-600">
              {t('footer.autoApply')}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
