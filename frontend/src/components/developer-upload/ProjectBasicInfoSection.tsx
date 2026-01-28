import { useTranslation } from 'react-i18next'
import { useState, useEffect } from 'react'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Button } from '../ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { MapPin } from 'lucide-react'
import { fetchDubaiAreas } from '../../lib/api'

interface ProjectBasicInfoSectionProps {
  formData: {
    projectName: string
    developer: string
    address: string
    area: string
    description: string
    latitude?: number
    longitude?: number
  }
  isProcessing: boolean
  onChange: (field: string, value: string) => void
  onOpenMapPicker: () => void
}

export function ProjectBasicInfoSection({
  formData,
  isProcessing,
  onChange,
  onOpenMapPicker
}: ProjectBasicInfoSectionProps) {
  const { t } = useTranslation('upload')
  const [dubaiAreas, setDubaiAreas] = useState<string[]>([])
  const [isLoadingAreas, setIsLoadingAreas] = useState(true)

  // Load Dubai areas on mount
  useEffect(() => {
    const loadAreas = async () => {
      try {
        const areas = await fetchDubaiAreas()
        const areaNames = areas.map(a => a.name).sort()
        setDubaiAreas(areaNames)
      } catch (error) {
        console.error('Failed to load Dubai areas:', error)
      } finally {
        setIsLoadingAreas(false)
      }
    }
    loadAreas()
  }, [])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 mb-4">
        <div className="h-10 w-1 bg-gradient-to-b from-blue-500 to-indigo-500 rounded-full"></div>
        <div>
          <h3 className="text-xl font-bold text-gray-900">{t('basicInfo.title')}</h3>
          <p className="text-sm text-gray-600">{t('basicInfo.subtitle')}</p>
        </div>
      </div>
      
      {/* Project Name & Developer */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label className="text-sm">{t('basicInfo.projectName')}</Label>
          <Input
            value={formData.projectName}
            onChange={(e) => onChange('projectName', e.target.value)}
            disabled={isProcessing}
            className={isProcessing ? 'bg-amber-50 animate-pulse' : ''}
            required
          />
        </div>
        <div>
          <Label className="text-sm">{t('basicInfo.developer')}</Label>
          <Input
            value={formData.developer}
            onChange={(e) => onChange('developer', e.target.value)}
            disabled={isProcessing}
            className={isProcessing ? 'bg-amber-50 animate-pulse' : ''}
            required
          />
        </div>
      </div>

      {/* Address */}
      <div>
        <Label className="text-sm">{t('basicInfo.address')}</Label>
        <Input
          value={formData.address}
          onChange={(e) => onChange('address', e.target.value)}
          disabled={isProcessing}
          className={isProcessing ? 'bg-amber-50 animate-pulse' : ''}
          required
        />
      </div>

      {/* Area - Dropdown from Dubai Areas */}
      <div>
        <Label className="text-sm">{t('basicInfo.area')}</Label>
        <Select
          value={formData.area}
          onValueChange={(value) => onChange('area', value)}
          disabled={isProcessing || isLoadingAreas}
        >
          <SelectTrigger className={isProcessing ? 'bg-amber-50 animate-pulse' : ''}>
            <SelectValue placeholder={isLoadingAreas ? 'Loading areas...' : t('basicInfo.areaPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            {dubaiAreas.length > 0 ? (
              dubaiAreas.map((areaName) => (
                <SelectItem key={areaName} value={areaName}>
                  {areaName}
                </SelectItem>
              ))
            ) : (
              <SelectItem value="__loading__" disabled>
                {isLoadingAreas ? 'Loading...' : 'No areas available'}
              </SelectItem>
            )}
          </SelectContent>
        </Select>
        <p className="text-xs text-gray-500 mt-1">
          Select from Dubai districts (synced with map areas)
        </p>
      </div>

      {/* Description */}
      <div>
        <Label className="text-sm">{t('basicInfo.description')}</Label>
        <textarea
          value={formData.description}
          onChange={(e) => onChange('description', e.target.value)}
          disabled={isProcessing}
          rows={3}
          className={`w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 ${
            isProcessing ? 'bg-amber-50 animate-pulse' : ''
          }`}
          placeholder={t('basicInfo.descriptionPlaceholder')}
        />
      </div>

      {/* Location Coordinates */}
      <div className="space-y-3">
        <Label className="text-sm font-semibold flex items-center gap-2">
          <MapPin className="h-4 w-4 text-amber-600" />
          {t('basicInfo.mapLocation')}
        </Label>
        
        {formData.latitude && formData.longitude ? (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium text-gray-700">{t('basicInfo.latitude')}</span>
                  <span className="font-mono font-bold text-green-700">
                    {formData.latitude.toFixed(6)}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium text-gray-700">{t('basicInfo.longitude')}</span>
                  <span className="font-mono font-bold text-green-700">
                    {formData.longitude.toFixed(6)}
                  </span>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onOpenMapPicker}
                disabled={isProcessing}
              >
                <MapPin className="h-3 w-3 mr-1" />
                {t('basicInfo.reselect')}
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            className="w-full border-dashed border-2 border-amber-300 hover:border-amber-500 hover:bg-amber-50"
            onClick={onOpenMapPicker}
            disabled={isProcessing}
          >
            <MapPin className="mr-2 h-4 w-4 text-amber-600" />
            {t('basicInfo.clickMapToSelect')}
          </Button>
        )}
      </div>
    </div>
  )
}
