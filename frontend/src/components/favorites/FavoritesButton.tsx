import { Heart } from 'lucide-react'
import { Button } from '../ui/button'
import { useFavorites } from '../../contexts/FavoritesContext'
import { motion, AnimatePresence } from 'framer-motion'

export function FavoritesButton() {
  const { projectCount, openDrawer } = useFavorites()

  return (
    <Button
      variant="ghost"
      onClick={openDrawer}
      className="relative flex items-center space-x-2 px-4 py-2 rounded-xl text-sm font-medium text-slate-700 hover:text-slate-900 hover:bg-slate-100/80"
    >
      <Heart className="h-4 w-4" />
      <AnimatePresence>
        {projectCount > 0 && (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0 }}
            className="absolute -top-1 -right-1 bg-teal-500 text-white text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center"
          >
            {projectCount > 99 ? '99+' : projectCount}
          </motion.span>
        )}
      </AnimatePresence>
    </Button>
  )
}
