import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Heart, X, BarChart3 } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '../ui/sheet'
import { Button } from '../ui/button'
import { useFavorites } from '../../contexts/FavoritesContext'
import { FavoriteProjectCard } from './FavoriteProjectCard'
import { UnitComparePanel } from './UnitComparePanel'
import { UnitType, ResidentialProject } from '../../types'
import { getCachedProject, cacheProject } from '../../lib/projectCache'

interface CompareItem {
  unit: UnitType
  project: ResidentialProject
}

const MAX_COMPARE_ITEMS = 3

export function FavoritesDrawer() {
  const { t } = useTranslation('favorites')
  const { favorites, isDrawerOpen, closeDrawer, projectCount, unitTypeCount, isCompareOpen, openCompare, closeCompare } = useFavorites()
  const [compareItems, setCompareItems] = useState<CompareItem[]>([])
  const [loadingCompare, setLoadingCompare] = useState(false)

  // Load compare items when opening compare panel (max 3)
  const handleOpenCompare = async () => {
    setLoadingCompare(true)

    const items: CompareItem[] = []

    for (const fav of favorites.projects) {
      if (fav.unitTypeIds.length === 0) continue
      if (items.length >= MAX_COMPARE_ITEMS) break // Stop at max

      try {
        // Try cache first
        const cached = getCachedProject(fav.projectId)
        let project: ResidentialProject | null = null
        let units: UnitType[] = []

        if (cached) {
          project = cached.project
          units = cached.units
        } else {
          // Fetch from server
          const res = await fetch(`/api/residential-projects/${fav.projectId}`)
          const data = await res.json()
          if (data.success && data.project) {
            project = data.project
            units = data.project.units || []
            cacheProject(fav.projectId, data.project, units)
          }
        }

        if (project && units.length > 0) {
          // Add each favorited unit type (up to max)
          for (const unitTypeId of fav.unitTypeIds) {
            if (items.length >= MAX_COMPARE_ITEMS) break
            const unit = units.find(u => u.id === unitTypeId)
            if (unit) {
              items.push({ unit, project })
            }
          }
        }
      } catch (e) {
        console.error('Failed to load project for compare:', fav.projectId, e)
      }
    }

    setCompareItems(items)
    setLoadingCompare(false)
    openCompare()
  }

  const handleRemoveFromCompare = (unitId: string) => {
    const newItems = compareItems.filter(item => item.unit.id !== unitId)
    setCompareItems(newItems)
    if (newItems.length < 2) {
      closeCompare()
    }
  }

  const compareCount = Math.min(unitTypeCount, MAX_COMPARE_ITEMS)

  return (
    <>
      {/* Non-modal Sheet - allows interaction with compare panel */}
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
          {unitTypeCount >= 2 && (
            <div className="border-t pt-4 mt-auto px-1">
              <Button
                className="w-full bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-600 hover:to-emerald-600 text-white"
                onClick={handleOpenCompare}
                disabled={loadingCompare}
              >
                {loadingCompare ? (
                  <>
                    <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
                    {t('actions.loading', 'Loading...')}
                  </>
                ) : (
                  <>
                    <BarChart3 className="h-4 w-4 mr-2" />
                    {t('actions.compare')} ({compareCount})
                  </>
                )}
              </Button>
              {unitTypeCount > MAX_COMPARE_ITEMS && (
                <p className="text-xs text-amber-600 text-center mt-2">
                  {t('compare.maxHint', 'Only first {{max}} unit types will be compared', { max: MAX_COMPARE_ITEMS })}
                </p>
              )}
              <p className="text-xs text-slate-500 text-center mt-1">
                {t('compare.hint', 'Compare your saved unit types side by side')}
              </p>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Compare Panel */}
      <UnitComparePanel
        items={compareItems}
        isOpen={isCompareOpen}
        onClose={closeCompare}
        onRemoveItem={handleRemoveFromCompare}
      />
    </>
  )
}
