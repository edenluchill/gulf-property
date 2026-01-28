import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

interface MobileBottomSheetProps {
  isOpen: boolean
  onClose: () => void
  title: string
  children: ReactNode
  height?: string // e.g., '60vh', '85vh', '90vh'
}

export default function MobileBottomSheet({ isOpen, onClose, title, children, height = '60vh' }: MobileBottomSheetProps) {
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
        className={`fixed bottom-0 left-0 right-0 z-[10000] bg-white rounded-t-2xl shadow-2xl transition-transform duration-300 ease-out ${
          isOpen ? 'translate-y-0' : 'translate-y-full'
        }`}
        style={{ height }}
      >
        {/* Header */}
        <div className="flex flex-col items-center pt-3 pb-2 px-4 border-b border-slate-200">
          {/* Drag handle */}
          <div className="w-10 h-1 rounded-full bg-slate-300 mb-3" />
          <div className="flex items-center justify-between w-full">
            <h2 className="text-lg font-bold text-slate-900 truncate pr-4">{title}</h2>
            <button
              onClick={onClose}
              className="p-1.5 rounded-full hover:bg-slate-100 transition-colors flex-shrink-0"
            >
              <X className="w-5 h-5 text-slate-600" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto" style={{ height: `calc(${height} - 72px)` }}>
          {children}
        </div>
      </div>
    </>
  )
}
