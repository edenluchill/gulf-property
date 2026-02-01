import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
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
} from '../lib/favorites'

interface FavoritesContextValue {
  favorites: FavoritesData
  isProjectFavorite: (projectId: string) => boolean
  isUnitTypeFavorite: (projectId: string, unitTypeId: string) => boolean
  toggleProjectFavorite: (projectId: string) => void
  toggleUnitTypeFavorite: (projectId: string, unitTypeId: string) => void
  getProjectUnitTypeIds: (projectId: string) => string[]
  totalCount: number
  projectCount: number
  isDrawerOpen: boolean
  openDrawer: () => void
  closeDrawer: () => void
}

const FavoritesContext = createContext<FavoritesContextValue | null>(null)

interface FavoritesProviderProps {
  children: ReactNode
}

export function FavoritesProvider({ children }: FavoritesProviderProps) {
  const [favorites, setFavorites] = useState<FavoritesData>(() => loadFavorites())
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)

  // Listen for storage changes (cross-tab sync)
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'gulf-property-favorites') {
        setFavorites(loadFavorites())
      }
    }

    window.addEventListener('storage', handleStorageChange)
    return () => window.removeEventListener('storage', handleStorageChange)
  }, [])

  const isProjectFavorite = useCallback((projectId: string) => {
    return checkProjectFavorite(projectId)
  }, [favorites]) // eslint-disable-line react-hooks/exhaustive-deps

  const isUnitTypeFavorite = useCallback((projectId: string, unitTypeId: string) => {
    return checkUnitTypeFavorite(projectId, unitTypeId)
  }, [favorites]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleProjectFavorite = useCallback((projectId: string) => {
    if (checkProjectFavorite(projectId)) {
      const newData = removeProject(projectId)
      setFavorites(newData)
    } else {
      const newData = addProject(projectId)
      setFavorites(newData)
    }
  }, [])

  const toggleUnitTypeFavorite = useCallback((projectId: string, unitTypeId: string) => {
    if (checkUnitTypeFavorite(projectId, unitTypeId)) {
      const newData = removeUnitType(projectId, unitTypeId)
      setFavorites(newData)
    } else {
      const newData = addUnitType(projectId, unitTypeId)
      setFavorites(newData)
    }
  }, [])

  const getProjectUnitTypeIds = useCallback((projectId: string) => {
    return getUnitTypeIds(projectId)
  }, [favorites]) // eslint-disable-line react-hooks/exhaustive-deps

  const totalCount = favorites.projects.length +
    favorites.projects.reduce((sum, p) => sum + p.unitTypeIds.length, 0)

  const projectCount = favorites.projects.length

  const openDrawer = useCallback(() => setIsDrawerOpen(true), [])
  const closeDrawer = useCallback(() => setIsDrawerOpen(false), [])

  const value: FavoritesContextValue = {
    favorites,
    isProjectFavorite,
    isUnitTypeFavorite,
    toggleProjectFavorite,
    toggleUnitTypeFavorite,
    getProjectUnitTypeIds,
    totalCount,
    projectCount,
    isDrawerOpen,
    openDrawer,
    closeDrawer,
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
