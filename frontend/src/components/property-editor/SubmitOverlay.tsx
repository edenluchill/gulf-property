/**
 * Submit Overlay - Full-screen loading overlay during submission
 */

import { motion, AnimatePresence } from 'framer-motion'
import { Loader2 } from 'lucide-react'

interface SubmitOverlayProps {
  isSubmitting: boolean
  title?: string
  subtitle?: string
  hint?: string
  accentColor?: string
}

export function SubmitOverlay({
  isSubmitting,
  title = 'Submitting Project',
  subtitle = 'Saving to database...',
  hint = 'Please wait',
  accentColor = 'teal',
}: SubmitOverlayProps) {
  const colorClass = {
    teal: 'text-teal-600',
    blue: 'text-blue-600',
    green: 'text-green-600',
  }[accentColor] || 'text-teal-600'

  const dotClass = {
    teal: 'bg-teal-500',
    blue: 'bg-blue-500',
    green: 'bg-green-500',
  }[accentColor] || 'bg-teal-500'

  return (
    <AnimatePresence>
      {isSubmitting && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center"
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="bg-white rounded-2xl shadow-2xl p-12 max-w-md mx-4"
          >
            <div className="text-center">
              <Loader2 className={`h-20 w-20 mx-auto mb-6 animate-spin ${colorClass}`} />
              <h3 className="text-2xl font-bold text-gray-900 mb-3">{title}</h3>
              <p className="text-gray-600 mb-2">{subtitle}</p>
              <p className="text-sm text-gray-500">{hint}</p>
              <div className="mt-6 flex items-center justify-center gap-1">
                <div
                  className={`h-2 w-2 ${dotClass} rounded-full animate-bounce`}
                  style={{ animationDelay: '0ms' }}
                ></div>
                <div
                  className={`h-2 w-2 ${dotClass} rounded-full animate-bounce`}
                  style={{ animationDelay: '150ms' }}
                ></div>
                <div
                  className={`h-2 w-2 ${dotClass} rounded-full animate-bounce`}
                  style={{ animationDelay: '300ms' }}
                ></div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
