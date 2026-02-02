import { useTranslation } from 'react-i18next'
import { Trophy, TrendingUp, Home, MapPin, Wallet, Lightbulb, CheckCircle2 } from 'lucide-react'
import { ComparisonReport, ComparisonPropertyData } from '../../types/comparison'

interface AnalysisReportProps {
  report: ComparisonReport
  properties: ComparisonPropertyData[]
}

// Color scheme for comparison items A, B, C, D
const ITEM_COLORS = [
  { bg: 'bg-teal-500', text: 'text-teal-600', label: 'A' },
  { bg: 'bg-emerald-500', text: 'text-emerald-600', label: 'B' },
  { bg: 'bg-blue-500', text: 'text-blue-600', label: 'C' },
  { bg: 'bg-purple-500', text: 'text-purple-600', label: 'D' },
]

export function AnalysisReport({ report, properties }: AnalysisReportProps) {
  const { t } = useTranslation('favorites')

  const getConfidenceColor = (confidence: string) => {
    switch (confidence) {
      case 'high':
        return 'text-emerald-600 bg-emerald-50'
      case 'medium':
        return 'text-amber-600 bg-amber-50'
      case 'low':
        return 'text-red-600 bg-red-50'
      default:
        return 'text-slate-600 bg-slate-50'
    }
  }

  const getWinnerProperty = () => {
    return properties[report.recommendation.winnerIndex] || properties[0]
  }

  const winner = getWinnerProperty()
  const winnerColor = ITEM_COLORS[report.recommendation.winnerIndex] || ITEM_COLORS[0]

  const dimensionIcons = {
    investment: TrendingUp,
    lifestyle: Home,
    location: MapPin,
    value: Wallet,
  }

  const dimensionKeys = ['investment', 'lifestyle', 'location', 'value'] as const

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center pb-4 border-b">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gradient-to-r from-teal-500 to-emerald-500 text-white mb-3">
          <Trophy className="h-6 w-6" />
        </div>
        <h3 className="text-lg font-semibold text-slate-800">{t('report.title')}</h3>
        <p className="text-xs text-slate-500 mt-1">
          Generated {new Date(report.createdAt).toLocaleDateString()}
        </p>
      </div>

      {/* Summary */}
      <div className="p-4 bg-slate-50 rounded-lg">
        <h4 className="font-medium text-slate-700 mb-2 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-teal-500" />
          {t('report.summary')}
        </h4>
        <p className="text-sm text-slate-600 leading-relaxed">{report.summary}</p>
      </div>

      {/* Recommendation */}
      <div className="p-4 border-2 border-teal-200 bg-teal-50/50 rounded-lg">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 relative">
            <div className="w-16 h-16 rounded-lg bg-white border overflow-hidden">
              {winner.imageUrl ? (
                <img
                  src={winner.imageUrl}
                  alt={winner.projectName}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-slate-100">
                  <Home className="h-6 w-6 text-slate-400" />
                </div>
              )}
            </div>
            {/* Winner badge */}
            <div className={`absolute -top-1 -left-1 w-5 h-5 rounded-full ${winnerColor.bg} text-white flex items-center justify-center text-xs font-bold shadow-lg`}>
              {winnerColor.label}
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Trophy className="h-4 w-4 text-amber-500" />
              <span className="text-sm font-medium text-slate-600">{t('report.recommendation')}</span>
            </div>
            <h4 className="font-semibold text-slate-800 truncate">
              {winner.unitTypeName || winner.projectName}
            </h4>
            {winner.unitTypeName && (
              <p className="text-xs text-slate-500 truncate">{winner.projectName}</p>
            )}
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs text-slate-500">{t('report.confidence')}:</span>
              <span className={`px-2 py-0.5 text-xs font-medium rounded ${getConfidenceColor(report.recommendation.confidence)}`}>
                {report.recommendation.confidence.toUpperCase()}
              </span>
            </div>
          </div>
        </div>

        {/* Reasons */}
        <div className="mt-4 pt-4 border-t border-teal-200">
          <h5 className="text-xs font-medium text-slate-600 mb-2">{t('report.reasons')}</h5>
          <ul className="space-y-1.5">
            {report.recommendation.reasons.map((reason, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                <CheckCircle2 className="h-4 w-4 text-teal-500 flex-shrink-0 mt-0.5" />
                {reason}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Detailed Scores */}
      <div className="space-y-4">
        <h4 className="font-medium text-slate-700">Detailed Analysis</h4>

        {dimensionKeys.map((dim) => {
          const Icon = dimensionIcons[dim]
          const data = report.dimensions[dim]
          const scores = data.scores

          return (
            <div key={dim} className="p-3 border rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-slate-500" />
                  <span className="text-sm font-medium text-slate-700">
                    {t(`report.dimensions.${dim}`)}
                  </span>
                </div>
              </div>

              {/* Score Bars - Dynamic for 2-4 properties */}
              <div className="space-y-2">
                {scores.map((score, idx) => {
                  const color = ITEM_COLORS[idx]
                  if (!color) return null

                  return (
                    <div key={idx} className="flex items-center gap-3">
                      <span className={`text-xs ${color.text} w-4 font-semibold`}>
                        {color.label}
                      </span>
                      <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${color.bg} rounded-full transition-all`}
                          style={{ width: `${score}%` }}
                        />
                      </div>
                      <span className="text-xs font-medium text-slate-600 w-8">{score}</span>
                    </div>
                  )
                })}
              </div>

              {/* Explanation */}
              <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                {data.explanation}
              </p>
            </div>
          )
        })}
      </div>

      {/* Personalized Advice */}
      <div className="p-4 bg-gradient-to-r from-teal-50 to-emerald-50 rounded-lg border border-teal-100">
        <h4 className="font-medium text-slate-700 mb-2 flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-amber-500" />
          {t('report.advice')}
        </h4>
        <p className="text-sm text-slate-600 leading-relaxed">
          {report.personalizedAdvice}
        </p>
      </div>
    </div>
  )
}
