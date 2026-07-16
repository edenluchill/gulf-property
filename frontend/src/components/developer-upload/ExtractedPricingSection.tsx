/**
 * Extracted Pricing Section
 *
 * Displays the raw pricing data extracted from PDF for verification
 */

import { useTranslation } from 'react-i18next'
import { DollarSign, Tag, Building2, FileText } from 'lucide-react'

interface ExtractedPricingEntry {
  unitTypeName?: string
  unitCategory?: string
  building?: string
  price: number
  pricePerSqft?: number
  area?: number
  isStartingFrom?: boolean
  sourcePageNumber: number
}

interface ExtractedPricingSectionProps {
  pricing?: ExtractedPricingEntry[]
  isProcessing?: boolean
}

function formatPrice(price: number): string {
  if (price >= 1000000) {
    return `${(price / 1000000).toFixed(2)}M AED`
  }
  return `${price.toLocaleString()} AED`
}

export function ExtractedPricingSection({
  pricing,
  isProcessing
}: ExtractedPricingSectionProps) {
  const { t } = useTranslation('upload')

  if (!pricing || pricing.length === 0) {
    if (isProcessing) {
      return null
    }
    return null
  }

  // Group by building
  const groupedByBuilding = pricing.reduce((acc, entry) => {
    const building = entry.building || 'Unknown'
    if (!acc[building]) acc[building] = []
    acc[building].push(entry)
    return acc
  }, {} as Record<string, ExtractedPricingEntry[]>)

  return (
    <div className="space-y-4 pt-6 border-t-2 border-gray-100">
      <div className="flex items-center gap-3 mb-4">
        <div className="h-8 w-1 bg-teal-500 rounded-full"></div>
        <div>
          <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-amber-600" />
            {t('extractedPricing.title', 'Extracted Pricing')}
          </h3>
          <p className="text-sm text-gray-600">
            {t('extractedPricing.subtitle', `${pricing.length} pricing entries extracted from PDF`)}
          </p>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4">
        <div className="flex items-start gap-3">
          <span className="text-xl">💡</span>
          <div className="text-sm text-amber-800">
            <p className="font-medium">{t('extractedPricing.hint', 'Verification Data')}</p>
            <p className="mt-1 text-amber-700">
              {t('extractedPricing.hintDesc', 'This shows raw pricing data extracted from the PDF. Compare with unit types above to verify correct price matching.')}
            </p>
          </div>
        </div>
      </div>

      {Object.entries(groupedByBuilding).map(([building, entries]) => (
        <div key={building} className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
          <div className="bg-gradient-to-r from-amber-100 to-orange-100 px-4 py-3 border-b border-amber-200">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-amber-700" />
              <span className="font-semibold text-amber-900">{building}</span>
              <span className="text-xs bg-amber-200 text-amber-800 px-2 py-0.5 rounded-full">
                {entries.length} {t('extractedPricing.entries', 'entries')}
              </span>
            </div>
          </div>

          <div className="divide-y divide-gray-100">
            {entries.map((entry, idx) => (
              <div key={idx} className="px-4 py-3 hover:bg-gray-50 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {entry.unitTypeName ? (
                      <div className="flex items-center gap-2">
                        <Tag className="h-4 w-4 text-gray-400" />
                        <span className="font-medium text-gray-900">{entry.unitTypeName}</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500">{entry.unitCategory || 'Unknown'}</span>
                      </div>
                    )}
                    {entry.unitCategory && entry.unitTypeName && (
                      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                        {entry.unitCategory}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="text-end">
                      <div className="font-bold text-gray-900">
                        {entry.isStartingFrom && (
                          <span className="text-xs text-gray-500 font-normal me-1">
                            {t('extractedPricing.startingFrom', 'Starting from')}
                          </span>
                        )}
                        {formatPrice(entry.price)}
                      </div>
                      {entry.pricePerSqft && (
                        <div className="text-xs text-gray-500">
                          {entry.pricePerSqft.toLocaleString()} AED/sqft
                        </div>
                      )}
                    </div>
                    {entry.area && (
                      <div className="text-sm text-gray-600 border-s border-gray-200 ps-4">
                        {entry.area.toLocaleString()} sqft
                      </div>
                    )}
                    <div className="flex items-center gap-1 text-xs text-gray-400 border-s border-gray-200 ps-4">
                      <FileText className="h-3 w-3" />
                      <span>p.{entry.sourcePageNumber}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
