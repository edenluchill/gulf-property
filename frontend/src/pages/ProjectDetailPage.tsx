import { useParams, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { formatPrice, formatDate } from '../lib/utils'
import { getImageUrl, getImageSrcSet } from '../lib/image-utils'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { Button } from '../components/ui/button'
import { 
  Heart, 
  MapPin, 
  Calendar, 
  Building2, 
  ArrowLeft,
  TrendingUp,
  Activity
} from 'lucide-react'
import { useState, useEffect } from 'react'
import { isFavorite, addFavorite, removeFavorite } from '../lib/favorites'
import { MapContainer, TileLayer, Marker } from 'react-leaflet'
import { fetchResidentialProjectById } from '../lib/api'
import { OffPlanProperty } from '../types'

// Convert residential project to OffPlanProperty format
function convertResidentialProjectToProperty(result: any): OffPlanProperty | null {
  if (!result || !result.project) return null
  
  const project = result.project
  
  // construction_progress is now a direct number (0-100)
  const completionPercent = project.construction_progress || 0
  
  // Normalize status to match old schema
  let normalizedStatus: 'upcoming' | 'under-construction' | 'completed' = 'upcoming'
  if (project.status === 'under-construction') {
    normalizedStatus = 'under-construction'
  } else if (project.status === 'completed' || project.status === 'handed-over') {
    normalizedStatus = 'completed'
  }
  
  return {
    id: project.id,
    buildingId: undefined,
    buildingName: project.project_name,
    projectName: project.project_name,
    buildingDescription: project.description,
    developer: project.developer,
    developerId: undefined,
    developerLogoUrl: undefined,
    location: {
      lat: project.latitude || 0,
      lng: project.longitude || 0,
    },
    areaName: project.area,
    areaId: undefined,
    dldLocationId: undefined,
    minBedrooms: project.min_bedrooms || 0,
    maxBedrooms: project.max_bedrooms || 0,
    bedsDescription: project.min_bedrooms && project.max_bedrooms 
      ? `${project.min_bedrooms}-${project.max_bedrooms} BR`
      : undefined,
    minSize: undefined,
    maxSize: undefined,
    startingPrice: project.starting_price,
    medianPriceSqft: undefined,
    medianPricePerUnit: project.starting_price,
    medianRentPerUnit: undefined,
    launchDate: project.launch_date,
    completionDate: project.completion_date,
    completionPercent: completionPercent,
    status: normalizedStatus,
    unitCount: project.total_units,
    buildingUnitCount: project.total_units,
    salesVolume: undefined,
    propSalesVolume: undefined,
    images: project.project_images || [],
    logoUrl: undefined,
    brochureUrl: project.brochure_url,
    amenities: project.amenities || [],
    displayAs: 'project',
    verified: project.verified,
    createdAt: project.created_at,
    updatedAt: project.updated_at,
  }
}

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [property, setProperty] = useState<OffPlanProperty | null>(null)
  const [unitTypes, setUnitTypes] = useState<any[]>([])
  const [paymentPlan, setPaymentPlan] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [isFav, setIsFav] = useState(false)

  useEffect(() => {
    if (id) {
      setLoading(true)
      fetchResidentialProjectById(id).then((result) => {
        const convertedProperty = convertResidentialProjectToProperty(result)
        setProperty(convertedProperty)
        setUnitTypes(result?.unitTypes || [])
        setPaymentPlan(result?.paymentPlan || [])
        setLoading(false)
        if (convertedProperty) {
          setIsFav(isFavorite(convertedProperty.id))
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
                    src={getImageUrl(property.images[currentImageIndex], 'large')}
                    srcSet={getImageSrcSet(property.images[currentImageIndex])}
                    sizes="(max-width: 1024px) 100vw, 50vw"
                    alt={property.buildingName}
                    className="w-full h-full object-cover"
                    loading="lazy"
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
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="units">Unit Types</TabsTrigger>
              <TabsTrigger value="payment">Payment Plan</TabsTrigger>
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

            <TabsContent value="units">
              <Card>
                <CardHeader>
                  <CardTitle>Unit Types & Floor Plans ({unitTypes.length} configurations)</CardTitle>
                </CardHeader>
                <CardContent>
                  {unitTypes.length > 0 ? (
                    <div className="space-y-4">
                      {unitTypes.map((unit, index) => (
                        <div key={unit.id || index} className="border rounded-lg p-6 hover:shadow-md transition-shadow">
                          <div className="flex flex-col md:flex-row gap-6">
                            {/* Floor Plan Image */}
                            {unit.floor_plan_image && (
                              <div className="w-full md:w-1/3">
                                <img 
                                  src={unit.floor_plan_image}
                                  alt={`${unit.unit_type_name} floor plan`}
                                  className="w-full h-auto rounded-lg border"
                                />
                              </div>
                            )}
                            
                            {/* Unit Details */}
                            <div className="flex-1 space-y-4">
                              <div>
                                <h3 className="text-xl font-bold text-primary mb-1">{unit.unit_type_name}</h3>
                                <div className="flex items-center gap-2 text-sm text-slate-600">
                                  {unit.category && (
                                    <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded-full">{unit.category}</span>
                                  )}
                                  {unit.tower && (
                                    <span className="px-2 py-1 bg-slate-100 text-slate-700 rounded-full">{unit.tower}</span>
                                  )}
                                </div>
                              </div>
                              
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <div>
                                  <div className="text-sm text-slate-600">Bedrooms</div>
                                  <div className="text-lg font-semibold">{unit.bedrooms}</div>
                                </div>
                                <div>
                                  <div className="text-sm text-slate-600">Bathrooms</div>
                                  <div className="text-lg font-semibold">{unit.bathrooms}</div>
                                </div>
                                <div>
                                  <div className="text-sm text-slate-600">Area (sq ft)</div>
                                  <div className="text-lg font-semibold">{parseFloat(unit.area).toLocaleString()}</div>
                                </div>
                                {unit.balcony_area && (
                                  <div>
                                    <div className="text-sm text-slate-600">Balcony (sq ft)</div>
                                    <div className="text-lg font-semibold">{parseFloat(unit.balcony_area).toLocaleString()}</div>
                                  </div>
                                )}
                              </div>
                              
                              {unit.price && (
                                <div className="text-2xl font-bold text-primary">
                                  {formatPrice(unit.price)}
                                  {unit.price_per_sqft && (
                                    <span className="text-sm text-slate-600 font-normal ml-2">
                                      ({formatPrice(unit.price_per_sqft)}/sq ft)
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-slate-600">
                      <p>Unit type information will be available soon.</p>
                      <Button className="mt-4">Request Unit Information</Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="payment">
              <Card>
                <CardHeader>
                  <CardTitle>Payment Plan</CardTitle>
                </CardHeader>
                <CardContent>
                  {paymentPlan.length > 0 ? (
                    <div className="space-y-4">
                      {paymentPlan.map((milestone, index) => (
                        <div key={milestone.id || index} className="flex items-center justify-between p-4 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors">
                          <div className="flex items-center gap-4">
                            <div className="flex items-center justify-center w-10 h-10 bg-primary text-white rounded-full font-bold">
                              {index + 1}
                            </div>
                            <div>
                              <div className="font-semibold text-lg">{milestone.milestone_name}</div>
                              {/* 优先显示间隔描述 */}
                              {milestone.interval_description ? (
                                <div className="text-sm text-slate-600 flex items-center gap-1">
                                  <span>⏱️</span>
                                  <span>{milestone.interval_description}</span>
                                </div>
                              ) : milestone.interval_months !== undefined && milestone.interval_months !== null ? (
                                <div className="text-sm text-slate-600 flex items-center gap-1">
                                  <span>⏱️</span>
                                  <span>
                                    {milestone.interval_months === 0 
                                      ? 'At booking' 
                                      : `${milestone.interval_months} month${milestone.interval_months !== 1 ? 's' : ''} later`
                                    }
                                  </span>
                                </div>
                              ) : milestone.milestone_date ? (
                                <div className="text-sm text-slate-600">
                                  Due: {formatDate(milestone.milestone_date)}
                                </div>
                              ) : null}
                              {milestone.description && (
                                <div className="text-sm text-slate-600 mt-1">{milestone.description}</div>
                              )}
                            </div>
                          </div>
                          <div className="text-2xl font-bold text-primary">
                            {parseFloat(milestone.percentage).toFixed(0)}%
                          </div>
                        </div>
                      ))}
                      
                      {/* Total */}
                      <div className="flex items-center justify-between p-4 bg-primary text-white rounded-lg font-bold">
                        <div className="text-lg">Total</div>
                        <div className="text-2xl">
                          {paymentPlan.reduce((sum, m) => sum + parseFloat(m.percentage), 0).toFixed(0)}%
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-8 text-slate-600">
                      <p>Payment plan information will be available soon.</p>
                      <Button className="mt-4">Request Payment Plan</Button>
                    </div>
                  )}
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
