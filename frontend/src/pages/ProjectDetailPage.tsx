import { useParams, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { Button } from '../components/ui/button'
import { ArrowLeft } from 'lucide-react'
import { useState, useEffect } from 'react'
import { isFavorite, addFavorite, removeFavorite } from '../lib/favorites'
import { fetchResidentialProjectById } from '../lib/api'
import { OffPlanProperty } from '../types'
import { ImageGallery } from './ProjectDetailPage/ImageGallery'
import { ProjectInfoCard } from './ProjectDetailPage/ProjectInfoCard'
import { OverviewTab } from './ProjectDetailPage/OverviewTab'
import { UnitTypesTab } from './ProjectDetailPage/UnitTypesTab'
import { PaymentPlanTab } from './ProjectDetailPage/PaymentPlanTab'
import { AmenitiesTab } from './ProjectDetailPage/AmenitiesTab'
import { LocationTab } from './ProjectDetailPage/LocationTab'

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
          {/* Image Gallery and Project Info */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
            <ImageGallery
              images={property.images}
              buildingName={property.buildingName}
              currentImageIndex={currentImageIndex}
              onImageIndexChange={setCurrentImageIndex}
            />
            <ProjectInfoCard
              property={property}
              isFavorite={isFav}
              onToggleFavorite={handleToggleFavorite}
            />
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
              <OverviewTab property={property} />
            </TabsContent>

            <TabsContent value="units">
              <UnitTypesTab unitTypes={unitTypes} />
            </TabsContent>

            <TabsContent value="payment">
              <PaymentPlanTab paymentPlan={paymentPlan} />
            </TabsContent>

            <TabsContent value="amenities">
              <AmenitiesTab amenities={property.amenities} />
            </TabsContent>

            <TabsContent value="location">
              <LocationTab
                buildingName={property.buildingName}
                areaName={property.areaName}
                location={property.location}
              />
            </TabsContent>
          </Tabs>
        </motion.div>
      </div>
    </div>
  )
}
