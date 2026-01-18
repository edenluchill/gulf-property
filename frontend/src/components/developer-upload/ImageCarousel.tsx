import { useState, useEffect } from 'react'
import { Carousel, CarouselContent, CarouselItem } from '../ui/carousel'
import { ChevronLeft, ChevronRight, ZoomIn } from 'lucide-react'
import { cn } from '../../lib/utils'

interface ImageCarouselProps {
  images: string[]
  className?: string
  aspectRatio?: 'square' | 'video' | 'auto'
  showThumbnails?: boolean
  maxHeight?: string
}

export function ImageCarousel({ 
  images, 
  className, 
  aspectRatio = 'video',
  showThumbnails = true,
  maxHeight = '300px'
}: ImageCarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [api, setApi] = useState<any>()

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
        <p className="text-sm text-gray-500">暂无图片</p>
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
                    src={img}
                    alt={`Image ${idx + 1}`}
                    className="w-full h-full object-contain hover:scale-105 transition-transform duration-300 cursor-pointer"
                    onClick={() => window.open(img, '_blank')}
                    onError={(e) => {
                      // Prevent infinite retry by setting to a data URL
                      if (e.currentTarget.src !== 'data:,') {
                        console.warn('图片加载失败 (不再重试):', img.substring(0, 80))
                        e.currentTarget.src = 'data:,' // Empty data URL to stop retries
                        e.currentTarget.className = 'hidden'
                        const parent = e.currentTarget.parentElement
                        if (parent && parent.children.length === 1) {
                          parent.innerHTML = '<div class="w-full h-full flex items-center justify-center bg-red-50 text-red-500 text-sm">图片加载失败</div>'
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
                onClick={() => api?.scrollPrev()}
                className="absolute left-2 top-1/2 -translate-y-1/2 z-10 bg-white/90 hover:bg-white rounded-full p-2 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <ChevronLeft className="h-5 w-5 text-gray-700" />
              </button>
              <button
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

      {/* Thumbnail Strip - Only show if multiple images exist */}
      {showThumbnails && images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100">
          {images.slice(0, Math.min(images.length, 10)).map((img, idx) => (
            <button
              key={idx}
              onClick={() => {
                api?.scrollTo(idx)
                setCurrentIndex(idx)
              }}
              className={cn(
                "relative flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 transition-all",
                currentIndex === idx 
                  ? "border-amber-500 ring-2 ring-amber-200 scale-105" 
                  : "border-gray-200 hover:border-amber-300 opacity-70 hover:opacity-100"
              )}
            >
              <img
                src={img}
                alt={`Thumbnail ${idx + 1}`}
                className="w-full h-full object-cover"
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
                  ? "bg-amber-500 text-white" 
                  : "bg-black/50 text-white"
              )}>
                {idx + 1}
              </div>
            </button>
          ))}
          {images.length > 10 && (
            <div className="flex items-center justify-center px-3 text-xs text-gray-500">
              +{images.length - 10} more
            </div>
          )}
        </div>
      )}
    </div>
  )
}
