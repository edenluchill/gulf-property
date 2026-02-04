/**
 * Project Cache Utility
 *
 * Caches project data in localStorage for instant display in favorites drawer.
 * Shows cached data immediately, then refreshes in background.
 */

import { ResidentialProject, UnitType } from '../types'

const CACHE_KEY = 'pinzos-project-cache'
const CACHE_EXPIRY_MS = 24 * 60 * 60 * 1000 // 24 hours

interface CachedProject {
  project: ResidentialProject
  units: UnitType[]
  cachedAt: number
}

interface ProjectCache {
  [projectId: string]: CachedProject
}

// Load cache from localStorage
function loadCache(): ProjectCache {
  try {
    const cached = localStorage.getItem(CACHE_KEY)
    if (!cached) return {}
    return JSON.parse(cached)
  } catch {
    return {}
  }
}

// Save cache to localStorage
function saveCache(cache: ProjectCache): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch (e) {
    console.warn('Failed to save project cache:', e)
  }
}

// Get cached project data (returns null if not cached or expired)
export function getCachedProject(projectId: string): CachedProject | null {
  const cache = loadCache()
  const cached = cache[projectId]

  if (!cached) return null

  // Check if cache is expired
  const now = Date.now()
  if (now - cached.cachedAt > CACHE_EXPIRY_MS) {
    // Remove expired entry
    delete cache[projectId]
    saveCache(cache)
    return null
  }

  return cached
}

// Cache project data
export function cacheProject(projectId: string, project: ResidentialProject, units: UnitType[]): void {
  const cache = loadCache()

  cache[projectId] = {
    project,
    units,
    cachedAt: Date.now()
  }

  // Clean up old entries (keep only last 50 projects)
  const entries = Object.entries(cache)
  if (entries.length > 50) {
    // Sort by cachedAt and keep newest 50
    entries.sort((a, b) => b[1].cachedAt - a[1].cachedAt)
    const newCache: ProjectCache = {}
    entries.slice(0, 50).forEach(([id, data]) => {
      newCache[id] = data
    })
    saveCache(newCache)
  } else {
    saveCache(cache)
  }
}

// Remove project from cache
export function removeCachedProject(projectId: string): void {
  const cache = loadCache()
  delete cache[projectId]
  saveCache(cache)
}

// Clear all cache
export function clearProjectCache(): void {
  localStorage.removeItem(CACHE_KEY)
}

// Check if cached data is stale (older than 5 minutes)
export function isCacheStale(cachedAt: number): boolean {
  const STALE_THRESHOLD = 5 * 60 * 1000 // 5 minutes
  return Date.now() - cachedAt > STALE_THRESHOLD
}
