/**
 * AboutSheet - 介绍 Pinzos app 的功能
 */

import { createPortal } from 'react-dom'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetClose } from './ui/sheet'
import { MapPin, Sparkles, Building2, TrendingUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface AboutSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Only 4 core features - fits in one screen without scrolling
const features = [
  {
    icon: MapPin,
    color: 'text-teal-500',
    bg: 'bg-teal-50',
    titleKey: 'about.features.mapExplore.title',
    titleFallback: 'Interactive Map',
    descKey: 'about.features.mapExplore.desc',
    descFallback: 'Browse all off-plan projects on an interactive map with location insights.'
  },
  {
    icon: Sparkles,
    color: 'text-purple-500',
    bg: 'bg-purple-50',
    titleKey: 'about.features.aiInsights.title',
    titleFallback: 'AI-Powered Insights',
    descKey: 'about.features.aiInsights.desc',
    descFallback: 'Instant analysis of brochures, pricing trends, and investment potential.'
  },
  {
    icon: TrendingUp,
    color: 'text-emerald-500',
    bg: 'bg-emerald-50',
    titleKey: 'about.features.marketData.title',
    titleFallback: 'Real Market Data',
    descKey: 'about.features.marketData.desc',
    descFallback: 'Historical transactions, price trends, rental yields by area.'
  },
  {
    icon: Building2,
    color: 'text-blue-500',
    bg: 'bg-blue-50',
    titleKey: 'about.features.verifiedProjects.title',
    titleFallback: 'Verified Projects',
    descKey: 'about.features.verifiedProjects.desc',
    descFallback: 'All listings from verified developers with payment plans.'
  }
]

export default function AboutSheet({ open, onOpenChange }: AboutSheetProps) {
  const { t } = useTranslation()

  // Use portal to render at body level, above all stacking contexts (including map)
  return createPortal(
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-auto max-h-[60vh] rounded-t-2xl">
        <SheetClose onClick={() => onOpenChange(false)} />

        {/* Drag handle */}
        <div className="flex justify-center pt-2 pb-1">
          <div className="w-10 h-1 bg-slate-300 rounded-full" />
        </div>

        <SheetHeader className="border-b-0 pb-1">
          <SheetTitle className="text-center text-lg">
            {t('about.title', 'About Pinzos')}
          </SheetTitle>
          <p className="text-center text-xs text-slate-500">
            {t('about.hero', 'Pin Projects on the Map. See Value.')}
          </p>
        </SheetHeader>

        <div className="px-4 pb-5">
          {/* Features - compact */}
          <div className="space-y-2">
            {features.map((feature, index) => (
              <div
                key={index}
                className="flex gap-2.5 p-2.5 rounded-lg bg-slate-50/80"
              >
                <div className={`flex-shrink-0 w-8 h-8 rounded-lg ${feature.bg} flex items-center justify-center`}>
                  <feature.icon className={`w-4 h-4 ${feature.color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-slate-800 text-sm leading-tight">
                    {t(feature.titleKey, feature.titleFallback)}
                  </h3>
                  <p className="text-[11px] text-slate-500 leading-snug">
                    {t(feature.descKey, feature.descFallback)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>,
    document.body
  )
}
