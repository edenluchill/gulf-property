import { Label } from '../ui/label'
import { Slider } from '../ui/slider'
import { DatePicker } from '../ui/date-picker'
import { Calendar, Rocket, Home } from 'lucide-react'

interface DateTimeProgressSectionProps {
  formData: {
    launchDate?: string
    completionDate: string
    handoverDate?: string
    constructionProgress?: number
  }
  isProcessing: boolean
  onChange: (field: string, value: string | number) => void
}

export function DateTimeProgressSection({
  formData,
  isProcessing,
  onChange
}: DateTimeProgressSectionProps) {
  // Parse construction progress percentage
  const progressValue = formData.constructionProgress 
    ? formData.constructionProgress
    : 0

  const handleProgressChange = (value: number[]) => {
    onChange('constructionProgress', `${value[0]}`)
  }

  // Get progress color based on completion
  const getProgressColor = (progress: number) => {
    if (progress >= 80) return 'bg-green-500'
    if (progress >= 50) return 'bg-blue-500'
    if (progress >= 25) return 'bg-amber-500'
    return 'bg-red-500'
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="h-10 w-1 bg-gradient-to-b from-purple-500 to-pink-500 rounded-full"></div>
        <div>
          <h3 className="text-xl font-bold text-gray-900">📅 日期与进度</h3>
          <p className="text-sm text-gray-600">项目时间线和建设进度</p>
        </div>
      </div>
      
      {/* Date Section */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Launch Date */}
        <div className="space-y-2">
          <Label className="text-sm flex items-center gap-2">
            <Rocket className="h-4 w-4 text-blue-600" />
            发布日期
          </Label>
          <DatePicker
            value={formData.launchDate || ''}
            onChange={(value) => onChange('launchDate', value)}
            disabled={isProcessing}
            placeholder="选择发布日期"
            showPresets={true}
          />
          <p className="text-xs text-gray-500">项目首次对外发布的日期</p>
        </div>

        {/* Completion Date */}
        <div className="space-y-2">
          <Label className="text-sm flex items-center gap-2">
            <Calendar className="h-4 w-4 text-green-600" />
            完工日期 *
          </Label>
          <DatePicker
            value={formData.completionDate || ''}
            onChange={(value) => onChange('completionDate', value)}
            disabled={isProcessing}
            placeholder="选择完工日期"
            required={true}
            showPresets={true}
          />
          <p className="text-xs text-gray-500">建筑预计完工的日期</p>
        </div>

        {/* Handover Date */}
        <div className="space-y-2">
          <Label className="text-sm flex items-center gap-2">
            <Home className="h-4 w-4 text-purple-600" />
            交付日期
          </Label>
          <DatePicker
            value={formData.handoverDate || ''}
            onChange={(value) => onChange('handoverDate', value)}
            disabled={isProcessing}
            placeholder="选择交付日期"
            showPresets={true}
          />
          <p className="text-xs text-gray-500">业主可以收楼的日期</p>
        </div>
      </div>

      {/* Construction Progress Slider */}
      <div className="space-y-4 pt-4">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-semibold flex items-center gap-2">
            🏗️ 建设进度
          </Label>
          <div className="flex items-center gap-2">
            <span className={`text-2xl font-bold ${
              progressValue >= 80 ? 'text-green-600' : 
              progressValue >= 50 ? 'text-blue-600' : 
              progressValue >= 25 ? 'text-amber-600' : 
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
            disabled={isProcessing}
            className="cursor-pointer"
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
              开工
            </span>
            <span className={progressValue >= 25 ? 'font-semibold text-amber-700' : ''}>
              25%
            </span>
            <span className={progressValue >= 50 ? 'font-semibold text-blue-700' : ''}>
              50%
            </span>
            <span className={progressValue >= 75 ? 'font-semibold text-green-700' : ''}>
              75%
            </span>
            <span className={progressValue === 100 ? 'font-semibold text-green-700' : ''}>
              完工
            </span>
          </div>

          {/* Progress Status Description */}
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg p-4 border border-blue-200">
            <p className="text-sm text-gray-700">
              <span className="font-semibold">当前状态: </span>
              {progressValue === 0 && '尚未开工'}
              {progressValue > 0 && progressValue < 25 && '初期施工阶段'}
              {progressValue >= 25 && progressValue < 50 && '基础建设阶段'}
              {progressValue >= 50 && progressValue < 75 && '主体结构完成'}
              {progressValue >= 75 && progressValue < 100 && '内部装修阶段'}
              {progressValue === 100 && '✅ 已完工'}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
