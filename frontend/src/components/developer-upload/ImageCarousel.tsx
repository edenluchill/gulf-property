import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Carousel, CarouselContent, CarouselItem } from '../ui/carousel'
import { ChevronLeft, ChevronRight, ZoomIn, X, Download } from 'lucide-react'
import { cn } from '../../lib/utils'
import { getImageUrl, getImageSrcSet } from '../../lib/image-utils'

interface ImageCarouselProps {
  images: string[]
  className?: string
  aspectRatio?: 'square' | 'video' | 'auto'
  showThumbnails?: boolean
  maxHeight?: string
}

// Lightbox Modal Component
function ImageLightbox({
  images,
  currentIndex,
  onClose,
  onNavigate
}: {
  images: string[]
  currentIndex: number
  onClose: () => void
  onNavigate: (index: number) => void
}) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
    if (e.key === 'ArrowLeft') onNavigate((currentIndex - 1 + images.length) % images.length)
    if (e.key === 'ArrowRight') onNavigate((currentIndex + 1) % images.length)
  }, [currentIndex, images.length, onClose, onNavigate])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
    }
  }, [handleKeyDown])

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Close button */}
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 z-50 bg-white/10 hover:bg-white/20 rounded-full p-2 transition-colors"
      >
        <X className="h-6 w-6 text-white" />
      </button>

      {/* Download button */}
      <a
        href={getImageUrl(images[currentIndex], 'original')}
        download
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="absolute top-4 right-16 z-50 bg-white/10 hover:bg-white/20 rounded-full p-2 transition-colors"
      >
        <Download className="h-6 w-6 text-white" />
      </a>

      {/* Image counter */}
      <div className="absolute top-4 left-4 z-50 bg-black/60 text-white text-sm px-3 py-1 rounded-full">
        {currentIndex + 1} / {images.length}
      </div>

      {/* Main image */}
      <div
        className="max-w-[90vw] max-h-[85vh] flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={getImageUrl(images[currentIndex], 'original')}
          alt={`Image ${currentIndex + 1}`}
          className="max-w-full max-h-[85vh] object-contain"
        />
      </div>

      {/* Navigation arrows */}
      {images.length > 1 && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onNavigate((currentIndex - 1 + images.length) % images.length)
            }}
            className="absolute left-4 top-1/2 -translate-y-1/2 z-50 bg-white/10 hover:bg-white/20 rounded-full p-3 transition-colors"
          >
            <ChevronLeft className="h-8 w-8 text-white" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onNavigate((currentIndex + 1) % images.length)
            }}
            className="absolute right-4 top-1/2 -translate-y-1/2 z-50 bg-white/10 hover:bg-white/20 rounded-full p-3 transition-colors"
          >
            <ChevronRight className="h-8 w-8 text-white" />
          </button>
        </>
      )}

      {/* Thumbnail strip at bottom */}
      {images.length > 1 && (
        <div
          className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50 flex gap-2 px-4 py-2 bg-black/50 rounded-lg max-w-[90vw] overflow-x-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {images.map((img, idx) => (
            <button
              type="button"
              key={idx}
              onClick={() => onNavigate(idx)}
              className={cn(
                "flex-shrink-0 w-12 h-12 rounded overflow-hidden border-2 transition-all",
                currentIndex === idx
                  ? "border-white scale-110"
                  : "border-transparent opacity-60 hover:opacity-100"
              )}
            >
              <img
                src={getImageUrl(img, 'thumbnail')}
                alt={`Thumbnail ${idx + 1}`}
                className="w-full h-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function ImageCarousel({
  images,
  className,
  aspectRatio = 'video',
  showThumbnails = true,
  maxHeight = '300px'
}: ImageCarouselProps) {
  const { t } = useTranslation('upload')
  const [currentIndex, setCurrentIndex] = useState(0)
  const [api, setApi] = useState<any>()
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState(0)

  const openLightbox = (index: number) => {
    setLightboxIndex(index)
    setLightboxOpen(true)
  }

  // Listen to carousel scroll events to update currentIndex
  useEffect(() => {
    if (!api) return

    api.on('select', () => {
      setCurrentIndex(api.selectedScrollSnap())
    })
  }, [api])

  if (!images || images.length === 0) {
    return (
      <div className="w-full aspect-video bg-gray-100 rounded-lg flex items-center justify-center">
        <p className="text-sm text-gray-500">{t('imageCarousel.noImage')}</p>
      </div>
    )
  }

  const aspectClasses = {
    square: 'aspect-[3/2]', // Changed from square to wider ratio
    video: 'aspect-video',
    auto: 'aspect-auto'
  }

  return (
    <div className={cn("space-y-3", className)}>
      {/* Main Carousel */}
      <div className="relative group" style={{ maxHeight }}>
        <Carousel
          setApi={setApi}
          opts={{
            align: "start",
            loop: true,
          }}
          className="w-full"
        >
          <CarouselContent>
            {images.map((img, idx) => (
              <CarouselItem key={idx}>
                <div 
                  className={cn(
                    "relative w-full bg-gray-100 rounded-lg overflow-hidden",
                    aspectClasses[aspectRatio]
                  )}
                  style={{ maxHeight }}
                >
                  <img
                    src={getImageUrl(img, 'medium')}
                    srcSet={getImageSrcSet(img)}
                    sizes="(max-width: 640px) 400px, (max-width: 1024px) 800px, 1280px"
                    alt={`Image ${idx + 1}`}
                    className="w-full h-full object-contain hover:scale-105 transition-transform duration-300 cursor-pointer"
                    loading="lazy"
                    onClick={() => openLightbox(idx)}
                    onError={(e) => {
                      // Prevent infinite retry by setting to a data URL
                      if (e.currentTarget.src !== 'data:,') {
                        console.warn('图片加载失败 (不再重试):', img.substring(0, 80))
                        e.currentTarget.src = 'data:,' // Empty data URL to stop retries
                        e.currentTarget.className = 'hidden'
                        const parent = e.currentTarget.parentElement
                        if (parent && parent.children.length === 1) {
                          parent.innerHTML = `<div class="w-full h-full flex items-center justify-center bg-red-50 text-red-500 text-sm">${t('imageCarousel.imageLoadFailed')}</div>`
                        }
                      }
                    }}
                  />
                  {/* Zoom hint */}
                  <div className="absolute inset-0 bg-black bg-opacity-0 hover:bg-opacity-10 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100">
                    <div className="bg-white rounded-full p-2 shadow-lg">
                      <ZoomIn className="h-5 w-5 text-gray-700" />
                    </div>
                  </div>
                </div>
              </CarouselItem>
            ))}
          </CarouselContent>
          
          {/* Navigation Arrows - Positioned inside */}
          {images.length > 1 && (
            <>
              <button
                type="button"
                onClick={() => api?.scrollPrev()}
                className="absolute left-2 top-1/2 -translate-y-1/2 z-10 bg-white/90 hover:bg-white rounded-full p-2 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <ChevronLeft className="h-5 w-5 text-gray-700" />
              </button>
              <button
                type="button"
                onClick={() => api?.scrollNext()}
                className="absolute right-2 top-1/2 -translate-y-1/2 z-10 bg-white/90 hover:bg-white rounded-full p-2 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <ChevronRight className="h-5 w-5 text-gray-700" />
              </button>
            </>
          )}

          {/* Image Counter */}
          {images.length > 1 && (
            <div className="absolute bottom-3 right-3 bg-black/60 text-white text-xs px-2 py-1 rounded-full">
              {currentIndex + 1} / {images.length}
            </div>
          )}
        </Carousel>
      </div>

      {/* Thumbnail Strip - Show all images with horizontal scroll */}
      {showThumbnails && images.length > 1 && (
        <div className="relative group/thumbs">
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100 scroll-smooth">
            {images.map((img, idx) => (
              <button
                type="button"
                key={idx}
                onClick={() => {
                  api?.scrollTo(idx)
                  setCurrentIndex(idx)
                }}
                className={cn(
                  "relative flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 transition-all",
                  currentIndex === idx
                    ? "border-teal-500 ring-2 ring-teal-200 scale-105"
                    : "border-gray-200 hover:border-teal-300 opacity-70 hover:opacity-100"
                )}
              >
                <img
                  src={getImageUrl(img, 'thumbnail')}
                  srcSet={`${getImageUrl(img, 'thumbnail')} 400w, ${getImageUrl(img, 'medium')} 800w`}
                  sizes="64px"
                  alt={`Thumbnail ${idx + 1}`}
                  className="w-full h-full object-cover"
                  loading="lazy"
                  onError={(e) => {
                    // Prevent infinite retry for thumbnails
                    if (e.currentTarget.src !== 'data:,') {
                      e.currentTarget.src = 'data:,'
                      e.currentTarget.className = 'hidden'
                    }
                  }}
                />
                {/* Index indicator */}
                <div className={cn(
                  "absolute bottom-0 right-0 text-[10px] px-1 rounded-tl",
                  currentIndex === idx
                    ? "bg-teal-500 text-white"
                    : "bg-black/50 text-white"
                )}>
                  {idx + 1}
                </div>
              </button>
            ))}
          </div>
          {/* Scroll hint for many images */}
          {images.length > 6 && (
            <div className="absolute right-0 top-0 bottom-2 w-8 bg-gradient-to-l from-white to-transparent pointer-events-none" />
          )}
        </div>
      )}

      {/* Lightbox Modal */}
      {lightboxOpen && (
        <ImageLightbox
          images={images}
          currentIndex={lightboxIndex}
          onClose={() => setLightboxOpen(false)}
          onNavigate={setLightboxIndex}
        />
      )}
    </div>
  )
}
