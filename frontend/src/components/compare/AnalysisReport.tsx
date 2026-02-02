import { useTranslation } from 'react-i18next'
import { Trophy, TrendingUp, Home, MapPin, Wallet, Lightbulb, CheckCircle2, Medal, Award, Building2 } from 'lucide-react'
import { ComparisonReport, ComparisonPropertyData } from '../../types/comparison'

interface AnalysisReportProps {
  report: ComparisonReport
  properties: ComparisonPropertyData[]
}

// Color scheme for comparison items A, B, C, D
const ITEM_COLORS = [
  { bg: 'bg-teal-500', light: 'bg-teal-50', border: 'border-teal-300', text: 'text-teal-600', label: 'A' },
  { bg: 'bg-emerald-500', light: 'bg-emerald-50', border: 'border-emerald-300', text: 'text-emerald-600', label: 'B' },
  { bg: 'bg-blue-500', light: 'bg-blue-50', border: 'border-blue-300', text: 'text-blue-600', label: 'C' },
  { bg: 'bg-purple-500', light: 'bg-purple-50', border: 'border-purple-300', text: 'text-purple-600', label: 'D' },
]

// Medal colors for ranking
const RANK_STYLES = [
  { icon: Trophy, color: 'text-amber-500', bg: 'bg-amber-50', border: 'border-amber-300', label: '🥇' },
  { icon: Medal, color: 'text-slate-400', bg: 'bg-slate-50', border: 'border-slate-300', label: '🥈' },
  { icon: Award, color: 'text-amber-700', bg: 'bg-amber-50/50', border: 'border-amber-200', label: '🥉' },
  { icon: Award, color: 'text-slate-400', bg: 'bg-slate-50', border: 'border-slate-200', label: '4th' },
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

  // Calculate overall scores for ranking
  const calculateOverallScore = (index: number) => {
    const dims = report.dimensions
    const investmentScore = dims.investment.scores[index] || 0
    const lifestyleScore = dims.lifestyle.scores[index] || 0
    const locationScore = dims.location.scores[index] || 0
    const valueScore = dims.value.scores[index] || 0
    return (investmentScore + lifestyleScore + locationScore + valueScore) / 4
  }

  // Get ranked properties
  const rankedProperties = properties.map((prop, idx) => ({
    property: prop,
    index: idx,
    color: ITEM_COLORS[idx],
    overallScore: calculateOverallScore(idx),
  })).sort((a, b) => b.overallScore - a.overallScore)

  const winner = properties[report.recommendation.winnerIndex] || properties[0]
  const winnerColor = ITEM_COLORS[report.recommendation.winnerIndex] || ITEM_COLORS[0]

  const dimensionIcons = {
    investment: TrendingUp,
    lifestyle: Home,
    location: MapPin,
    value: Wallet,
  }

  const dimensionKeys = ['investment', 'lifestyle', 'location', 'value'] as const

  const formatPrice = (price: number) => {
    if (price >= 1000000) {
      return `AED ${(price / 1000000).toFixed(1)}M`
    }
    return `AED ${(price / 1000).toFixed(0)}K`
  }

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

      {/* All Properties Ranking */}
      <div className="space-y-3">
        <h4 className="font-medium text-slate-700 flex items-center gap-2">
          <Medal className="h-4 w-4 text-amber-500" />
          {t('report.ranking')}
        </h4>
        <div className="grid gap-3">
          {rankedProperties.map((item, rankIdx) => {
            const isWinner = item.index === report.recommendation.winnerIndex
            const rankStyle = RANK_STYLES[rankIdx]
            const prop = item.property

            return (
              <div
                key={item.index}
                className={`p-3 rounded-lg border-2 transition-all ${
                  isWinner
                    ? 'border-amber-400 bg-amber-50/50 shadow-md'
                    : `${item.color.border} ${item.color.light}`
                }`}
              >
                <div className="flex items-center gap-3">
                  {/* Rank Badge */}
                  <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-lg ${rankStyle.bg}`}>
                    {rankStyle.label}
                  </div>

                  {/* Property Image */}
                  <div className="flex-shrink-0 relative">
                    <div className="w-14 h-14 rounded-lg bg-white border overflow-hidden">
                      {prop.imageUrl ? (
                        <img
                          src={prop.imageUrl}
                          alt={prop.projectName}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-slate-100">
                          <Building2 className="h-5 w-5 text-slate-400" />
                        </div>
                      )}
                    </div>
                    {/* Label badge */}
                    <div className={`absolute -top-1 -left-1 w-5 h-5 rounded-full ${item.color.bg} text-white flex items-center justify-center text-xs font-bold shadow`}>
                      {item.color.label}
                    </div>
                  </div>

                  {/* Property Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h5 className="font-semibold text-slate-800 truncate text-sm">
                        {prop.unitTypeName || prop.projectName}
                      </h5>
                      {isWinner && (
                        <span className="px-1.5 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 rounded">
                          {t('report.recommended')}
                        </span>
                      )}
                    </div>
                    {prop.unitTypeName && (
                      <p className="text-xs text-slate-500 truncate">{prop.projectName}</p>
                    )}
                    <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                      <span>{prop.area}</span>
                      <span className={`font-semibold ${item.color.text}`}>
                        {formatPrice(prop.price)}
                      </span>
                    </div>
                  </div>

                  {/* Overall Score */}
                  <div className="flex-shrink-0 text-right">
                    <div className={`text-2xl font-bold ${item.color.text}`}>
                      {Math.round(item.overallScore)}
                    </div>
                    <div className="text-xs text-slate-500">{t('report.overallScore')}</div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Winner Recommendation Detail */}
      <div className="p-4 border-2 border-amber-300 bg-gradient-to-r from-amber-50 to-yellow-50 rounded-lg">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 relative">
            <div className="w-16 h-16 rounded-lg bg-white border-2 border-amber-200 overflow-hidden shadow-md">
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
            <div className={`absolute -top-2 -left-2 w-7 h-7 rounded-full ${winnerColor.bg} text-white flex items-center justify-center text-sm font-bold shadow-lg ring-2 ring-white`}>
              {winnerColor.label}
            </div>
            {/* Trophy */}
            <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-amber-400 text-white flex items-center justify-center shadow">
              <Trophy className="h-3.5 w-3.5" />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Trophy className="h-4 w-4 text-amber-500" />
              <span className="text-sm font-medium text-amber-700">{t('report.recommendation')}</span>
            </div>
            <h4 className="font-bold text-slate-800 truncate text-lg">
              {winner.unitTypeName || winner.projectName}
            </h4>
            {winner.unitTypeName && (
              <p className="text-sm text-slate-500 truncate">{winner.projectName}</p>
            )}
            <div className="flex items-center gap-3 mt-2">
              <span className="text-xs text-slate-500">{t('report.confidence')}:</span>
              <span className={`px-2 py-0.5 text-xs font-medium rounded ${getConfidenceColor(report.recommendation.confidence)}`}>
                {report.recommendation.confidence.toUpperCase()}
              </span>
            </div>
          </div>
        </div>

        {/* Reasons */}
        <div className="mt-4 pt-4 border-t border-amber-200">
          <h5 className="text-xs font-medium text-slate-600 mb-2">{t('report.reasons')}</h5>
          <ul className="space-y-1.5">
            {report.recommendation.reasons.map((reason, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                <CheckCircle2 className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
                {reason}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Detailed Scores */}
      <div className="space-y-4">
        <h4 className="font-medium text-slate-700">{t('report.detailedAnalysis')}</h4>

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
                      <span className="text-xs font-medium text-slate-600 w-8">{Math.round(score)}</span>
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
