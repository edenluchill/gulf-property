import { useTranslation } from 'react-i18next'
import { Label } from '../ui/label'
import { Slider } from '../ui/slider'
import { DatePicker } from '../ui/date-picker'
import { Calendar, Rocket, Home, Ban } from 'lucide-react'

interface DateTimeProgressSectionProps {
  formData: {
    launchDate?: string
    completionDate: string
    handoverDate?: string
    constructionProgress?: number
    status?: string
  }
  isProcessing: boolean
  onChange: (field: string, value: string | number) => void
}

export function DateTimeProgressSection({
  formData,
  isProcessing,
  onChange
}: DateTimeProgressSectionProps) {
  const { t } = useTranslation('upload')

  // Parse construction progress percentage
  const progressValue = formData.constructionProgress
    ? formData.constructionProgress
    : 0

  // Check if project is sold out
  const isSoldOut = formData.status === 'sold-out'

  const handleProgressChange = (value: number[]) => {
    onChange('constructionProgress', `${value[0]}`)
  }

  const handleSoldOutToggle = (checked: boolean) => {
    if (checked) {
      onChange('status', 'sold-out')
    } else {
      // Reset to default status based on progress
      if (progressValue === 100) {
        onChange('status', 'completed')
      } else if (progressValue > 0) {
        onChange('status', 'under-construction')
      } else {
        onChange('status', 'upcoming')
      }
    }
  }

  // Get progress color based on completion
  const getProgressColor = (progress: number) => {
    if (progress >= 80) return 'bg-green-500'
    if (progress >= 50) return 'bg-blue-500'
    if (progress >= 25) return 'bg-teal-500'
    return 'bg-red-500'
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="h-8 w-1 bg-teal-500 rounded-full"></div>
        <div>
          <h3 className="text-lg font-bold text-gray-900">{t('dateProgress.title')}</h3>
          <p className="text-sm text-gray-600">{t('dateProgress.subtitle')}</p>
        </div>
      </div>
      
      {/* Date Section */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Launch Date */}
        <div className="space-y-2">
          <Label className="text-sm flex items-center gap-2">
            <Rocket className="h-4 w-4 text-blue-600" />
            {t('dateProgress.launchDate')}
          </Label>
          <DatePicker
            value={formData.launchDate || ''}
            onChange={(value) => onChange('launchDate', value)}
            disabled={isProcessing}
            placeholder={t('dateProgress.launchDatePlaceholder')}
            showPresets={true}
          />
          <p className="text-xs text-gray-500">{t('dateProgress.launchDateHint')}</p>
        </div>

        {/* Completion Date */}
        <div className="space-y-2">
          <Label className="text-sm flex items-center gap-2">
            <Calendar className="h-4 w-4 text-green-600" />
            {t('dateProgress.completionDate')}
          </Label>
          <DatePicker
            value={formData.completionDate || ''}
            onChange={(value) => onChange('completionDate', value)}
            disabled={isProcessing}
            placeholder={t('dateProgress.completionDatePlaceholder')}
            required={true}
            showPresets={true}
          />
          <p className="text-xs text-gray-500">{t('dateProgress.completionDateHint')}</p>
        </div>

        {/* Handover Date */}
        <div className="space-y-2">
          <Label className="text-sm flex items-center gap-2">
            <Home className="h-4 w-4 text-purple-600" />
            {t('dateProgress.handoverDate')}
          </Label>
          <DatePicker
            value={formData.handoverDate || ''}
            onChange={(value) => onChange('handoverDate', value)}
            disabled={isProcessing}
            placeholder={t('dateProgress.handoverDatePlaceholder')}
            showPresets={true}
          />
          <p className="text-xs text-gray-500">{t('dateProgress.handoverDateHint')}</p>
        </div>
      </div>

      {/* Sold Out Toggle */}
      <div className="pt-4">
        <label className={`flex items-center gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all ${
          isSoldOut
            ? 'bg-red-50 border-red-300 shadow-md'
            : 'bg-gray-50 border-gray-200 hover:border-gray-300'
        }`}>
          <input
            type="checkbox"
            checked={isSoldOut}
            onChange={(e) => handleSoldOutToggle(e.target.checked)}
            disabled={isProcessing}
            className="w-5 h-5 rounded border-2 border-gray-300 text-red-600 focus:ring-2 focus:ring-red-500"
          />
          <Ban className={`h-5 w-5 ${isSoldOut ? 'text-red-600' : 'text-gray-400'}`} />
          <div className="flex-1">
            <span className={`font-semibold ${isSoldOut ? 'text-red-800' : 'text-gray-700'}`}>
              {t('dateProgress.soldOut', '已售罄 (Sold Out)')}
            </span>
            <p className="text-xs text-gray-500 mt-0.5">
              {t('dateProgress.soldOutHint', '勾选此项表示项目已售罄，将在地图和列表中显示售罄标签')}
            </p>
          </div>
          {isSoldOut && (
            <span className="px-3 py-1 bg-red-600 text-white text-xs font-bold rounded-full">
              SOLD OUT
            </span>
          )}
        </label>
      </div>

      {/* Construction Progress Slider */}
      <div className={`space-y-4 pt-4 transition-opacity ${isSoldOut ? 'opacity-50 pointer-events-none' : ''}`}>
        <div className="flex items-center justify-between">
          <Label className="text-sm font-semibold flex items-center gap-2">
            {t('dateProgress.constructionProgress')}
            {isSoldOut && <span className="text-xs text-gray-400 font-normal">({t('dateProgress.disabled', '已禁用')})</span>}
          </Label>
          <div className="flex items-center gap-2">
            <span className={`text-2xl font-bold ${
              progressValue >= 80 ? 'text-green-600' :
              progressValue >= 50 ? 'text-blue-600' :
              progressValue >= 25 ? 'text-teal-600' :
              'text-red-600'
            }`}>
              {progressValue}%
            </span>
          </div>
        </div>

        {/* Progress Slider */}
        <div className="space-y-3">
          <Slider
            value={[progressValue]}
            onValueChange={handleProgressChange}
            max={100}
            step={5}
            disabled={isProcessing || isSoldOut}
            className={isSoldOut ? 'cursor-not-allowed' : 'cursor-pointer'}
          />
          
          {/* Progress Bar Visualization */}
          <div className="relative h-8 bg-gray-100 rounded-lg overflow-hidden shadow-inner">
            <div 
              className={`h-full ${getProgressColor(progressValue)} transition-all duration-500 ease-out flex items-center justify-end pr-3`}
              style={{ width: `${progressValue}%` }}
            >
              {progressValue > 10 && (
                <span className="text-xs font-bold text-white drop-shadow">
                  {progressValue}%
                </span>
              )}
            </div>
          </div>

          {/* Progress Milestones */}
          <div className="flex justify-between text-xs text-gray-500 px-1">
            <span className={progressValue >= 0 ? 'font-semibold text-gray-700' : ''}>
              {t('dateProgress.groundBreaking')}
            </span>
            <span className={progressValue >= 25 ? 'font-semibold text-teal-700' : ''}>
              25%
            </span>
            <span className={progressValue >= 50 ? 'font-semibold text-blue-700' : ''}>
              50%
            </span>
            <span className={progressValue >= 75 ? 'font-semibold text-green-700' : ''}>
              75%
            </span>
            <span className={progressValue === 100 ? 'font-semibold text-green-700' : ''}>
              {t('dateProgress.completion')}
            </span>
          </div>

          {/* Progress Status Description */}
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg p-4 border border-blue-200">
            <p className="text-sm text-gray-700">
              <span className="font-semibold">{t('dateProgress.currentStatus')}</span>
              {progressValue === 0 && t('dateProgress.notStarted')}
              {progressValue > 0 && progressValue < 25 && t('dateProgress.earlyConstruction')}
              {progressValue >= 25 && progressValue < 50 && t('dateProgress.foundation')}
              {progressValue >= 50 && progressValue < 75 && t('dateProgress.structureComplete')}
              {progressValue >= 75 && progressValue < 100 && t('dateProgress.interiorFitout')}
              {progressValue === 100 && t('dateProgress.completed')}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
