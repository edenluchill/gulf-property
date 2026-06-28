import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react'
import {
  FavoritesData,
  loadFavorites,
  addProject,
  removeProject,
  addUnitType,
  removeUnitType,
  isProjectFavorite as checkProjectFavorite,
  isUnitTypeFavorite as checkUnitTypeFavorite,
  getProjectUnitTypeIds as getUnitTypeIds,
  pushAddFavorite,
  pushRemoveFavorite,
  mergeFavoritesOnLogin,
} from '../lib/favorites'
import { useAuth } from './AuthContext'
import { trackEvent } from '../lib/track'

interface FavoritesContextValue {
  favorites: FavoritesData
  isProjectFavorite: (projectId: string) => boolean
  isUnitTypeFavorite: (projectId: string, unitTypeId: string) => boolean
  toggleProjectFavorite: (projectId: string) => void
  toggleUnitTypeFavorite: (projectId: string, unitTypeId: string) => void
  getProjectUnitTypeIds: (projectId: string) => string[]
  totalCount: number
  projectCount: number
  unitTypeCount: number
  isDrawerOpen: boolean
  openDrawer: () => void
  closeDrawer: () => void
  isCompareOpen: boolean
  openCompare: () => void
  closeCompare: () => void
}

const FavoritesContext = createContext<FavoritesContextValue | null>(null)

interface FavoritesProviderProps {
  children: ReactNode
}

export function FavoritesProvider({ children }: FavoritesProviderProps) {
  const [favorites, setFavorites] = useState<FavoritesData>(() => loadFavorites())
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [isCompareOpen, setIsCompareOpen] = useState(false)
  const { user } = useAuth()
  const isLoggedIn = !!user

  // Listen for storage changes (cross-tab sync)
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'pinzos-favorites') {
        setFavorites(loadFavorites())
      }
    }

    window.addEventListener('storage', handleStorageChange)
    return () => window.removeEventListener('storage', handleStorageChange)
  }, [])

  // On login: merge this browser's local picks into the account, then adopt the
  // unified set. Runs once per user.id (guarded) so re-renders don't re-merge.
  const mergedForUser = useRef<string | null>(null)
  useEffect(() => {
    if (!user) { mergedForUser.current = null; return }
    if (mergedForUser.current === user.id) return
    mergedForUser.current = user.id
    void mergeFavoritesOnLogin().then((merged) => setFavorites(merged))
  }, [user])

  const isProjectFavorite = useCallback((projectId: string) => {
    return checkProjectFavorite(projectId)
  }, [favorites]) // eslint-disable-line react-hooks/exhaustive-deps

  const isUnitTypeFavorite = useCallback((projectId: string, unitTypeId: string) => {
    return checkUnitTypeFavorite(projectId, unitTypeId)
  }, [favorites]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleProjectFavorite = useCallback((projectId: string) => {
    const wasFavorite = checkProjectFavorite(projectId)
    const newData = wasFavorite ? removeProject(projectId) : addProject(projectId)
    setFavorites(newData)
    const action = wasFavorite ? 'remove' : 'add'
    trackEvent('favorite_toggle', { action, item_type: 'project' }, { project_id: projectId })
    if (isLoggedIn) {
      if (wasFavorite) void pushRemoveFavorite(projectId)
      else void pushAddFavorite(projectId)
    }
  }, [isLoggedIn])

  const toggleUnitTypeFavorite = useCallback((projectId: string, unitTypeId: string) => {
    const wasFavorite = checkUnitTypeFavorite(projectId, unitTypeId)
    const newData = wasFavorite ? removeUnitType(projectId, unitTypeId) : addUnitType(projectId, unitTypeId)
    setFavorites(newData)
    const action = wasFavorite ? 'remove' : 'add'
    trackEvent('favorite_toggle', { action, item_type: 'unit_type', unit_type_id: unitTypeId }, { project_id: projectId })
    if (isLoggedIn) {
      if (wasFavorite) void pushRemoveFavorite(projectId, unitTypeId)
      else void pushAddFavorite(projectId, unitTypeId)
    }
  }, [isLoggedIn])

  const getProjectUnitTypeIds = useCallback((projectId: string) => {
    return getUnitTypeIds(projectId)
  }, [favorites]) // eslint-disable-line react-hooks/exhaustive-deps

  const totalCount = favorites.projects.length +
    favorites.projects.reduce((sum, p) => sum + p.unitTypeIds.length, 0)

  const projectCount = favorites.projects.length

  const unitTypeCount = favorites.projects.reduce((sum, p) => sum + p.unitTypeIds.length, 0)

  const openDrawer = useCallback(() => setIsDrawerOpen(true), [])
  const closeDrawer = useCallback(() => setIsDrawerOpen(false), [])

  const openCompare = useCallback(() => setIsCompareOpen(true), [])
  const closeCompare = useCallback(() => setIsCompareOpen(false), [])

  const value: FavoritesContextValue = {
    favorites,
    isProjectFavorite,
    isUnitTypeFavorite,
    toggleProjectFavorite,
    toggleUnitTypeFavorite,
    getProjectUnitTypeIds,
    totalCount,
    projectCount,
    unitTypeCount,
    isDrawerOpen,
    openDrawer,
    closeDrawer,
    isCompareOpen,
    openCompare,
    closeCompare,
  }

  return (
    <FavoritesContext.Provider value={value}>
      {children}
    </FavoritesContext.Provider>
  )
}

export function useFavorites() {
  const context = useContext(FavoritesContext)
  if (!context) {
    throw new Error('useFavorites must be used within a FavoritesProvider')
  }
  return context
}
