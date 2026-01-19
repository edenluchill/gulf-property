import { Building2, ChevronLeft, ChevronRight } from 'lucide-react'
import { getImageUrl, getImageSrcSet } from '../../lib/image-utils'
import { Button } from '../../components/ui/button'
import { useEffect, useRef } from 'react'

interface ImageGalleryProps {
  images: string[]
  buildingName: string
  currentImageIndex: number
  onImageIndexChange: (index: number) => void
}

export function ImageGallery({ 
  images, 
  buildingName, 
  currentImageIndex, 
  onImageIndexChange 
}: ImageGalleryProps) {
  const thumbnailRefs = useRef<(HTMLButtonElement | null)[]>([])

  // Auto-scroll thumbnail into view when currentImageIndex changes
  useEffect(() => {
    const currentThumbnail = thumbnailRefs.current[currentImageIndex]
    if (currentThumbnail) {
      currentThumbnail.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center'
      })
    }
  }, [currentImageIndex])

  const handlePrevious = () => {
    if (images.length === 0) return
    const newIndex = currentImageIndex === 0 ? images.length - 1 : currentImageIndex - 1
    onImageIndexChange(newIndex)
  }

  const handleNext = () => {
    if (images.length === 0) return
    const newIndex = currentImageIndex === images.length - 1 ? 0 : currentImageIndex + 1
    onImageIndexChange(newIndex)
  }

  return (
    <div className="space-y-4">
      {/* Main Image */}
      <div className="relative h-96 lg:h-[500px] rounded-lg overflow-hidden bg-slate-200">
        {images.length > 0 ? (
          <>
            <img
              src={getImageUrl(images[currentImageIndex], 'large')}
              srcSet={getImageSrcSet(images[currentImageIndex])}
              sizes="(max-width: 1024px) 100vw, 50vw"
              alt={buildingName}
              className="w-full h-full object-cover"
              loading="lazy"
            />
            
            {/* Navigation Arrows */}
            {images.length > 1 && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handlePrevious}
                  className="absolute left-4 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full w-10 h-10"
                >
                  <ChevronLeft className="h-6 w-6" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleNext}
                  className="absolute right-4 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full w-10 h-10"
                >
                  <ChevronRight className="h-6 w-6" />
                </Button>

                {/* Image Counter */}
                <div className="absolute top-4 right-4 bg-black/60 text-white px-3 py-1 rounded-full text-sm">
                  {currentImageIndex + 1} / {images.length}
                </div>
              </>
            )}
          </>
        ) : (
          <div className="w-full h-full bg-slate-200 flex items-center justify-center">
            <Building2 className="h-24 w-24 text-slate-400" />
          </div>
        )}
      </div>

      {/* Thumbnail Gallery */}
      {images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-2 scroll-smooth">
          {images.map((image, index) => (
            <button
              key={index}
              ref={(el) => (thumbnailRefs.current[index] = el)}
              onClick={() => onImageIndexChange(index)}
              className={`flex-shrink-0 w-20 h-20 rounded-lg overflow-hidden border-2 transition-all ${
                index === currentImageIndex
                  ? 'border-primary ring-2 ring-primary ring-offset-2'
                  : 'border-slate-300 hover:border-primary/50'
              }`}
            >
              <img
                src={getImageUrl(image, 'thumbnail')}
                alt={`${buildingName} ${index + 1}`}
                className="w-full h-full object-cover"
                loading="lazy"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
