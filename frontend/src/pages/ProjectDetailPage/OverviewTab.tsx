import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { formatPrice } from '../../lib/utils'
import { OffPlanProperty } from '../../types'

interface OverviewTabProps {
  property: OffPlanProperty
}

export function OverviewTab({ property }: OverviewTabProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>About This Property</CardTitle>
      </CardHeader>
      <CardContent>
        {property.buildingDescription ? (
          <p className="text-slate-600 leading-relaxed">{property.buildingDescription}</p>
        ) : (
          <p className="text-slate-600 leading-relaxed">
            {property.buildingName} is a premium off-plan development by {property.developer} 
            located in {property.areaName}, Dubai. This {property.status === 'upcoming' ? 'upcoming' : 
            property.status === 'under-construction' ? 'under construction' : 'completed'} project 
            offers {property.minBedrooms === property.maxBedrooms ? 
            `${property.minBedrooms}-bedroom` : 
            `${property.minBedrooms} to ${property.maxBedrooms}-bedroom`} units.
          </p>
        )}
        
        {/* Project Statistics */}
        <div className="mt-6 grid grid-cols-2 md:grid-cols-3 gap-4">
          {property.unitCount && (
            <div className="p-4 bg-slate-50 rounded-lg">
              <div className="text-2xl font-bold text-primary">{property.unitCount}</div>
              <div className="text-sm text-slate-600">Total Units</div>
            </div>
          )}
          {property.salesVolume && (
            <div className="p-4 bg-slate-50 rounded-lg">
              <div className="text-2xl font-bold text-primary">
                {property.salesVolume.toLocaleString()}
              </div>
              <div className="text-sm text-slate-600">Sales Volume</div>
            </div>
          )}
          {property.medianRentPerUnit && (
            <div className="p-4 bg-slate-50 rounded-lg">
              <div className="text-xl font-bold text-primary">
                {formatPrice(property.medianRentPerUnit)}
              </div>
              <div className="text-sm text-slate-600">Median Rent/Unit</div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
