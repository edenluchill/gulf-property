import { useParams, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { formatPrice, formatDate } from '../lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { Button } from '../components/ui/button'
import { 
  Heart, 
  MapPin, 
  Calendar, 
  Building2, 
  BedDouble, 
  ArrowLeft,
  TrendingUp,
  Activity
} from 'lucide-react'
import { useState, useEffect } from 'react'
import { isFavorite, addFavorite, removeFavorite } from '../lib/favorites'
import { MapContainer, TileLayer, Marker } from 'react-leaflet'
import { fetchPropertyById } from '../lib/api'
import { OffPlanProperty } from '../types'

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [property, setProperty] = useState<OffPlanProperty | null>(null)
  const [loading, setLoading] = useState(true)
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [isFav, setIsFav] = useState(false)

  useEffect(() => {
    if (id) {
      setLoading(true)
      fetchPropertyById(id).then((data) => {
        setProperty(data)
        setLoading(false)
        if (data) {
          setIsFav(isFavorite(data.id))
        }
      })
    }
  }, [id])

  const handleToggleFavorite = () => {
    if (!property) return
    
    if (isFav) {
      removeFavorite(property.id)
    } else {
      addFavorite(property.id)
    }
    setIsFav(!isFav)
  }

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-16 text-center">
        <div className="text-xl">Loading property details...</div>
      </div>
    )
  }

  if (!property) {
    return (
      <div className="container mx-auto px-4 py-16 text-center">
        <h1 className="text-3xl font-bold mb-4">Property Not Found</h1>
        <Link to="/map">
          <Button>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Properties
          </Button>
        </Link>
      </div>
    )
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

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Back Button */}
      <div className="bg-white border-b">
        <div className="container mx-auto px-4 py-4">
          <Link to="/map">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Properties
            </Button>
          </Link>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          {/* Image Gallery */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
            <div className="relative h-96 lg:h-[600px] rounded-lg overflow-hidden">
              {property.images.length > 0 ? (
                <>
                  <img
                    src={property.images[currentImageIndex]}
                    alt={property.buildingName}
                    className="w-full h-full object-cover"
                  />
                  {property.images.length > 1 && (
                    <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex space-x-2">
                      {property.images.map((_, index) => (
                        <button
                          key={index}
                          onClick={() => setCurrentImageIndex(index)}
                          className={`w-3 h-3 rounded-full transition-all ${
                            index === currentImageIndex
                              ? 'bg-white w-8'
                              : 'bg-white/50'
                          }`}
                        />
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="w-full h-full bg-slate-200 flex items-center justify-center">
                  <Building2 className="h-24 w-24 text-slate-400" />
                </div>
              )}
            </div>

            {/* Project Info Card */}
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
                    variant={isFav ? "default" : "outline"}
                    size="icon"
                    onClick={handleToggleFavorite}
                  >
                    <Heart className={`h-5 w-5 ${isFav ? 'fill-current' : ''}`} />
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
          </div>

          {/* Tabs Section */}
          <Tabs defaultValue="overview" className="space-y-6">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="floorplans">Floor Plans</TabsTrigger>
              <TabsTrigger value="amenities">Amenities</TabsTrigger>
              <TabsTrigger value="location">Location</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-6">
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
            </TabsContent>

            <TabsContent value="floorplans">
              <Card>
                <CardHeader>
                  <CardTitle>Available Configurations</CardTitle>
                </CardHeader>
                <CardContent>
                  {property.bedsDescription ? (
                    <div className="mb-6">
                      <p className="text-slate-600">{property.bedsDescription}</p>
                    </div>
                  ) : null}
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Bedroom Range */}
                    <div className="p-6 bg-slate-50 rounded-lg">
                      <div className="flex items-center mb-4">
                        <BedDouble className="h-6 w-6 text-primary mr-2" />
                        <h3 className="font-semibold text-lg">Bedroom Options</h3>
                      </div>
                      <div className="text-3xl font-bold text-primary mb-2">
                        {property.minBedrooms === property.maxBedrooms 
                          ? `${property.minBedrooms} BR`
                          : `${property.minBedrooms} - ${property.maxBedrooms} BR`}
                      </div>
                      <p className="text-sm text-slate-600">
                        {property.minBedrooms === property.maxBedrooms 
                          ? `${property.minBedrooms}-bedroom units available`
                          : `From ${property.minBedrooms} to ${property.maxBedrooms} bedrooms`}
                      </p>
                    </div>

                    {/* Size Range */}
                    {property.minSize && property.maxSize && (
                      <div className="p-6 bg-slate-50 rounded-lg">
                        <div className="flex items-center mb-4">
                          <Building2 className="h-6 w-6 text-primary mr-2" />
                          <h3 className="font-semibold text-lg">Unit Sizes</h3>
                        </div>
                        <div className="text-3xl font-bold text-primary mb-2">
                          {property.minSize === property.maxSize 
                            ? property.minSize.toLocaleString()
                            : `${property.minSize.toLocaleString()} - ${property.maxSize.toLocaleString()}`}
                        </div>
                        <p className="text-sm text-slate-600">Square feet</p>
                      </div>
                    )}
                  </div>

                  <div className="mt-6 p-4 bg-blue-50 rounded-lg text-center">
                    <p className="text-slate-600 mb-3">Interested in specific floor plans?</p>
                    <Button>Contact Developer for Floor Plans</Button>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="amenities">
              <Card>
                <CardHeader>
                  <CardTitle>Amenities & Facilities</CardTitle>
                </CardHeader>
                <CardContent>
                  {property.amenities.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {property.amenities.map((amenity, index) => (
                        <div
                          key={index}
                          className="flex items-center p-4 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors"
                        >
                          <div className="w-3 h-3 bg-primary rounded-full mr-3"></div>
                          <span className="text-slate-700">{amenity}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-slate-600">
                      <p>Amenities information will be available soon.</p>
                      <Button className="mt-4">Request Detailed Information</Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="location">
              <Card>
                <CardHeader>
                  <CardTitle>Location</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-96 rounded-lg overflow-hidden">
                    <MapContainer
                      center={[property.location.lat, property.location.lng]}
                      zoom={15}
                      className="h-full w-full"
                    >
                      <TileLayer
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                      />
                      <Marker position={[property.location.lat, property.location.lng]} />
                    </MapContainer>
                  </div>
                  <div className="mt-4 p-4 bg-slate-50 rounded-lg">
                    <div className="flex items-start">
                      <MapPin className="h-5 w-5 text-primary mr-2 mt-0.5" />
                      <div>
                        <div className="font-semibold">{property.buildingName}</div>
                        <div className="text-sm text-slate-600">{property.areaName}, Dubai</div>
                        <div className="text-xs text-slate-500 mt-1">
                          Coordinates: {property.location.lat.toFixed(6)}, {property.location.lng.toFixed(6)}
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </motion.div>
      </div>
    </div>
  )
}
