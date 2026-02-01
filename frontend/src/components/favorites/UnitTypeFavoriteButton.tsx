import { Heart } from 'lucide-react'
import { Button } from '../ui/button'
import { useFavorites } from '../../contexts/FavoritesContext'
import { motion } from 'framer-motion'

interface UnitTypeFavoriteButtonProps {
  projectId: string
  unitTypeId: string
  size?: 'sm' | 'default'
}

export function UnitTypeFavoriteButton({ projectId, unitTypeId, size = 'default' }: UnitTypeFavoriteButtonProps) {
  const { isUnitTypeFavorite, toggleUnitTypeFavorite } = useFavorites()
  const isFavorite = isUnitTypeFavorite(projectId, unitTypeId)

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    toggleUnitTypeFavorite(projectId, unitTypeId)
  }

  return (
    <Button
      variant={isFavorite ? 'default' : 'outline'}
      size="icon"
      onClick={handleClick}
      className={size === 'sm' ? 'h-8 w-8' : 'h-10 w-10'}
    >
      <motion.div
        initial={false}
        animate={isFavorite ? { scale: [1, 1.3, 1] } : { scale: 1 }}
        transition={{ duration: 0.3 }}
      >
        <Heart
          className={`${size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'} ${isFavorite ? 'fill-current text-white' : ''}`}
        />
      </motion.div>
    </Button>
  )
}
