import { useState } from 'react'
import { Building2, Expand } from 'lucide-react'
import { getImageUrl, getImageSrcSet } from '../../lib/image-utils'
import { ImageLightbox } from '../../components/ImageLightbox'

interface ImageGalleryProps {
  images: string[]
  buildingName: string
  currentImageIndex?: number
  onImageIndexChange?: (index: number) => void
}

/**
 * Mobile/tablet image gallery — vertical scroll of full-width images.
 * 点击任意图进入 Lightbox 全屏画廊（pad 上经纪给客户看图的主要方式）。
 */
export function ImageGallery({
  images,
  buildingName
}: ImageGalleryProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState(0)

  const openLightbox = (index: number) => {
    setLightboxIndex(index)
    setLightboxOpen(true)
  }

  return (
    <div className="space-y-3">
      {images && images.length > 0 ? (
        images.map((image, index) => (
          <div
            key={index}
            className="group relative w-full cursor-pointer overflow-hidden rounded-xl bg-slate-100"
            onClick={() => openLightbox(index)}
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
              <div className="absolute top-2 end-2 bg-black/60 text-white px-2 py-0.5 rounded-full text-xs font-medium">
                {index + 1} / {images.length}
              </div>
            )}
            {/* 放大提示(触屏无 hover,常显轻量图标) */}
            <div className="absolute bottom-2 end-2 rounded-full bg-black/45 p-1.5 text-white backdrop-blur-sm">
              <Expand className="h-3.5 w-3.5" />
            </div>
          </div>
        ))
      ) : (
        <div className="w-full h-64 bg-slate-200 rounded-xl flex items-center justify-center">
          <Building2 className="h-16 w-16 text-slate-400" />
        </div>
      )}

      <ImageLightbox
        images={images || []}
        initialIndex={lightboxIndex}
        isOpen={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
        buildingName={buildingName}
      />
    </div>
  )
}
