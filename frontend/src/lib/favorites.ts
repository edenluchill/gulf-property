import { supabase } from './supabase'
import { API_BASE_URL } from './config'

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

// ---------------------------------------------------------------------------
// Server sync (logged-in users) — localStorage stays the instant/offline source
// of truth and the anonymous store; these mirror writes to /api/favorites and,
// on login, merge the local picks into the account. All best-effort: a failed
// sync never breaks the local UX. See backend/src/routes/favorites.ts.
// ---------------------------------------------------------------------------

async function authHeader(): Promise<Record<string, string> | null> {
  try {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    return token ? { Authorization: `Bearer ${token}` } : null
  } catch {
    return null
  }
}

/** Mirror an add to the server. No-op when logged out. Best-effort. */
export async function pushAddFavorite(projectId: string, unitTypeId?: string): Promise<void> {
  try {
    const auth = await authHeader()
    if (!auth) return
    await fetch(`${API_BASE_URL}/api/favorites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({ project_id: projectId, unit_type_id: unitTypeId }),
      keepalive: true,
    })
  } catch { /* swallow — local store already updated */ }
}

/** Mirror a remove to the server. No-op when logged out. Best-effort. */
export async function pushRemoveFavorite(projectId: string, unitTypeId?: string): Promise<void> {
  try {
    const auth = await authHeader()
    if (!auth) return
    await fetch(`${API_BASE_URL}/api/favorites`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({ project_id: projectId, unit_type_id: unitTypeId }),
      keepalive: true,
    })
  } catch { /* swallow */ }
}

/**
 * On login: push the local (anonymous) favorites to the account and pull back the
 * unified set, writing it to localStorage. Returns the merged data (or the local
 * data unchanged if the user is logged out / the call fails) so the context can
 * update state. Best-effort.
 */
export async function mergeFavoritesOnLogin(): Promise<FavoritesData> {
  const local = loadFavorites()
  try {
    const auth = await authHeader()
    if (!auth) return local
    const res = await fetch(`${API_BASE_URL}/api/favorites/merge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({ projects: local.projects }),
    })
    if (!res.ok) return local
    const merged = (await res.json()) as FavoritesData
    if (merged && merged.version === 2 && Array.isArray(merged.projects)) {
      saveFavorites(merged)
      return merged
    }
    return local
  } catch {
    return local
  }
}

/** Clear the local store (call on sign-out so the next account starts clean). */
export function clearFavorites(): void {
  saveFavorites(createEmptyData())
}
