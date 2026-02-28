import { useEffect, useCallback, useState, useRef } from 'react'
import { motion, AnimatePresence, useMotionValue, useTransform, PanInfo } from 'framer-motion'
import { X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react'
import { getImageUrl, getImageSrcSetWithOriginal, getBestQualityUrl } from '../lib/image-utils'

interface ImageLightboxProps {
  images: string[]
  initialIndex: number
  isOpen: boolean
  onClose: () => void
  buildingName?: string
}

export function ImageLightbox({
  images,
  initialIndex,
  isOpen,
  onClose,
  buildingName = 'Image'
}: ImageLightboxProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex)
  const [isZoomed, setIsZoomed] = useState(false)
  const [imageLoaded, setImageLoaded] = useState(false)
  const constraintsRef = useRef<HTMLDivElement>(null)

  // For drag/swipe gestures
  const x = useMotionValue(0)
  const opacity = useTransform(x, [-200, 0, 200], [0.5, 1, 0.5])

  // Sync currentIndex with initialIndex when lightbox opens
  useEffect(() => {
    if (isOpen) {
      setCurrentIndex(initialIndex)
      setIsZoomed(false)
      setImageLoaded(false)
    }
  }, [isOpen, initialIndex])

  const goToPrevious = useCallback(() => {
    setCurrentIndex((prev) => (prev === 0 ? images.length - 1 : prev - 1))
    setIsZoomed(false)
    setImageLoaded(false)
  }, [images.length])

  const goToNext = useCallback(() => {
    setCurrentIndex((prev) => (prev === images.length - 1 ? 0 : prev + 1))
    setIsZoomed(false)
    setImageLoaded(false)
  }, [images.length])

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          onClose()
          break
        case 'ArrowLeft':
          goToPrevious()
          break
        case 'ArrowRight':
          goToNext()
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    document.body.style.overflow = 'hidden'

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = 'unset'
    }
  }, [isOpen, onClose, goToPrevious, goToNext])

  // Handle drag end for swipe navigation
  const handleDragEnd = (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    const threshold = 100
    if (info.offset.x > threshold) {
      goToPrevious()
    } else if (info.offset.x < -threshold) {
      goToNext()
    }
  }

  if (!images || images.length === 0) return null

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="fixed inset-0 z-[100] bg-black flex flex-col"
        >
          {/* Top bar with controls */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.3 }}
            className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between p-4 bg-gradient-to-b from-black/80 to-transparent"
          >
            {/* Image counter */}
            <div className="text-white text-sm font-medium px-3 py-1.5 bg-white/10 backdrop-blur-sm rounded-full">
              {currentIndex + 1} / {images.length}
            </div>

            {/* Controls */}
            <div className="flex items-center gap-2">
              {/* Zoom toggle */}
              <button
                onClick={() => setIsZoomed(!isZoomed)}
                className="p-2.5 rounded-full bg-white/10 backdrop-blur-sm hover:bg-white/20 text-white transition-all duration-200"
                aria-label={isZoomed ? 'Zoom out' : 'Zoom in'}
              >
                {isZoomed ? <ZoomOut className="h-5 w-5" /> : <ZoomIn className="h-5 w-5" />}
              </button>

              {/* Close button */}
              <button
                onClick={onClose}
                className="p-2.5 rounded-full bg-white/10 backdrop-blur-sm hover:bg-white/20 text-white transition-all duration-200"
                aria-label="Close gallery"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </motion.div>

          {/* Main image area */}
          <div
            ref={constraintsRef}
            className="flex-1 flex items-center justify-center relative overflow-hidden"
            onClick={(e) => {
              // Only close if clicking the background, not the image
              if (e.target === e.currentTarget) {
                onClose()
              }
            }}
          >
            {/* Previous button */}
            {images.length > 1 && (
              <motion.button
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 }}
                onClick={goToPrevious}
                className="absolute left-4 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full bg-white/10 backdrop-blur-sm hover:bg-white/20 text-white transition-all duration-200 hover:scale-110"
                aria-label="Previous image"
              >
                <ChevronLeft className="h-6 w-6" />
              </motion.button>
            )}

            {/* Next button */}
            {images.length > 1 && (
              <motion.button
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 }}
                onClick={goToNext}
                className="absolute right-4 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full bg-white/10 backdrop-blur-sm hover:bg-white/20 text-white transition-all duration-200 hover:scale-110"
                aria-label="Next image"
              >
                <ChevronRight className="h-6 w-6" />
              </motion.button>
            )}

            {/* Image with drag/swipe */}
            <AnimatePresence mode="wait">
              <motion.div
                key={currentIndex}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
                style={{ x, opacity }}
                drag={!isZoomed ? 'x' : false}
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={0.2}
                onDragEnd={handleDragEnd}
                className={`w-full h-full flex items-center justify-center p-4 md:p-12 cursor-grab active:cursor-grabbing ${
                  isZoomed ? 'overflow-auto' : ''
                }`}
              >
                {/* Loading spinner */}
                {!imageLoaded && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-10 h-10 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  </div>
                )}

                <motion.img
                  src={getBestQualityUrl(images[currentIndex])}
                  srcSet={getImageSrcSetWithOriginal(images[currentIndex])}
                  sizes="100vw"
                  alt={`${buildingName} - ${currentIndex + 1}`}
                  className={`select-none transition-transform duration-300 ${
                    isZoomed
                      ? 'max-w-none cursor-zoom-out'
                      : 'max-w-full max-h-full object-contain cursor-zoom-in'
                  }`}
                  style={{
                    transform: isZoomed ? 'scale(2)' : 'scale(1)',
                    opacity: imageLoaded ? 1 : 0,
                  }}
                  draggable={false}
                  onClick={(e) => {
                    e.stopPropagation()
                    setIsZoomed(!isZoomed)
                  }}
                  onLoad={() => setImageLoaded(true)}
                  onError={(e) => {
                    // Fallback to large if original/srcset fails
                    const target = e.target as HTMLImageElement
                    const largeUrl = getImageUrl(images[currentIndex], 'large')
                    if (target.src !== largeUrl) {
                      target.srcset = ''
                      target.src = largeUrl
                    }
                  }}
                />
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Bottom thumbnail strip */}
          {images.length > 1 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.3 }}
              className="absolute bottom-0 left-0 right-0 z-20 p-4 bg-gradient-to-t from-black/80 to-transparent"
            >
              <div className="flex justify-center gap-2 overflow-x-auto pb-2 px-4 scrollbar-hide">
                {images.map((image, index) => (
                  <motion.button
                    key={index}
                    onClick={() => {
                      setCurrentIndex(index)
                      setIsZoomed(false)
                      setImageLoaded(false)
                    }}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className={`flex-shrink-0 w-16 h-12 md:w-20 md:h-14 rounded-lg overflow-hidden transition-all duration-200 ${
                      index === currentIndex
                        ? 'ring-2 ring-white ring-offset-2 ring-offset-black opacity-100'
                        : 'opacity-50 hover:opacity-80'
                    }`}
                  >
                    <img
                      src={getImageUrl(image, 'thumbnail')}
                      alt={`Thumbnail ${index + 1}`}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  </motion.button>
                ))}
              </div>
            </motion.div>
          )}

          {/* Keyboard hints (desktop only) */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="hidden md:flex absolute bottom-20 left-1/2 -translate-x-1/2 text-white/40 text-xs gap-4"
          >
            <span>← → Navigate</span>
            <span>ESC Close</span>
            <span>Click to zoom</span>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
