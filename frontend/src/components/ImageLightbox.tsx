import { useEffect, useCallback, useState, useRef } from 'react'
import { motion, AnimatePresence, useMotionValue, useTransform, PanInfo } from 'framer-motion'
import { X, ChevronLeft, ChevronRight, ChevronUp, ChevronDown } from 'lucide-react'
import { getImageUrl, getImageSrcSet, getImageSrcSetWithOriginal } from '../lib/image-utils'

interface ImageLightboxProps {
  images: string[]
  initialIndex: number
  isOpen: boolean
  onClose: () => void
  buildingName?: string
}

// Custom hook for momentum/inertia scrolling
function useMomentumScroll(ref: React.RefObject<HTMLDivElement>) {
  const velocity = useRef(0)
  const animationFrame = useRef<number>()
  const isAnimating = useRef(false)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const animate = () => {
      if (!element) return

      // Apply velocity
      element.scrollTop += velocity.current

      // Apply friction (0.92 = smooth deceleration)
      velocity.current *= 0.92

      // Continue animation if velocity is significant
      if (Math.abs(velocity.current) > 0.5) {
        animationFrame.current = requestAnimationFrame(animate)
      } else {
        velocity.current = 0
        isAnimating.current = false
      }
    }

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()

      // Add wheel delta to velocity with momentum
      // Higher multiplier = more responsive, lower = smoother
      velocity.current += e.deltaY * 0.8

      // Clamp max velocity
      velocity.current = Math.max(-100, Math.min(100, velocity.current))

      // Start animation if not already running
      if (!isAnimating.current) {
        isAnimating.current = true
        animate()
      }
    }

    element.addEventListener('wheel', handleWheel, { passive: false })

    return () => {
      element.removeEventListener('wheel', handleWheel)
      if (animationFrame.current) {
        cancelAnimationFrame(animationFrame.current)
      }
    }
  }, [ref])
}

