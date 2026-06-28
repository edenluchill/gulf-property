import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { getImageUrl } from '../lib/image-utils'

interface MobileBottomSheetProps {
  isOpen: boolean
  onClose: () => void
  title: string
  subtitle?: string
  /** Optional hero photo shown as a banner behind the title. */
  headerImage?: string | null
  children: ReactNode
  height?: string // e.g., '60vh', '85vh', '90vh'
}

export default function MobileBottomSheet({ isOpen, onClose, title, subtitle, headerImage, children, height = '60vh' }: MobileBottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null)

  // Prevent body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/40 z-[10000] transition-opacity duration-300 ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        className={`fixed bottom-0 left-0 right-0 z-[10000] bg-white rounded-t-2xl shadow-2xl transition-transform duration-300 ease-out flex flex-col overflow-hidden ${
          isOpen ? 'translate-y-0' : 'translate-y-full'
        }`}
        style={{ height }}
      >
        {headerImage ? (
          /* Hero header — photo banner with the title overlaid for recognition */
          <div className="relative shrink-0 h-32 w-full">
            <img src={getImageUrl(headerImage, 'medium')} alt={title} className="absolute inset-0 h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-black/10" />
            <div className="absolute left-1/2 top-2 h-1 w-10 -translate-x-1/2 rounded-full bg-white/70" />
            <button onClick={onClose} className="absolute right-3 top-3 rounded-full bg-black/35 p-1.5 text-white backdrop-blur-sm transition-colors hover:bg-black/55">
              <X className="h-5 w-5" />
            </button>
            <div className="absolute inset-x-0 bottom-0 p-4">
              <h2 className="truncate text-xl font-bold text-white drop-shadow-sm">{title}</h2>
              {subtitle && <p className="truncate text-sm text-white/80">{subtitle}</p>}
            </div>
          </div>
        ) : (
          /* Plain header (no photo) */
          <div className="flex shrink-0 flex-col items-center border-b border-slate-200 px-4 pt-3 pb-2">
            <div className="mb-3 h-1 w-10 rounded-full bg-slate-300" />
            <div className="flex w-full items-center justify-between">
              <div className="min-w-0 flex-1 pr-4">
                <h2 className="truncate text-lg font-bold text-slate-900">{title}</h2>
                {subtitle && <p className="truncate text-sm text-slate-500">{subtitle}</p>}
              </div>
              <button onClick={onClose} className="flex-shrink-0 rounded-full p-1.5 transition-colors hover:bg-slate-100">
                <X className="h-5 w-5 text-slate-600" />
              </button>
            </div>
          </div>
        )}

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {children}
        </div>
      </div>
    </>
  )
}
