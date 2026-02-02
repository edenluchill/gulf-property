import * as React from 'react'
import { X } from 'lucide-react'
import { cn } from '../../lib/utils'

interface SheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
}

interface SheetContentProps {
  className?: string
  children: React.ReactNode
  side?: 'left' | 'right' | 'top' | 'bottom'
}

interface SheetHeaderProps {
  className?: string
  children: React.ReactNode
}

interface SheetTitleProps {
  className?: string
  children: React.ReactNode
}

interface SheetCloseProps {
  className?: string
  onClick?: () => void
}

export function Sheet({ open, onOpenChange, children }: SheetProps) {
  React.useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onOpenChange(false)
      }
    }

    if (open) {
      document.addEventListener('keydown', handleEscape)
      document.body.style.overflow = 'hidden'
    }

    return () => {
      document.removeEventListener('keydown', handleEscape)
      document.body.style.overflow = 'unset'
    }
  }, [open, onOpenChange])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[9999]">
      {/* Backdrop - covers everything including maps */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-[2px] animate-in fade-in"
        onClick={() => onOpenChange(false)}
      />
      {/* Content */}
      {children}
    </div>
  )
}

const slideAnimations = {
  right: 'animate-in slide-in-from-right',
  left: 'animate-in slide-in-from-left',
  top: 'animate-in slide-in-from-top',
  bottom: 'animate-in slide-in-from-bottom',
}

const sideClasses = {
  right: 'right-0 top-0 h-full',
  left: 'left-0 top-0 h-full',
  top: 'top-0 left-0 w-full',
  bottom: 'bottom-0 left-0 w-full',
}

export function SheetContent({ className = '', children, side = 'right' }: SheetContentProps) {
  return (
    <div
      className={cn(
        'fixed z-[10000] bg-white shadow-2xl flex flex-col',
        sideClasses[side],
        slideAnimations[side],
        side === 'right' || side === 'left' ? 'w-[400px] max-w-[90vw]' : 'h-[400px] max-h-[90vh]',
        className
      )}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  )
}

export function SheetHeader({ className = '', children }: SheetHeaderProps) {
  return (
    <div className={cn('px-6 py-4 border-b', className)}>
      {children}
    </div>
  )
}

export function SheetTitle({ className = '', children }: SheetTitleProps) {
  return (
    <h2 className={cn('text-lg font-semibold', className)}>
      {children}
    </h2>
  )
}

export function SheetClose({ className = '', onClick }: SheetCloseProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
        className
      )}
    >
      <X className="h-4 w-4" />
      <span className="sr-only">Close</span>
    </button>
  )
}

export function SheetDescription({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return (
    <p className={cn('text-sm text-slate-500', className)}>
      {children}
    </p>
  )
}
