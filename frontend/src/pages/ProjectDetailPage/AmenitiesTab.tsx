import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { useTranslation } from 'react-i18next'

interface AmenitiesTabProps {
  amenities: string[]
}

export function AmenitiesTab({ amenities }: AmenitiesTabProps) {
  const { t } = useTranslation(['project', 'common'])

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

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('project:amenitiesTab.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {amenities.map((amenity, index) => (
            <div
              key={index}
              className="flex items-center p-4 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors"
            >
              <div className="w-3 h-3 bg-primary rounded-full mr-3"></div>
              <span className="text-slate-700">{amenity}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
