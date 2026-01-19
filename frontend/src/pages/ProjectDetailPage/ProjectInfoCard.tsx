import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { 
  Heart, 
  MapPin, 
  Calendar, 
  Building2, 
  TrendingUp,
  Activity
} from 'lucide-react'
import { formatPrice, formatDate } from '../../lib/utils'
import { OffPlanProperty } from '../../types'

interface ProjectInfoCardProps {
  property: OffPlanProperty
  isFavorite: boolean
  onToggleFavorite: () => void
}

const statusColors = {
  'upcoming': 'bg-blue-100 text-blue-800',
  'under-construction': 'bg-yellow-100 text-yellow-800',
  'completed': 'bg-green-100 text-green-800',
}

const statusLabels = {
  'upcoming': 'Upcoming',
  'under-construction': 'Under Construction',
  'completed': 'Completed',
}

export function ProjectInfoCard({ property, isFavorite, onToggleFavorite }: ProjectInfoCardProps) {
  return (
    <Card className="h-fit">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <CardTitle className="text-3xl">{property.buildingName}</CardTitle>
              <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[property.status]}`}>
                {statusLabels[property.status]}
              </span>
            </div>
            {property.projectName && property.projectName !== property.buildingName && (
              <div className="text-lg text-slate-600 mb-2">{property.projectName}</div>
            )}
            <div className="flex items-center text-slate-600 mb-2">
              {property.developerLogoUrl ? (
                <img 
                  src={property.developerLogoUrl} 
                  alt={property.developer}
                  className="h-6 w-6 mr-2 object-contain"
                />
              ) : (
                <Building2 className="h-4 w-4 mr-1" />
              )}
              <span className="font-medium">{property.developer}</span>
            </div>
            <div className="flex items-center text-slate-600 mb-4">
              <MapPin className="h-4 w-4 mr-1" />
              <span>{property.areaName}</span>
            </div>
          </div>
          <Button
            variant={isFavorite ? "default" : "outline"}
            size="icon"
            onClick={onToggleFavorite}
          >
            <Heart className={`h-5 w-5 ${isFavorite ? 'fill-current' : ''}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Price Information */}
        <div>
          <div className="text-sm text-slate-600 mb-1">Starting Price</div>
          <div className="text-3xl font-bold text-primary">
            {property.startingPrice ? formatPrice(property.startingPrice) : 'Price on Request'}
          </div>
          {property.medianPriceSqft && (
            <div className="text-sm text-slate-600 mt-1">
              {formatPrice(property.medianPriceSqft)} per sq ft
            </div>
          )}
        </div>

        {/* Property Details */}
        <div className="grid grid-cols-2 gap-4 pt-4 border-t">
          <div>
            <div className="text-sm text-slate-600">Bedrooms</div>
            <div className="font-semibold text-lg">
              {property.minBedrooms === property.maxBedrooms 
                ? `${property.minBedrooms}` 
                : `${property.minBedrooms} - ${property.maxBedrooms}`}
            </div>
          </div>
          {property.minSize && (
            <div>
              <div className="text-sm text-slate-600">Size (sq ft)</div>
              <div className="font-semibold text-lg">
                {property.minSize === property.maxSize 
                  ? property.minSize.toLocaleString()
                  : `${property.minSize?.toLocaleString()} - ${property.maxSize?.toLocaleString()}`}
              </div>
            </div>
          )}
        </div>

        {/* Completion Progress */}
        {property.completionPercent !== undefined && (
          <div className="pt-4 border-t">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center text-sm text-slate-600">
                <Activity className="h-4 w-4 mr-1" />
                <span>Construction Progress</span>
              </div>
              <span className="font-semibold">{property.completionPercent}%</span>
            </div>
            <div className="w-full bg-slate-200 rounded-full h-2">
              <div 
                className="bg-primary h-2 rounded-full transition-all"
                style={{ width: `${property.completionPercent}%` }}
              />
            </div>
          </div>
        )}

        {/* Dates */}
        <div className="space-y-2 pt-4 border-t">
          {property.launchDate && (
            <div className="flex items-center space-x-2 text-slate-600">
              <TrendingUp className="h-4 w-4" />
              <span>Launched: {formatDate(property.launchDate)}</span>
            </div>
          )}
          {property.completionDate && (
            <div className="flex items-center space-x-2 text-slate-600">
              <Calendar className="h-4 w-4" />
              <span>Expected Completion: {formatDate(property.completionDate)}</span>
            </div>
          )}
        </div>

        {/* CTA Button */}
        <div className="pt-4 border-t">
          <Button className="w-full" size="lg">
            Request More Information
          </Button>
          {property.brochureUrl && (
            <Button 
              variant="outline" 
              className="w-full mt-2" 
              size="lg"
              onClick={() => window.open(property.brochureUrl, '_blank')}
            >
              Download Brochure
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
