import { useState, useEffect } from 'react'
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
    { label: 'Any Price', min: undefined, max: undefined },
    { label: 'Up to 500K', min: undefined, max: 500000 },
    { label: '500K - 1M', min: 500000, max: 1000000 },
    { label: '1M - 2M', min: 1000000, max: 2000000 },
    { label: '2M - 5M', min: 2000000, max: 5000000 },
    { label: '5M - 10M', min: 5000000, max: 10000000 },
    { label: '10M+', min: 10000000, max: undefined },
  ]

  const getCurrentPriceRange = () => {
    const range = priceRanges.find(
      r => r.min === localFilters.minPrice && r.max === localFilters.maxPrice
    )
    return range?.label || 'Custom'
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
            <h2 className="text-2xl font-bold text-slate-900">Filters</h2>
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
                  <h3 className="text-lg font-semibold text-slate-900">Price</h3>
                </div>
                
                <div className="space-y-4">
                  {/* Price Range Preset */}
                  <div>
                    <label className="text-sm font-medium text-slate-700 mb-2 block">Price Range</label>
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
                          <SelectItem key={range.label} value={range.label}>
                            {range.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Custom Price Inputs */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm text-slate-600 mb-1 block">Min Price (AED)</label>
                      <Input
                        type="number"
                        placeholder="No Min"
                        value={localFilters.minPrice || ''}
                        onChange={(e) => updateFilter('minPrice', e.target.value ? parseInt(e.target.value) : undefined)}
                        className="w-full"
                      />
                    </div>
                    <div>
                      <label className="text-sm text-slate-600 mb-1 block">Max Price (AED)</label>
                      <Input
                        type="number"
                        placeholder="No Max"
                        value={localFilters.maxPrice || ''}
                        onChange={(e) => updateFilter('maxPrice', e.target.value ? parseInt(e.target.value) : undefined)}
                        className="w-full"
                      />
                    </div>
                  </div>

                  {/* Price Per Sqft */}
                  <div>
                    <label className="text-sm font-medium text-slate-700 mb-2 block">Price per Sq.Ft (AED)</label>
                    <div className="grid grid-cols-2 gap-4">
                      <Input
                        type="number"
                        placeholder="Min"
                        value={localFilters.minPriceSqft || ''}
                        onChange={(e) => updateFilter('minPriceSqft', e.target.value ? parseInt(e.target.value) : undefined)}
                      />
                      <Input
                        type="number"
                        placeholder="Max"
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
                  <h3 className="text-lg font-semibold text-slate-900">Size</h3>
                </div>

                <div className="space-y-4">
                  {/* Bedrooms */}
                  <div>
                    <label className="text-sm font-medium text-slate-700 mb-2 block">Bedrooms</label>
                    <div className="flex gap-2 flex-wrap">
                      {['Any', 'Studio', '1', '2', '3', '4', '5+'].map((bed) => (
                        <button
                          key={bed}
                          onClick={() => {
                            const value = bed === 'Any' ? undefined : 
                                        bed === 'Studio' ? 0 :
                                        bed === '5+' ? 5 : parseInt(bed)
                            updateFilter('minBedrooms', value)
                          }}
                          className={`px-4 py-2 rounded-lg border transition-all ${
                            (bed === 'Any' && localFilters.minBedrooms === undefined) ||
                            (bed === 'Studio' && localFilters.minBedrooms === 0) ||
                            (bed !== 'Any' && bed !== 'Studio' && bed !== '5+' && localFilters.minBedrooms === parseInt(bed)) ||
                            (bed === '5+' && localFilters.minBedrooms === 5)
                              ? 'bg-primary text-white border-primary'
                              : 'bg-white text-slate-700 border-slate-300 hover:border-primary'
                          }`}
                        >
                          {bed}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Property Size */}
                  <div>
                    <label className="text-sm font-medium text-slate-700 mb-2 block">Property Size (Sq.Ft)</label>
                    <div className="grid grid-cols-2 gap-4">
                      <Input
                        type="number"
                        placeholder="Min Size"
                        value={localFilters.minSize || ''}
                        onChange={(e) => updateFilter('minSize', e.target.value ? parseInt(e.target.value) : undefined)}
                      />
                      <Input
                        type="number"
                        placeholder="Max Size"
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
                  <h3 className="text-lg font-semibold text-slate-900">Location</h3>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {/* Developer */}
                  <div>
                    <label className="text-sm font-medium text-slate-700 mb-2 block">Developer</label>
                    <Select
                      value={localFilters.developer || 'all'}
                      onValueChange={(value) => updateFilter('developer', value)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="All Developers" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Developers</SelectItem>
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
                    <label className="text-sm font-medium text-slate-700 mb-2 block">Area</label>
                    <Select
                      value={localFilters.area || 'all'}
                      onValueChange={(value) => updateFilter('area', value)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="All Areas" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Areas</SelectItem>
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
                    <label className="text-sm font-medium text-slate-700 mb-2 block">Project</label>
                    <Select
                      value={localFilters.project || 'all'}
                      onValueChange={(value) => updateFilter('project', value)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="All Projects" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Projects</SelectItem>
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
                  <h3 className="text-lg font-semibold text-slate-900">Status & Progress</h3>
                </div>

                <div className="space-y-4">
                  {/* Status */}
                  <div>
                    <label className="text-sm font-medium text-slate-700 mb-2 block">Project Status</label>
                    <div className="flex gap-2">
                      {[
                        { value: undefined, label: 'All' },
                        { value: 'upcoming', label: 'Upcoming' },
                        { value: 'under-construction', label: 'Under Construction' },
                        { value: 'completed', label: 'Completed' },
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
                    <label className="text-sm font-medium text-slate-700 mb-2 block">Completion Progress (%)</label>
                    <div className="grid grid-cols-2 gap-4">
                      <Input
                        type="number"
                        placeholder="Min %"
                        min="0"
                        max="100"
                        value={localFilters.minCompletionPercent ?? ''}
                        onChange={(e) => updateFilter('minCompletionPercent', e.target.value ? parseInt(e.target.value) : undefined)}
                      />
                      <Input
                        type="number"
                        placeholder="Max %"
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
                  <h3 className="text-lg font-semibold text-slate-900">Dates</h3>
                </div>

                <div className="space-y-4">
                  {/* Launch Date */}
                  <div>
                    <label className="text-sm font-medium text-slate-700 mb-2 block">Launch Date</label>
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
                    <label className="text-sm font-medium text-slate-700 mb-2 block">Completion Date</label>
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
              Clear All
            </Button>
            <div className="text-sm text-slate-600">
              Filters auto-apply as you change them
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
