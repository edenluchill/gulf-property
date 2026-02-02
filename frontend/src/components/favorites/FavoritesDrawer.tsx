import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Heart, X, Sparkles } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '../ui/sheet'
import { Button } from '../ui/button'
import { useFavorites } from '../../contexts/FavoritesContext'
import { FavoriteProjectCard } from './FavoriteProjectCard'

export function FavoritesDrawer() {
  const { t } = useTranslation('favorites')
  const navigate = useNavigate()
  const { favorites, isDrawerOpen, closeDrawer, projectCount, unitTypeCount } = useFavorites()

  // Count total comparable items (projects + unit types)
  const totalComparableItems = favorites.projects.reduce(
    (sum, p) => sum + 1 + p.unitTypeIds.length,
    0
  )

  const handleOpenCompare = () => {
    closeDrawer()
    navigate('/compare')
  }

  return (
    <>
      {/* Non-modal Sheet - allows interaction with compare modal */}
      <Sheet open={isDrawerOpen} onOpenChange={closeDrawer} modal={false}>
        <SheetContent side="right" className="w-[360px] max-w-[85vw] shadow-xl border-l">
          {/* Header */}
          <SheetHeader className="flex flex-row items-center justify-between border-b pb-4">
            <div className="flex items-center gap-3">
              <div className="bg-teal-100 p-2 rounded-lg">
                <Heart className="h-5 w-5 text-teal-600" />
              </div>
              <div>
                <SheetTitle>{t('drawer.title')}</SheetTitle>
                {projectCount > 0 && (
                  <p className="text-sm text-slate-500">
                    {t('count', { count: projectCount })}
                    {unitTypeCount > 0 && (
                      <span className="ml-1">
                        ({unitTypeCount} {t('unitTypes', 'unit types')})
                      </span>
                    )}
                  </p>
                )}
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={closeDrawer}
              className="h-8 w-8"
            >
              <X className="h-4 w-4" />
            </Button>
          </SheetHeader>

          {/* Content */}
          <div className="flex-1 overflow-y-auto py-4">
            {favorites.projects.length === 0 ? (
              // Empty State
              <div className="flex flex-col items-center justify-center h-full text-center px-6 py-12">
                <div className="bg-slate-100 rounded-full p-4 mb-4">
                  <Heart className="h-12 w-12 text-slate-300" />
                </div>
                <h3 className="text-lg font-semibold text-slate-700 mb-2">
                  {t('empty.drawer.title')}
                </h3>
                <p className="text-sm text-slate-500">
                  {t('empty.drawer.message')}
                </p>
              </div>
            ) : (
              // Projects List
              <div className="space-y-3 px-1">
                {favorites.projects.map((favorite) => (
                  <FavoriteProjectCard
                    key={favorite.projectId}
                    favorite={favorite}
                    onClose={closeDrawer}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Footer - Compare Button */}
          {totalComparableItems >= 2 && (
            <div className="border-t pt-4 mt-auto px-1">
              <Button
                onClick={handleOpenCompare}
                className="w-full bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-600 hover:to-emerald-600 text-white"
              >
                <Sparkles className="h-4 w-4 mr-2" />
                {t('actions.compare')}
              </Button>
              <p className="text-xs text-slate-500 text-center mt-2">
                {t('compare.selectItems')}
              </p>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  )
}
