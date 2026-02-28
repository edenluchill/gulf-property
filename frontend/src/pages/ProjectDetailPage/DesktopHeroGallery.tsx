import { useState, useRef } from 'react'
import { motion, useScroll, useTransform } from 'framer-motion'
import { Building2, Expand } from 'lucide-react'
import { getImageUrl, getImageSrcSet } from '../../lib/image-utils'
import { ImageLightbox } from '../../components/ImageLightbox'
import { ProjectInfoTags } from './ProjectInfoTags'

interface DesktopHeroGalleryProps {
  images: string[]
  projectName: string
  minBedrooms?: number
  maxBedrooms?: number
  startingPrice?: number
  completionDate?: string
}

export function DesktopHeroGallery({
  images,
  projectName,
  minBedrooms,
  maxBedrooms,
  startingPrice,
  completionDate
}: DesktopHeroGalleryProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  // Parallax effect on scroll
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ['start start', 'end start']
  })
  const heroY = useTransform(scrollYProgress, [0, 1], ['0%', '20%'])
  const heroOpacity = useTransform(scrollYProgress, [0, 0.5], [1, 0.8])

  const openLightbox = (index: number) => {
    setLightboxIndex(index)
    setLightboxOpen(true)
  }

  if (!images || images.length === 0) {
    return (
      <div className="w-full h-[60vh] min-h-[400px] bg-slate-200 flex items-center justify-center rounded-2xl">
        <Building2 className="h-24 w-24 text-slate-400" />
      </div>
    )
  }

  const heroImage = images[0]
  const gridImages = images.slice(1, 7)
  const remainingCount = images.length - 7

  return (
    <>
      <div ref={containerRef} className="space-y-6">
        {/* Hero Section with parallax */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.32, 0.72, 0, 1] }}
          className="relative w-full h-[60vh] min-h-[400px] max-h-[700px] rounded-2xl overflow-hidden cursor-pointer group"
          onClick={() => openLightbox(0)}
        >
          <motion.div
            style={{ y: heroY, opacity: heroOpacity }}
            className="absolute inset-0"
          >
            <img
              src={getImageUrl(heroImage, 'large')}
              srcSet={getImageSrcSet(heroImage)}
              sizes="100vw"
              alt={projectName}
              className="w-full h-[120%] object-cover transition-transform duration-700 group-hover:scale-105"
              loading="eager"
            />
          </motion.div>

          {/* Gradient overlays */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-black/30 via-transparent to-black/30" />

          {/* Floating Info Tags */}
          <ProjectInfoTags
            projectName={projectName}
            minBedrooms={minBedrooms}
            maxBedrooms={maxBedrooms}
            startingPrice={startingPrice}
            completionDate={completionDate}
            variant="desktop"
          />

          {/* Expand icon */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="absolute top-6 right-6 p-3 rounded-full bg-black/30 backdrop-blur-sm text-white opacity-0 group-hover:opacity-100 transition-all duration-300"
          >
            <Expand className="h-5 w-5" />
          </motion.div>

          {/* Image count badge */}
          <div className="absolute top-6 left-6 px-3 py-1.5 rounded-full bg-black/30 backdrop-blur-sm text-white text-sm font-medium">
            1 / {images.length}
          </div>
        </motion.div>

        {/* Image Grid with stagger animation */}
        {gridImages.length > 0 && (
          <motion.div
            initial="hidden"
            animate="visible"
            variants={{
              hidden: {},
              visible: {
                transition: {
                  staggerChildren: 0.1
                }
              }
            }}
            className="grid grid-cols-3 gap-4"
          >
            {gridImages.map((image, index) => (
              <motion.div
                key={index}
                variants={{
                  hidden: { opacity: 0, y: 20, scale: 0.95 },
                  visible: {
                    opacity: 1,
                    y: 0,
                    scale: 1,
                    transition: {
                      duration: 0.5,
                      ease: [0.32, 0.72, 0, 1]
                    }
                  }
                }}
                whileHover={{ scale: 1.02, y: -4 }}
                whileTap={{ scale: 0.98 }}
                className="relative aspect-[4/3] rounded-xl overflow-hidden cursor-pointer group shadow-lg hover:shadow-xl transition-shadow duration-300"
                onClick={() => openLightbox(index + 1)}
              >
                <img
                  src={getImageUrl(image, 'medium')}
                  srcSet={getImageSrcSet(image)}
                  sizes="(max-width: 1280px) 33vw, 400px"
                  alt={`${projectName} - ${index + 2}`}
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                  loading="lazy"
                />

                {/* Hover overlay with gradient */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

                {/* Image number on hover */}
                <div className="absolute bottom-3 left-3 px-2 py-1 rounded-md bg-black/50 backdrop-blur-sm text-white text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                  {index + 2} / {images.length}
                </div>

                {/* Show "+X more" on last grid item */}
                {index === gridImages.length - 1 && remainingCount > 0 && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="absolute inset-0 bg-black/60 backdrop-blur-[2px] flex flex-col items-center justify-center"
                  >
                    <span className="text-white text-3xl font-bold">+{remainingCount}</span>
                    <span className="text-white/80 text-sm mt-1">View all photos</span>
                  </motion.div>
                )}
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>

      {/* Lightbox */}
      <ImageLightbox
        images={images}
        initialIndex={lightboxIndex}
        isOpen={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
        buildingName={projectName}
      />
    </>
  )
}
