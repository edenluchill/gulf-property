/**
 * Hook for fetching and managing Dubai POI data
 * - Uses localStorage for persistent cache
 * - Bulk loads all POIs for instant category toggle
 * - Supports seamless cache refresh
 */

import { useState, useEffect, useMemo } from 'react'
import { API_BASE_URL } from '../lib/config'

export type PoiCategory =
  | 'hospital' | 'clinic' | 'pharmacy'
  | 'school' | 'university'
  | 'mall' | 'supermarket'
  | 'restaurant' | 'cafe'
  | 'bank' | 'atm' | 'gas_station'
  | 'hotel' | 'mosque' | 'church'
  | 'park' | 'gym' | 'beach' | 'cinema'
  | 'police' | 'fire_station' | 'post_office' | 'embassy'

export interface Poi {
  id: string
  name: string
  name_ar?: string
  category: PoiCategory
  subcategory?: string
  lng: number
  lat: number
  address?: string
  phone?: string
  website?: string
  // Enrichment (lazy-loaded via /api/dubai-pois/:id/details — see PoiDetails)
}

/** Full POI record incl. free-source enrichment, loaded when a popup opens. */
export interface PoiDetails extends Poi {
  description?: string
  description_zh?: string
  photo_url?: string
  photo_credit?: string
  opening_hours?: string
  khda_rating?: string
  khda_year?: number
  khda_url?: string
}

export interface PoiCategoryInfo {
  id: PoiCategory
  label: string
  labelAr: string
  icon: string
  color: string
  group: 'healthcare' | 'education' | 'transport' | 'shopping' | 'dining' | 'finance' | 'leisure' | 'services'
}

// Group colors (unified)
const GROUP_COLORS = {
  healthcare: '#0d9488',  // teal - hospital friendly
  education: '#2563eb',   // blue
  transport: '#ea580c',   // orange
  shopping: '#db2777',    // pink
  dining: '#d97706',      // amber
  finance: '#059669',     // emerald
  leisure: '#7c3aed',     // violet
  services: '#475569',    // slate
}

