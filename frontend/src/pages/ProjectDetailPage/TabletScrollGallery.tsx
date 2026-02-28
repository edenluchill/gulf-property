import { useState, useRef } from 'react'
import { motion, useScroll, useTransform, useInView } from 'framer-motion'
import { Building2, Expand } from 'lucide-react'
import { getImageUrl, getImageSrcSet } from '../../lib/image-utils'
import { ImageLightbox } from '../../components/ImageLightbox'
import { ProjectInfoTags } from './ProjectInfoTags'

interface TabletScrollGalleryProps {
  images: string[]
  projectName: string
  minBedrooms?: number
  maxBedrooms?: number
  startingPrice?: number
  completionDate?: string
}

function GalleryImage({
  image,
  index,
  total,
  projectName,
  isFirst,
  minBedrooms,
  maxBedrooms,
  startingPrice,
  completionDate,
  onOpenLightbox
}: {
  image: string
  index: number
  total: number
  projectName: string
  isFirst: boolean
  minBedrooms?: number
  maxBedrooms?: number
  startingPrice?: number
  completionDate?: string
  onOpenLightbox: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const isInView = useInView(ref, { once: true, margin: '-100px' })

  // Parallax effect for each image
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start end', 'end start']
  })
  const y = useTransform(scrollYProgress, [0, 1], ['0%', '10%'])
  const scale = useTransform(scrollYProgress, [0, 0.5, 1], [0.95, 1, 0.95])

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 50 }}
      animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 50 }}
      transition={{ duration: 0.6, ease: [0.32, 0.72, 0, 1] }}
      style={{ scale }}
      className="relative w-full rounded-2xl overflow-hidden cursor-pointer group scroll-snap-align-start"
      onClick={onOpenLightbox}
    >
      <div className="relative aspect-[16/10] overflow-hidden">
        <motion.img
          style={{ y }}
          src={getImageUrl(image, 'large')}
          srcSet={getImageSrcSet(image)}
          sizes="100vw"
          alt={`${projectName} - ${index + 1}`}
          className="w-full h-[110%] object-cover transition-transform duration-500 group-hover:scale-105"
          loading={index < 2 ? 'eager' : 'lazy'}
        />

        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

        {/* Expand icon on hover */}
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          whileHover={{ opacity: 1, scale: 1 }}
          className="absolute top-4 right-4 p-2.5 rounded-full bg-black/30 backdrop-blur-sm text-white opacity-0 group-hover:opacity-100 transition-all duration-300"
        >
          <Expand className="h-5 w-5" />
        </motion.div>

        {/* Image counter badge */}
        <div className="absolute top-4 left-4 px-3 py-1.5 rounded-full bg-black/40 backdrop-blur-sm text-white text-sm font-medium">
          {index + 1} / {total}
        </div>

        {/* Floating info tags on first image only */}
        {isFirst && (
          <ProjectInfoTags
            projectName={projectName}
            minBedrooms={minBedrooms}
            maxBedrooms={maxBedrooms}
            startingPrice={startingPrice}
            completionDate={completionDate}
            variant="tablet"
          />
        )}
      </div>
    </motion.div>
  )
}

export function TabletScrollGallery({
  images,
  projectName,
  minBedrooms,
  maxBedrooms,
  startingPrice,
  completionDate
}: TabletScrollGalleryProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  const openLightbox = (index: number) => {
    setLightboxIndex(index)
    setLightboxOpen(true)
  }

  if (!images || images.length === 0) {
    return (
      <div className="w-full h-64 bg-slate-200 flex items-center justify-center rounded-xl mx-4 my-4">
        <Building2 className="h-16 w-16 text-slate-400" />
      </div>
    )
  }

  return (
    <>
      <div
        ref={containerRef}
        className="space-y-4 px-4 py-4 scroll-smooth"
        style={{ scrollSnapType: 'y proximity' }}
      >
        {images.map((image, index) => (
          <GalleryImage
            key={index}
            image={image}
            index={index}
            total={images.length}
            projectName={projectName}
            isFirst={index === 0}
            minBedrooms={minBedrooms}
            maxBedrooms={maxBedrooms}
            startingPrice={startingPrice}
            completionDate={completionDate}
            onOpenLightbox={() => openLightbox(index)}
          />
        ))}

        {/* Scroll indicator at the end */}
        {images.length > 3 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1 }}
            className="text-center text-slate-400 text-sm py-4"
          >
            {images.length} photos
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