export function ImageLightbox({
  images,
  initialIndex,
  isOpen,
  onClose,
  buildingName = 'Image'
}: ImageLightboxProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex)
  const [imageLoaded, setImageLoaded] = useState<Record<number, boolean>>({})
  const [isMobile, setIsMobile] = useState(false)
  const thumbnailListRef = useRef<HTMLDivElement>(null)
  const mainScrollRef = useRef<HTMLDivElement>(null)
  const imageRefs = useRef<(HTMLDivElement | null)[]>([])
  const isScrollingToImage = useRef(false)

  // Apply momentum scrolling to main area
  useMomentumScroll(mainScrollRef)

  // For drag/swipe gestures (mobile)
  const x = useMotionValue(0)
  const opacity = useTransform(x, [-200, 0, 200], [0.5, 1, 0.5])

  // Check if mobile
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 1024)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  // Sync currentIndex with initialIndex when lightbox opens
  useEffect(() => {
    if (isOpen) {
      setCurrentIndex(initialIndex)
      setImageLoaded({})
      // Scroll to initial image after mount
      requestAnimationFrame(() => {
        scrollToImage(initialIndex, false)
      })
    }
  }, [isOpen, initialIndex])

  // Auto-scroll thumbnail into view when currentIndex changes
  useEffect(() => {
    if (thumbnailListRef.current && !isMobile) {
      const activeThumb = thumbnailListRef.current.children[currentIndex] as HTMLElement
      if (activeThumb) {
        activeThumb.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }
    }
  }, [currentIndex, isMobile])

  // Scroll detection - find which image is most visible
  useEffect(() => {
    if (isMobile || !mainScrollRef.current) return

    const container = mainScrollRef.current
    let ticking = false

    const handleScroll = () => {
      if (isScrollingToImage.current) return
      if (ticking) return

      ticking = true
      requestAnimationFrame(() => {
        const containerRect = container.getBoundingClientRect()
        const containerCenter = containerRect.top + containerRect.height / 2

        let closestIndex = 0
        let closestDistance = Infinity

        imageRefs.current.forEach((ref, index) => {
          if (!ref) return
          const rect = ref.getBoundingClientRect()
          const imageCenter = rect.top + rect.height / 2
          const distance = Math.abs(imageCenter - containerCenter)

          if (distance < closestDistance) {
            closestDistance = distance
            closestIndex = index
          }
        })

        if (closestIndex !== currentIndex) {
          setCurrentIndex(closestIndex)
        }
        ticking = false
      })
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [isMobile, currentIndex])

  // Scroll to specific image
  const scrollToImage = useCallback((index: number, smooth = true) => {
    const imageEl = imageRefs.current[index]
    if (imageEl && mainScrollRef.current) {
      isScrollingToImage.current = true

      const container = mainScrollRef.current
      const containerRect = container.getBoundingClientRect()
      const imageRect = imageEl.getBoundingClientRect()

      const targetScroll = container.scrollTop + imageRect.top - containerRect.top - (containerRect.height - imageRect.height) / 2

      if (smooth) {
        // Smooth scroll with easing
        const startScroll = container.scrollTop
        const distance = targetScroll - startScroll
        const duration = 400
        const startTime = performance.now()

        const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)

        const animateScroll = (currentTime: number) => {
          const elapsed = currentTime - startTime
          const progress = Math.min(elapsed / duration, 1)
          const easedProgress = easeOutCubic(progress)

          container.scrollTop = startScroll + distance * easedProgress

          if (progress < 1) {
            requestAnimationFrame(animateScroll)
          } else {
            isScrollingToImage.current = false
          }
        }

        requestAnimationFrame(animateScroll)
      } else {
        container.scrollTop = targetScroll
        setTimeout(() => {
          isScrollingToImage.current = false
        }, 50)
      }
    }
  }, [])

  const goToPrevious = useCallback(() => {
    const newIndex = currentIndex === 0 ? images.length - 1 : currentIndex - 1
    setCurrentIndex(newIndex)
    if (!isMobile) {
      scrollToImage(newIndex)
    }
  }, [currentIndex, images.length, isMobile, scrollToImage])

  const goToNext = useCallback(() => {
    const newIndex = currentIndex === images.length - 1 ? 0 : currentIndex + 1
    setCurrentIndex(newIndex)
    if (!isMobile) {
      scrollToImage(newIndex)
    }
  }, [currentIndex, images.length, isMobile, scrollToImage])

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          onClose()
          break
        case 'ArrowLeft':
        case 'ArrowUp':
          e.preventDefault()
          goToPrevious()
          break
        case 'ArrowRight':
        case 'ArrowDown':
          e.preventDefault()
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

  // Handle drag end for swipe navigation (mobile)
  const handleDragEnd = (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    const threshold = 100
    if (info.offset.x > threshold) {
      goToPrevious()
    } else if (info.offset.x < -threshold) {
      goToNext()
    }
  }

  const handleImageLoad = (index: number) => {
    setImageLoaded(prev => ({ ...prev, [index]: true }))
  }

  const handleThumbnailClick = (index: number) => {
    setCurrentIndex(index)
    if (!isMobile) {
      scrollToImage(index)
    }
  }

  if (!images || images.length === 0) return null

  // Desktop layout with left sidebar and scrollable main area
  const renderDesktopLayout = () => (
    <div className="flex h-full">
      {/* Left sidebar with thumbnails */}
      {images.length > 1 && (
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.1, duration: 0.3 }}
          className="w-28 h-full flex flex-col bg-black/80 border-r border-white/10"
        >
          {/* Header */}
          <div className="flex-shrink-0 px-3 py-4 border-b border-white/10">
            <div className="text-white text-xl font-bold">
              {currentIndex + 1}
              <span className="text-white/40 text-sm font-normal ml-1">/ {images.length}</span>
            </div>
          </div>

          {/* Navigation up button */}
          <button
            onClick={goToPrevious}
            className="flex-shrink-0 h-10 flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-all"
            aria-label="Previous image"
          >
            <ChevronUp className="h-5 w-5" />
          </button>

          {/* Scrollable thumbnail list */}
          <div
            ref={thumbnailListRef}
            className="flex-1 overflow-y-auto overflow-x-hidden py-2 px-2 space-y-2 scrollbar-hide"
          >
            {images.map((image, index) => (
              <button
                key={index}
                onClick={() => handleThumbnailClick(index)}
                className={`relative w-full aspect-[4/3] rounded-lg overflow-hidden transition-all duration-300 transform ${
                  index === currentIndex
                    ? 'ring-2 ring-teal-400 opacity-100 scale-100'
                    : 'opacity-40 hover:opacity-70 scale-95 hover:scale-100'
                }`}
              >
                <img
                  src={getImageUrl(image, 'thumbnail')}
                  alt={`Thumbnail ${index + 1}`}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
                {/* Index badge */}
                <div className={`absolute bottom-1 right-1 min-w-[18px] px-1 py-0.5 rounded text-[9px] font-bold text-center ${
                  index === currentIndex
                    ? 'bg-teal-500 text-white'
                    : 'bg-black/60 text-white/70'
                }`}>
                  {index + 1}
                </div>
                {/* Active indicator */}
                {index === currentIndex && (
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-teal-400" />
                )}
              </button>
            ))}
          </div>

          {/* Navigation down button */}
          <button
            onClick={goToNext}
            className="flex-shrink-0 h-10 flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-all"
            aria-label="Next image"
          >
            <ChevronDown className="h-5 w-5" />
          </button>
        </motion.div>
      )}

      {/* Main image area */}
      <div className="flex-1 flex flex-col relative">
        {/* Top bar with close button */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between p-4"
        >
          {/* Project name */}
          <div className="text-white/60 text-sm font-medium truncate max-w-[300px] bg-black/40 backdrop-blur-sm px-3 py-1.5 rounded-full">
            {buildingName}
          </div>

          {/* Close button */}
          <button
            onClick={onClose}
            className="p-3 rounded-full bg-black/40 backdrop-blur-sm hover:bg-red-500 text-white transition-all duration-200 hover:scale-110"
            aria-label="Close gallery"
          >
            <X className="h-5 w-5" />
          </button>
        </motion.div>

        {/* Scrollable main image area with momentum scrolling */}
        <div
          ref={mainScrollRef}
          className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-hide"
          style={{ cursor: 'grab' }}
        >
          <div className="flex flex-col items-center gap-8 px-8 py-20">
            {images.map((image, index) => (
              <div
                key={index}
                ref={el => imageRefs.current[index] = el}
                className={`relative w-full max-w-5xl transition-all duration-500 ease-out ${
                  index === currentIndex
                    ? 'opacity-100 scale-100'
                    : 'opacity-40 scale-[0.96]'
                }`}
              >
                {/* Image container */}
                <div className="relative rounded-2xl overflow-hidden bg-white/5 shadow-2xl">
                  {/* Loading skeleton */}
                  {!imageLoaded[index] && (
                    <div className="absolute inset-0 flex items-center justify-center bg-white/5 min-h-[300px]">
                      <div className="w-8 h-8 border-2 border-white/20 border-t-teal-400 rounded-full animate-spin" />
                    </div>
                  )}

                  <img
                    src={getImageUrl(image, 'large')}
                    srcSet={getImageSrcSet(image)}
                    sizes="(max-width: 1280px) 90vw, 1024px"
                    alt={`${buildingName} - ${index + 1}`}
                    className={`w-full h-auto object-contain transition-opacity duration-500 ${
                      imageLoaded[index] ? 'opacity-100' : 'opacity-0'
                    }`}
                    loading={index < 3 ? 'eager' : 'lazy'}
                    draggable={false}
                    onLoad={() => handleImageLoad(index)}
                    onError={(e) => {
                      const target = e.target as HTMLImageElement
                      target.srcset = ''
                      target.src = getImageUrl(image, 'large')
                      handleImageLoad(index)
                    }}
                  />

                  {/* Image number overlay */}
                  <div className={`absolute top-4 left-4 px-3 py-1.5 rounded-full backdrop-blur-sm text-sm font-medium transition-all ${
                    index === currentIndex
                      ? 'bg-teal-500/80 text-white'
                      : 'bg-black/50 text-white/70'
                  }`}>
                    {index + 1} / {images.length}
                  </div>
                </div>
              </div>
            ))}

            {/* Bottom padding for last image to center properly */}
            <div className="h-[30vh]" />
          </div>
        </div>

        {/* Scroll hint */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.8 }}
          className="absolute bottom-6 left-1/2 -translate-x-1/2 text-white/40 text-xs bg-black/50 backdrop-blur-sm px-4 py-2 rounded-full flex items-center gap-2"
        >
          <span>Scroll to browse</span>
          <span className="text-white/20">·</span>
          <span>ESC to close</span>
        </motion.div>

        {/* Navigation arrows on sides */}
        {images.length > 1 && (
          <>
            <button
              onClick={goToPrevious}
              className="absolute left-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-black/40 backdrop-blur-sm hover:bg-white/20 text-white/60 hover:text-white transition-all hover:scale-110"
            >
              <ChevronUp className="h-5 w-5" />
            </button>
            <button
              onClick={goToNext}
              className="absolute right-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-black/40 backdrop-blur-sm hover:bg-white/20 text-white/60 hover:text-white transition-all hover:scale-110"
            >
              <ChevronDown className="h-5 w-5" />
            </button>
          </>
        )}
      </div>
    </div>
  )

  // Mobile layout with bottom thumbnails
  const renderMobileLayout = () => (
    <>
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

        {/* Close button */}
        <button
          onClick={onClose}
          className="p-2.5 rounded-full bg-white/20 backdrop-blur-sm hover:bg-red-500 text-white transition-all duration-200"
          aria-label="Close gallery"
        >
          <X className="h-5 w-5" />
        </button>
      </motion.div>

      {/* Main image area */}
      <div className="flex-1 flex items-center justify-center relative overflow-hidden">
        {/* Navigation buttons */}
        {images.length > 1 && (
          <>
            <motion.button
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              onClick={goToPrevious}
              className="absolute left-2 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full bg-black/40 backdrop-blur-sm text-white"
            >
              <ChevronLeft className="h-5 w-5" />
            </motion.button>
            <motion.button
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              onClick={goToNext}
              className="absolute right-2 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full bg-black/40 backdrop-blur-sm text-white"
            >
              <ChevronRight className="h-5 w-5" />
            </motion.button>
          </>
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
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.2}
            onDragEnd={handleDragEnd}
            className="w-full h-full flex items-center justify-center p-4 cursor-grab active:cursor-grabbing"
          >
            {!imageLoaded[currentIndex] && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-10 h-10 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              </div>
            )}

            <motion.img
              src={getImageUrl(images[currentIndex], 'original')}
              srcSet={getImageSrcSetWithOriginal(images[currentIndex])}
              sizes="100vw"
              alt={`${buildingName} - ${currentIndex + 1}`}
              className="max-w-full max-h-full object-contain select-none"
              style={{ opacity: imageLoaded[currentIndex] ? 1 : 0 }}
              draggable={false}
              onLoad={() => handleImageLoad(currentIndex)}
              onError={(e) => {
                const target = e.target as HTMLImageElement
                target.srcset = ''
                target.src = getImageUrl(images[currentIndex], 'large')
                handleImageLoad(currentIndex)
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
              <button
                key={index}
                onClick={() => handleThumbnailClick(index)}
                className={`flex-shrink-0 w-14 h-10 rounded-lg overflow-hidden transition-all duration-200 ${
                  index === currentIndex
                    ? 'ring-2 ring-teal-400 ring-offset-2 ring-offset-black opacity-100'
                    : 'opacity-50 hover:opacity-80'
                }`}
              >
                <img
                  src={getImageUrl(image, 'thumbnail')}
                  alt={`Thumbnail ${index + 1}`}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </button>
            ))}
          </div>
        </motion.div>
      )}
    </>
  )

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="fixed inset-0 z-[10000] bg-black flex flex-col"
        >
          {isMobile ? renderMobileLayout() : renderDesktopLayout()}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
