const STORAGE_KEY = 'pinzos-favorites'

export interface FavoriteProject {
  projectId: string
  addedAt: number
  unitTypeIds: string[]
}

export interface FavoritesData {
  version: 2
  projects: FavoriteProject[]
}

function createEmptyData(): FavoritesData {
  return {
    version: 2,
    projects: []
  }
}

function migrateFromV1(oldData: string[]): FavoritesData {
  return {
    version: 2,
    projects: oldData.map(projectId => ({
      projectId,
      addedAt: Date.now(),
      unitTypeIds: []
    }))
  }
}

export function loadFavorites(): FavoritesData {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) {
      return createEmptyData()
    }

    const parsed = JSON.parse(stored)

    // Check if it's old format (array of strings)
    if (Array.isArray(parsed)) {
      const migrated = migrateFromV1(parsed)
      saveFavorites(migrated)
      return migrated
    }

    // Check if it's the new format
    if (parsed.version === 2 && Array.isArray(parsed.projects)) {
      return parsed as FavoritesData
    }

    // Unknown format, reset to empty
    return createEmptyData()
  } catch {
    return createEmptyData()
  }
}

export function saveFavorites(data: FavoritesData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  // Dispatch storage event for cross-tab sync
  window.dispatchEvent(new StorageEvent('storage', {
    key: STORAGE_KEY,
    newValue: JSON.stringify(data)
  }))
}

export function isProjectFavorite(projectId: string): boolean {
  const data = loadFavorites()
  return data.projects.some(p => p.projectId === projectId)
}

export function addProject(projectId: string): FavoritesData {
  const data = loadFavorites()
  if (!data.projects.some(p => p.projectId === projectId)) {
    data.projects.push({
      projectId,
      addedAt: Date.now(),
      unitTypeIds: []
    })
    saveFavorites(data)
  }
  return data
}

export function removeProject(projectId: string): FavoritesData {
  const data = loadFavorites()
  data.projects = data.projects.filter(p => p.projectId !== projectId)
  saveFavorites(data)
  return data
}

export function isUnitTypeFavorite(projectId: string, unitTypeId: string): boolean {
  const data = loadFavorites()
  const project = data.projects.find(p => p.projectId === projectId)
  return project ? project.unitTypeIds.includes(unitTypeId) : false
}

export function addUnitType(projectId: string, unitTypeId: string): FavoritesData {
  let data = loadFavorites()
  let project = data.projects.find(p => p.projectId === projectId)

  // If project is not in favorites, add it first
  if (!project) {
    data = addProject(projectId)
    project = data.projects.find(p => p.projectId === projectId)!
  }

  // Add unit type if not already present
  if (!project.unitTypeIds.includes(unitTypeId)) {
    project.unitTypeIds.push(unitTypeId)
    saveFavorites(data)
  }

  return data
}

export function removeUnitType(projectId: string, unitTypeId: string): FavoritesData {
  const data = loadFavorites()
  const project = data.projects.find(p => p.projectId === projectId)

  if (project) {
    project.unitTypeIds = project.unitTypeIds.filter(id => id !== unitTypeId)
    saveFavorites(data)
  }

  return data
}

export function getProjectUnitTypeIds(projectId: string): string[] {
  const data = loadFavorites()
  const project = data.projects.find(p => p.projectId === projectId)
  return project ? project.unitTypeIds : []
}

export function getFavoriteCount(): number {
  const data = loadFavorites()
  // Count projects + total unit types across all projects
  return data.projects.length + data.projects.reduce((sum, p) => sum + p.unitTypeIds.length, 0)
}

export function getProjectCount(): number {
  const data = loadFavorites()
  return data.projects.length
}

// Legacy API compatibility
export function getFavorites(): string[] {
  const data = loadFavorites()
  return data.projects.map(p => p.projectId)
}

export function addFavorite(projectId: string): void {
  addProject(projectId)
}

export function removeFavorite(projectId: string): void {
  removeProject(projectId)
}

export function isFavorite(projectId: string): boolean {
  return isProjectFavorite(projectId)
}
