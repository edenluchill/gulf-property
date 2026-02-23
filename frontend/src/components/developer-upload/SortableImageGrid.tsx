/**
 * Sortable Image Grid Component
 *
 * Features:
 * - Drag and drop to reorder images (optimized with memo)
 * - Hide/show images (not delete - can restore later)
 * - Visual feedback for drag operations
 */

import { useState, useMemo, useCallback, memo } from 'react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  useSortable,
  rectSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Eye, EyeOff, GripVertical, Star, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface SortableImageGridProps {
  images: string[]
  hiddenImages?: string[]
  onImagesChange: (images: string[]) => void
  onHiddenImagesChange?: (hidden: string[]) => void
  primaryImage?: string
  onPrimaryImageChange?: (url: string | undefined) => void
  label?: string
  sortable?: boolean  // Enable/disable drag sorting
}

interface ImageItemProps {
  id: string
  url: string
  isHidden: boolean
  isPrimary: boolean
  isDefault: boolean
  onToggleHidden: () => void
  onSetPrimary: () => void
  showPrimarySelection: boolean
  sortable: boolean
  isDragOverlay?: boolean
}

// Memoized sortable image item - only re-renders when props change
const SortableImageItem = memo(function SortableImageItem({
  id,
  url,
  isHidden,
  isPrimary,
  isDefault,
  onToggleHidden,
  onSetPrimary,
  showPrimarySelection,
  sortable,
  isDragOverlay = false,
}: ImageItemProps) {
  const { t } = useTranslation('upload')
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: !sortable })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragOverlay ? undefined : transition,
    opacity: isDragging ? 0.3 : isHidden ? 0.4 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-colors group ${
        isDragOverlay
          ? 'shadow-2xl scale-105 border-blue-500'
          : isPrimary
          ? 'border-amber-500 ring-2 ring-amber-300'
          : isHidden
          ? 'border-gray-300 grayscale'
          : 'border-gray-200 hover:border-gray-400'
      }`}
    >
      {/* Image */}
      <img
        src={url}
        alt=""
        className="w-full h-full object-cover"
        draggable={false}
        loading="lazy"
      />

      {/* Hidden overlay */}
      {isHidden && (
        <div className="absolute inset-0 bg-gray-900/50 flex items-center justify-center">
          <EyeOff className="h-6 w-6 text-white" />
        </div>
      )}

      {/* Primary badge */}
      {isPrimary && !isHidden && (
        <div className="absolute top-1 left-1 bg-amber-500 rounded-full p-1">
          <Star className="h-3 w-3 text-white fill-white" />
        </div>
      )}

      {/* Default badge */}
      {isDefault && !isPrimary && !isHidden && (
        <div className="absolute bottom-0 left-0 right-0 bg-gray-800/70 text-white text-[9px] text-center py-0.5">
          {t('visualContent.default', '默认')}
        </div>
      )}

      {/* Drag handle - only show if sortable */}
      {sortable && !isDragOverlay && (
        <div
          {...attributes}
          {...listeners}
          className="absolute top-1 right-1 p-1 bg-white/90 rounded shadow cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity touch-none"
        >
          <GripVertical className="h-4 w-4 text-gray-600" />
        </div>
      )}

      {/* Action buttons - bottom */}
      {!isDragOverlay && (
        <div className="absolute bottom-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {/* Set as primary */}
          {showPrimarySelection && !isHidden && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onSetPrimary()
              }}
              className={`p-1.5 rounded shadow transition-colors ${
                isPrimary
                  ? 'bg-amber-500 text-white'
                  : 'bg-white/90 text-gray-600 hover:bg-amber-100'
              }`}
              title={isPrimary ? '取消主图' : '设为主图'}
            >
              <Star className={`h-3.5 w-3.5 ${isPrimary ? 'fill-white' : ''}`} />
            </button>
          )}

          {/* Toggle visibility */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onToggleHidden()
            }}
            className={`p-1.5 rounded shadow transition-colors ${
              isHidden
                ? 'bg-green-500 text-white hover:bg-green-600'
                : 'bg-white/90 text-gray-600 hover:bg-red-100 hover:text-red-600'
            }`}
            title={isHidden ? '显示图片' : '隐藏图片'}
          >
            {isHidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          </button>
        </div>
      )}
    </div>
  )
})

// Static image for drag overlay (no hooks, pure render)
const DragOverlayImage = memo(function DragOverlayImage({ url }: { url: string }) {
  return (
    <div className="aspect-square w-20 rounded-lg overflow-hidden border-2 border-blue-500 shadow-2xl bg-white">
      <img src={url} alt="" className="w-full h-full object-cover" draggable={false} />
    </div>
  )
})

export function SortableImageGrid({
  images,
  hiddenImages = [],
  onImagesChange,
  onHiddenImagesChange,
  primaryImage,
  onPrimaryImageChange,
  label,
  sortable = true,
}: SortableImageGridProps) {
  const { t } = useTranslation('upload')
  const [showHidden, setShowHidden] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)

  // Optimized sensor with higher activation distance for mobile
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 10,
      },
    })
  )

  // Memoized visible images list
  const visibleImages = useMemo(
    () => images.filter(img => !hiddenImages.includes(img)),
    [images, hiddenImages]
  )

  // Memoized display list
  const displayImages = useMemo(() => {
    if (showHidden) {
      return [...visibleImages, ...images.filter(img => hiddenImages.includes(img))]
    }
    return visibleImages
  }, [images, hiddenImages, showHidden, visibleImages])

  const hiddenCount = hiddenImages.length

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string)
  }, [])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveId(null)
    const { active, over } = event

    if (over && active.id !== over.id) {
      const oldIndex = images.indexOf(active.id as string)
      const newIndex = images.indexOf(over.id as string)
      if (oldIndex !== -1 && newIndex !== -1) {
        onImagesChange(arrayMove(images, oldIndex, newIndex))
      }
    }
  }, [images, onImagesChange])

  const handleDragCancel = useCallback(() => {
    setActiveId(null)
  }, [])

  const toggleHidden = useCallback((url: string) => {
    if (!onHiddenImagesChange) return

    if (hiddenImages.includes(url)) {
      onHiddenImagesChange(hiddenImages.filter(h => h !== url))
    } else {
      onHiddenImagesChange([...hiddenImages, url])
      if (primaryImage === url && onPrimaryImageChange) {
        onPrimaryImageChange(undefined)
      }
    }
  }, [hiddenImages, onHiddenImagesChange, primaryImage, onPrimaryImageChange])

  const handleSetPrimary = useCallback((url: string) => {
    if (!onPrimaryImageChange) return
    onPrimaryImageChange(primaryImage === url ? undefined : url)
  }, [primaryImage, onPrimaryImageChange])

  const restoreAll = useCallback(() => {
    onHiddenImagesChange?.([])
  }, [onHiddenImagesChange])

  if (images.length === 0) {
    return null
  }

  const gridContent = (
    <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 gap-2">
      {displayImages.map((url) => {
        const isHidden = hiddenImages.includes(url)
        const isPrimary = primaryImage === url
        const visibleIndex = visibleImages.indexOf(url)
        const isDefault = visibleIndex === 0 && !primaryImage

        return (
          <SortableImageItem
            key={url}
            id={url}
            url={url}
            isHidden={isHidden}
            isPrimary={isPrimary}
            isDefault={isDefault}
            onToggleHidden={() => toggleHidden(url)}
            onSetPrimary={() => handleSetPrimary(url)}
            showPrimarySelection={!!onPrimaryImageChange}
            sortable={sortable && !isHidden}
          />
        )
      })}
    </div>
  )

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {label && (
            <span className="text-sm font-medium text-gray-700">{label}</span>
          )}
          <span className="text-xs text-gray-500">
            ({visibleImages.length} {t('visualContent.visible', '可见')})
          </span>
        </div>

        <div className="flex items-center gap-2">
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setShowHidden(!showHidden)}
              className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors ${
                showHidden
                  ? 'bg-gray-200 text-gray-700'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              {showHidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              {hiddenCount} {t('visualContent.hidden', '已隐藏')}
            </button>
          )}

          {hiddenCount > 0 && onHiddenImagesChange && (
            <button
              type="button"
              onClick={restoreAll}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-green-50 text-green-700 rounded hover:bg-green-100 transition-colors"
            >
              <RotateCcw className="h-3 w-3" />
              {t('visualContent.restoreAll', '全部恢复')}
            </button>
          )}
        </div>
      </div>

      {/* Hint */}
      {sortable && (
        <p className="text-xs text-gray-500">
          {t('visualContent.dragHint', '拖拽调整顺序，点击眼睛图标隐藏/显示图片')}
        </p>
      )}

      {/* Grid with or without DnD */}
      {sortable ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <SortableContext items={displayImages} strategy={rectSortingStrategy}>
            {gridContent}
          </SortableContext>
          <DragOverlay dropAnimation={null}>
            {activeId ? <DragOverlayImage url={activeId} /> : null}
          </DragOverlay>
        </DndContext>
      ) : (
        gridContent
      )}
    </div>
  )
}

/**
 * Simple Image Grid - Only hide/show, no sorting
 * For floor plans where order doesn't matter
 */
export function SimpleImageGrid({
  images,
  hiddenImages = [],
  onHiddenImagesChange,
  label,
}: {
  images: string[]
  hiddenImages?: string[]
  onHiddenImagesChange?: (hidden: string[]) => void
  label?: string
}) {
  return (
    <SortableImageGrid
      images={images}
      hiddenImages={hiddenImages}
      onImagesChange={() => {}} // No-op, order doesn't change
      onHiddenImagesChange={onHiddenImagesChange}
      label={label}
      sortable={false}  // Disable sorting
    />
  )
}