// POI category definitions with icons and colors (unified by group)
export const POI_CATEGORIES: PoiCategoryInfo[] = [
  // Healthcare - red
  { id: 'hospital', label: 'Hospital', labelAr: 'مستشفى', icon: '🏥', color: GROUP_COLORS.healthcare, group: 'healthcare' },
  { id: 'clinic', label: 'Clinic', labelAr: 'عيادة', icon: '🩺', color: GROUP_COLORS.healthcare, group: 'healthcare' },
  { id: 'pharmacy', label: 'Pharmacy', labelAr: 'صيدلية', icon: '💊', color: GROUP_COLORS.healthcare, group: 'healthcare' },

  // Education - blue
  { id: 'school', label: 'School', labelAr: 'مدرسة', icon: '🏫', color: GROUP_COLORS.education, group: 'education' },
  { id: 'university', label: 'University', labelAr: 'جامعة', icon: '🎓', color: GROUP_COLORS.education, group: 'education' },

  // Shopping - pink
  { id: 'mall', label: 'Mall', labelAr: 'مول', icon: '🛒', color: GROUP_COLORS.shopping, group: 'shopping' },
  { id: 'supermarket', label: 'Supermarket', labelAr: 'سوبرماركت', icon: '🛍️', color: GROUP_COLORS.shopping, group: 'shopping' },

  // Dining - amber
  { id: 'restaurant', label: 'Restaurant', labelAr: 'مطعم', icon: '🍽️', color: GROUP_COLORS.dining, group: 'dining' },
  { id: 'cafe', label: 'Cafe', labelAr: 'مقهى', icon: '☕', color: GROUP_COLORS.dining, group: 'dining' },

  // Finance - emerald
  { id: 'bank', label: 'Bank', labelAr: 'بنك', icon: '🏦', color: GROUP_COLORS.finance, group: 'finance' },
  { id: 'atm', label: 'ATM', labelAr: 'صراف آلي', icon: '💳', color: GROUP_COLORS.finance, group: 'finance' },

  // Leisure - violet
  { id: 'hotel', label: 'Hotel', labelAr: 'فندق', icon: '🏨', color: GROUP_COLORS.leisure, group: 'leisure' },
  { id: 'park', label: 'Park', labelAr: 'حديقة', icon: '🌳', color: GROUP_COLORS.leisure, group: 'leisure' },
  { id: 'gym', label: 'Gym', labelAr: 'صالة رياضة', icon: '🏋️', color: GROUP_COLORS.leisure, group: 'leisure' },
  { id: 'beach', label: 'Beach', labelAr: 'شاطئ', icon: '🏖️', color: GROUP_COLORS.leisure, group: 'leisure' },
  { id: 'cinema', label: 'Cinema', labelAr: 'سينما', icon: '🎬', color: GROUP_COLORS.leisure, group: 'leisure' },

  // Services - slate
  { id: 'gas_station', label: 'Gas Station', labelAr: 'محطة وقود', icon: '⛽', color: GROUP_COLORS.services, group: 'services' },
  { id: 'mosque', label: 'Mosque', labelAr: 'مسجد', icon: '🕌', color: GROUP_COLORS.services, group: 'services' },
  { id: 'church', label: 'Church', labelAr: 'كنيسة', icon: '⛪', color: GROUP_COLORS.services, group: 'services' },
  { id: 'police', label: 'Police', labelAr: 'شرطة', icon: '👮', color: GROUP_COLORS.services, group: 'services' },
  { id: 'fire_station', label: 'Fire Station', labelAr: 'إطفاء', icon: '🚒', color: GROUP_COLORS.services, group: 'services' },
  { id: 'post_office', label: 'Post Office', labelAr: 'بريد', icon: '📮', color: GROUP_COLORS.services, group: 'services' },
  { id: 'embassy', label: 'Embassy', labelAr: 'سفارة', icon: '🏛️', color: GROUP_COLORS.services, group: 'services' },
]

// Group categories for UI
export const POI_GROUPS = [
  { id: 'healthcare', label: 'Healthcare', labelAr: 'الرعاية الصحية' },
  { id: 'education', label: 'Education', labelAr: 'التعليم' },
  { id: 'shopping', label: 'Shopping', labelAr: 'التسوق' },
  { id: 'dining', label: 'Dining', labelAr: 'المطاعم' },
  { id: 'finance', label: 'Finance', labelAr: 'المالية' },
  { id: 'leisure', label: 'Leisure', labelAr: 'الترفيه' },
  { id: 'services', label: 'Services', labelAr: 'الخدمات' },
]

// ============================================================================
// POI Cache Manager - localStorage based caching
// ============================================================================

const CACHE_KEY = 'dubai_pois_cache'
const CACHE_TTL = 60 * 60 * 1000 // 1 hour

interface CachedData {
  timestamp: number
  etag: string
  pois: Poi[]
}

function getCachedPois(): CachedData | null {
  try {
    const cached = localStorage.getItem(CACHE_KEY)
    if (!cached) return null

    const data: CachedData = JSON.parse(cached)
    const age = Date.now() - data.timestamp

    // Return cache if still valid
    if (age < CACHE_TTL) {
      return data
    }
    return data // Return stale data, will be refreshed in background
  } catch {
    return null
  }
}

function setCachedPois(pois: Poi[], etag: string): void {
  try {
    const data: CachedData = {
      timestamp: Date.now(),
      etag,
      pois
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify(data))
  } catch (e) {
    console.warn('Failed to cache POIs:', e)
  }
}

// Global state for shared POI data across components
let globalPois: Poi[] = []
let globalLoading = false
let globalError: string | null = null
let loadPromise: Promise<void> | null = null
const listeners: Set<() => void> = new Set()

function notifyListeners() {
  listeners.forEach(fn => fn())
}

