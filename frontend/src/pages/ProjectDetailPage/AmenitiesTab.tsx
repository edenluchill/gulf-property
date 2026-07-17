import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { useTranslation } from 'react-i18next'
import { groupAmenities, CATEGORY_META } from '../../lib/amenityCategory'

interface AmenitiesTabProps {
  amenities: string[]
}

export function AmenitiesTab({ amenities }: AmenitiesTabProps) {
  const { t: tRaw } = useTranslation(['project', 'common'])
  // 品类键是运行时拼的 → t 收成字面量联合类型,必须 cast(同 spec 的 casted t 约定)
  const t = tRaw as (k: string, o?: Record<string, unknown>) => string

  if (amenities.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('project:amenitiesTab.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-slate-600">
            <p>{t('project:amenitiesTab.emptyMessage')}</p>
            <Button className="mt-4">{t('common:buttons.requestDetailedInfo')}</Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  const groups = groupAmenities(amenities)

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('project:amenitiesTab.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-5">
          {groups.map(({ cat, items }) => {
            const meta = CATEGORY_META[cat]
            const Icon = meta.icon
            return (
              <div key={cat}>
                <div className="mb-2.5 flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="text-sm font-semibold text-slate-900">{t(`project:amenityCat.${cat}`)}</span>
                  <span className="text-xs text-slate-400">{items.length}</span>
                </div>
                <div className="flex flex-wrap gap-2 ps-9">
                  {items.map((a, i) => (
                    <span key={i} className="rounded-full bg-slate-100 px-3 py-1.5 text-sm text-slate-700">
                      {a}
                    </span>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
