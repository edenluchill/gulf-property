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
  // Images stay full-brightness; each one does a one-time fade-up as it enters
  // view (or once it loads — whichever first, so it can never get stuck hidden).
  const [revealed, setRevealed] = useState<Set<number>>(new Set())
  // 0→1 scroll progress through the gallery — drives the slim bottom progress bar.
  const [scrollProgress, setScrollProgress] = useState(0)
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
      setRevealed(new Set([initialIndex]))
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

  // Track the centered image (drives counter + thumbnail) and reveal images as
  // they scroll into view — via IntersectionObserver against the scroll
  // container. More reliable than per-frame center math, and it never dims the
  // off-center images, so scrolling no longer goes dark.
  useEffect(() => {
    if (isMobile || !isOpen || !mainScrollRef.current) return

    const container = mainScrollRef.current
    const ratios = new Array(images.length).fill(0)

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const idx = imageRefs.current.indexOf(entry.target as HTMLDivElement)
          if (idx === -1) continue
          ratios[idx] = entry.isIntersecting ? entry.intersectionRatio : 0
          if (entry.intersectionRatio > 0.05) {
            setRevealed((prev) => (prev.has(idx) ? prev : new Set(prev).add(idx)))
          }
        }
        // Don't fight a programmatic scroll-to (thumbnail click / arrows).
        if (isScrollingToImage.current) return
        let best = 0
        let bestRatio = -1
        for (let i = 0; i < ratios.length; i++) {
          if (ratios[i] > bestRatio) { bestRatio = ratios[i]; best = i }
        }
        if (bestRatio > 0) setCurrentIndex((cur) => (cur === best ? cur : best))
      },
      { root: container, threshold: [0, 0.25, 0.5, 0.75, 1] }
    )

    imageRefs.current.forEach((el) => el && io.observe(el))
    return () => io.disconnect()
  }, [isMobile, isOpen, images.length])

  // Slim bottom progress bar — tracks how far through the gallery you've scrolled.
  useEffect(() => {
    if (isMobile || !isOpen || !mainScrollRef.current) return
    const container = mainScrollRef.current
    const onScroll = () => {
      const max = container.scrollHeight - container.clientHeight
      setScrollProgress(max > 0 ? Math.min(1, Math.max(0, container.scrollTop / max)) : 0)
    }
    onScroll()
    container.addEventListener('scroll', onScroll, { passive: true })
    return () => container.removeEventListener('scroll', onScroll)
  }, [isMobile, isOpen, images.length])

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
    setRevealed(prev => (prev.has(index) ? prev : new Set(prev).add(index)))
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
          className="w-28 h-full flex flex-col bg-black border-r border-white/[0.08]"
        >
          {/* Header — zero-padded counter, luxury portfolio feel */}
          <div className="flex-shrink-0 px-3 py-4 border-b border-white/[0.08]">
            <div className="flex items-baseline gap-1 text-white tabular-nums">
              <span className="text-2xl font-semibold tracking-tight">{String(currentIndex + 1).padStart(2, '0')}</span>
              <span className="text-xs font-normal text-white/35">/ {String(images.length).padStart(2, '0')}</span>
            </div>
            <div className="mt-0.5 text-[9px] font-medium uppercase tracking-[0.2em] text-white/30">Gallery</div>
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
                className={`group relative w-full aspect-[4/3] rounded-md overflow-hidden transition-all duration-300 ease-out ${
                  index === currentIndex
                    ? 'opacity-100'
                    : 'opacity-45 hover:opacity-80'
                }`}
              >
                <img
                  src={getImageUrl(image, 'thumbnail')}
                  alt={`Thumbnail ${index + 1}`}
                  className={`w-full h-full object-cover transition-transform duration-500 ease-out ${
                    index === currentIndex ? 'scale-100' : 'scale-105 group-hover:scale-100'
                  }`}
                  loading="lazy"
                />
                {/* Active frame — thin white inset border */}
                <div className={`pointer-events-none absolute inset-0 rounded-md transition-all duration-300 ${
                  index === currentIndex ? 'ring-1 ring-inset ring-white/90' : 'ring-1 ring-inset ring-white/0'
                }`} />
                {/* Active indicator bar */}
                {index === currentIndex && (
                  <div className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r bg-white" />
                )}
                {/* Index — zero padded, appears on hover / active */}
                <div className={`absolute bottom-1 right-1.5 text-[9px] font-semibold tabular-nums tracking-wide transition-opacity duration-200 ${
                  index === currentIndex ? 'text-white opacity-100' : 'text-white/80 opacity-0 group-hover:opacity-100'
                }`} style={{ textShadow: '0 1px 3px rgba(0,0,0,0.9)' }}>
                  {String(index + 1).padStart(2, '0')}
                </div>
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
          className="absolute top-0 left-0 right-0 z-20 flex items-start justify-between p-5"
        >
          {/* Project name — uppercase, letter-spaced, editorial */}
          <div className="max-w-[60%] truncate text-white/85 text-[13px] font-medium uppercase tracking-[0.18em] pt-1.5"
            style={{ textShadow: '0 1px 12px rgba(0,0,0,0.8)' }}>
            {buildingName}
          </div>

          {/* Close button — thin, neutral */}
          <button
            onClick={onClose}
            className="p-2.5 rounded-full border border-white/15 bg-black/30 backdrop-blur-md text-white/70 hover:text-white hover:border-white/40 hover:bg-black/50 transition-all duration-200"
            aria-label="Close gallery"
          >
            <X className="h-[18px] w-[18px]" />
          </button>
        </motion.div>

        {/* Scrollable main image area with momentum scrolling */}
        <div
          ref={mainScrollRef}
          className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-hide"
          style={{ cursor: 'grab', background: 'radial-gradient(130% 90% at 50% -10%, #15151c 0%, #060608 58%, #000 100%)' }}
        >
          <div className="flex flex-col items-center gap-10 px-8 py-20">
            {images.map((image, index) => (
              <div
                key={index}
                ref={el => imageRefs.current[index] = el}
                className={`relative w-full max-w-5xl transition-[opacity,transform] duration-700 ease-out ${
                  revealed.has(index)
                    ? 'opacity-100 translate-y-0'
                    : 'opacity-0 translate-y-8'
                }`}
              >
                {/* Image container — stays bright; the centered one gets a subtle
                    premium lift (softer ring + deeper shadow), never dims others. */}
                <div className={`relative rounded-2xl overflow-hidden bg-white/5 transition-all duration-500 ease-out ${
                  index === currentIndex
                    ? 'ring-1 ring-white/20 shadow-[0_40px_110px_-30px_rgba(0,0,0,0.95)]'
                    : 'ring-1 ring-white/[0.08] shadow-[0_20px_60px_-30px_rgba(0,0,0,0.8)]'
                }`}>
                  {/* Loading skeleton */}
                  {!imageLoaded[index] && (
                    <div className="absolute inset-0 flex items-center justify-center bg-white/[0.03] min-h-[300px]">
                      <div className="w-7 h-7 border-2 border-white/15 border-t-white/80 rounded-full animate-spin" />
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

                  {/* Editorial index caption — fades up only on the centered image */}
                  <div className={`pointer-events-none absolute bottom-4 left-5 flex items-baseline gap-1.5 tabular-nums transition-all duration-500 ${
                    index === currentIndex ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1'
                  }`} style={{ textShadow: '0 2px 14px rgba(0,0,0,0.85)' }}>
                    <span className="text-white text-2xl font-light leading-none tracking-tight">{String(index + 1).padStart(2, '0')}</span>
                    <span className="text-white/55 text-xs font-medium">/ {String(images.length).padStart(2, '0')}</span>
                  </div>
                </div>
              </div>
            ))}

            {/* Bottom padding for last image to center properly */}
            <div className="h-[30vh]" />
          </div>
        </div>

        {/* Minimal hint — fades out once you start scrolling */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: scrollProgress > 0.02 ? 0 : 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="pointer-events-none absolute bottom-7 left-1/2 -translate-x-1/2 flex items-center gap-2.5 text-[11px] font-medium uppercase tracking-[0.15em] text-white/45"
        >
          <span>Scroll</span>
          <span className="text-white/20">·</span>
          <span>Esc to close</span>
        </motion.div>

        {/* Slim bottom progress bar */}
        <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-white/10">
          <div
            className="h-full bg-white/85"
            style={{ width: `${scrollProgress * 100}%`, transition: 'width 120ms linear' }}
          />
        </div>

        {/* Navigation arrows on sides */}
        {images.length > 1 && (
          <>
            <button
              onClick={goToPrevious}
              className="absolute left-5 top-1/2 -translate-y-1/2 p-2.5 rounded-full border border-white/15 bg-black/30 backdrop-blur-md text-white/55 hover:text-white hover:border-white/40 hover:bg-black/50 transition-all duration-200"
              aria-label="Previous image"
            >
              <ChevronUp className="h-[18px] w-[18px]" />
            </button>
            <button
              onClick={goToNext}
              className="absolute right-5 top-1/2 -translate-y-1/2 p-2.5 rounded-full border border-white/15 bg-black/30 backdrop-blur-md text-white/55 hover:text-white hover:border-white/40 hover:bg-black/50 transition-all duration-200"
              aria-label="Next image"
            >
              <ChevronDown className="h-[18px] w-[18px]" />
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