async function loadAllPois(force = false): Promise<void> {
  // Return existing promise if already loading
  if (loadPromise && !force) return loadPromise

  const cached = getCachedPois()

  // Use cache immediately while loading fresh data
  if (cached?.pois.length) {
    globalPois = cached.pois
    notifyListeners()
  }

  globalLoading = true
  notifyListeners()

  loadPromise = (async () => {
    try {
      const headers: HeadersInit = {}
      if (cached?.etag) {
        headers['If-None-Match'] = cached.etag
      }

      const response = await fetch(`${API_BASE_URL}/api/dubai-pois/all`, { headers })

      if (response.status === 304) {
        // Cache still valid
        globalLoading = false
        notifyListeners()
        return
      }

      if (!response.ok) throw new Error('Failed to fetch POIs')

      const data = await response.json()
      const etag = response.headers.get('etag') || ''

      globalPois = data.pois || []
      globalError = null
      setCachedPois(globalPois, etag)

      console.log(`[POI] Loaded ${globalPois.length} POIs`)
    } catch (err) {
      globalError = err instanceof Error ? err.message : 'Unknown error'
      // Keep cached data on error
      if (!globalPois.length && cached?.pois.length) {
        globalPois = cached.pois
      }
    } finally {
      globalLoading = false
      loadPromise = null
      notifyListeners()
    }
  })()

  return loadPromise
}

// ============================================================================
// useDubaiPois Hook - with instant toggle support
// ============================================================================

interface UseDubaiPoisOptions {
  bounds?: { minLat: number; minLng: number; maxLat: number; maxLng: number }
  enabledCategories?: PoiCategory[]
  enabled?: boolean
}

export function useDubaiPois({ bounds, enabledCategories, enabled = true }: UseDubaiPoisOptions) {
  const [, forceUpdate] = useState({})

  // Subscribe to global state changes
  useEffect(() => {
    const listener = () => forceUpdate({})
    listeners.add(listener)

    // Load POIs on first mount
    if (!globalPois.length && !globalLoading) {
      loadAllPois()
    }

    return () => { listeners.delete(listener) }
  }, [])

  // Filter POIs by bounds and categories (instant, no network)
  const filteredPois = useMemo(() => {
    if (!enabled || !enabledCategories?.length || !globalPois.length) {
      return []
    }

    const categorySet = new Set(enabledCategories)

    return globalPois.filter(poi => {
      // Filter by category
      if (!categorySet.has(poi.category as PoiCategory)) return false

      // Filter by bounds if provided
      if (bounds) {
        if (poi.lat < bounds.minLat || poi.lat > bounds.maxLat) return false
        if (poi.lng < bounds.minLng || poi.lng > bounds.maxLng) return false
      }

      return true
    })
  }, [globalPois, bounds, enabledCategories, enabled])

  return {
    pois: filteredPois,
    loading: globalLoading,
    error: globalError,
    totalCount: globalPois.length
  }
}

// ============================================================================
// Additional exports for cache management
// ============================================================================

export function refreshPoiCache(): Promise<void> {
  return loadAllPois(true)
}

export function getPoiCacheInfo(): { count: number; age: number | null } {
  const cached = getCachedPois()
  return {
    count: globalPois.length,
    age: cached ? Date.now() - cached.timestamp : null
  }
}

// Helper to get category info
export function getCategoryInfo(category: PoiCategory): PoiCategoryInfo | undefined {
  return POI_CATEGORIES.find(c => c.id === category)
}

// Fetch full details (incl. photo/description/KHDA) for a single POI.
// Cached in-memory so re-opening the same POI is instant.
const detailsCache = new Map<string, PoiDetails>()

export async function fetchPoiDetails(id: string): Promise<PoiDetails | null> {
  const cached = detailsCache.get(id)
  if (cached) return cached
  try {
    const res = await fetch(`${API_BASE_URL}/api/dubai-pois/${id}/details`)
    if (!res.ok) return null
    const data = await res.json()
    if (data?.poi) {
      detailsCache.set(id, data.poi)
      return data.poi
    }
    return null
  } catch {
    return null
  }
}
