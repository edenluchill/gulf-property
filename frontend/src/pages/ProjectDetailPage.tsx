import { useParams, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { Button } from '../components/ui/button'
import { ArrowLeft } from 'lucide-react'
import { useState, useEffect } from 'react'
import { isFavorite, addFavorite, removeFavorite } from '../lib/favorites'
import { fetchResidentialProjectById } from '../lib/api'
import { ImageGallery } from './ProjectDetailPage/ImageGallery'
import { ProjectInfoCard } from './ProjectDetailPage/ProjectInfoCard'
import { OverviewTab } from './ProjectDetailPage/OverviewTab'
import { UnitTypesTab } from './ProjectDetailPage/UnitTypesTab'
import { PaymentPlanTab } from './ProjectDetailPage/PaymentPlanTab'
import { AmenitiesTab } from './ProjectDetailPage/AmenitiesTab'
import { LocationTab } from './ProjectDetailPage/LocationTab'

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [project, setProject] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [isFav, setIsFav] = useState(false)

  useEffect(() => {
    if (id) {
      setLoading(true)
      fetchResidentialProjectById(id)
        .then((result) => {
          if (result?.success && result.project) {
            setProject(result.project)
            setIsFav(isFavorite(result.project.id))
          }
          setLoading(false)
        })
        .catch((error) => {
          console.error('Error fetching project:', error)
          setLoading(false)
        })
    }
  }, [id])

  const handleToggleFavorite = () => {
    if (!project) return
    
    if (isFav) {
      removeFavorite(project.id)
    } else {
      addFavorite(project.id)
    }
    setIsFav(!isFav)
  }

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-16 text-center">
        <div className="text-xl">Loading project details...</div>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="container mx-auto px-4 py-16 text-center">
        <h1 className="text-3xl font-bold mb-4">Project Not Found</h1>
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
              images={project.project_images}
              buildingName={project.project_name}
              currentImageIndex={currentImageIndex}
              onImageIndexChange={setCurrentImageIndex}
            />
            <ProjectInfoCard
              project={project}
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
              <OverviewTab project={project} />
            </TabsContent>

            <TabsContent value="units">
              <UnitTypesTab unitTypes={project.units || []} />
            </TabsContent>

            <TabsContent value="payment">
              <PaymentPlanTab paymentPlan={project.payment_plan || []} />
            </TabsContent>

            <TabsContent value="amenities">
              <AmenitiesTab amenities={project.amenities} />
            </TabsContent>

            <TabsContent value="location">
              <LocationTab
                buildingName={project.project_name}
                areaName={project.area}
                location={{
                  lat: project.latitude,
                  lng: project.longitude
                }}
              />
            </TabsContent>
          </Tabs>
        </motion.div>
      </div>
    </div>
  )
}
