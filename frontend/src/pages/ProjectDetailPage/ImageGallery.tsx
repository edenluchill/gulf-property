import { Building2 } from 'lucide-react'
import { getImageUrl, getImageSrcSet } from '../../lib/image-utils'

interface ImageGalleryProps {
  images: string[]
  buildingName: string
  currentImageIndex?: number
  onImageIndexChange?: (index: number) => void
}

/**
 * Mobile-only image gallery component
 * Shows all images in a vertical scroll layout
 * For desktop/tablet, use DesktopHeroGallery or TabletScrollGallery instead
 */
export function ImageGallery({
  images,
  buildingName
}: ImageGalleryProps) {
  // Mobile: Show all images vertically scrollable
  return (
    <div className="space-y-3">
      {images && images.length > 0 ? (
        images.map((image, index) => (
          <div
            key={index}
            className="relative w-full rounded-xl overflow-hidden bg-slate-100"
          >
            <img
              src={getImageUrl(image, 'large')}
              srcSet={getImageSrcSet(image)}
              sizes="100vw"
              alt={`${buildingName} - ${index + 1}`}
              className="w-full h-auto object-contain"
              loading={index < 2 ? 'eager' : 'lazy'}
            />
            {/* Image number badge */}
            {images.length > 1 && (
              <div className="absolute top-2 right-2 bg-black/60 text-white px-2 py-0.5 rounded-full text-xs font-medium">
                {index + 1} / {images.length}
              </div>
            )}
          </div>
        ))
      ) : (
        <div className="w-full h-64 bg-slate-200 rounded-xl flex items-center justify-center">
          <Building2 className="h-16 w-16 text-slate-400" />
        </div>
      )}
    </div>
  )
}
