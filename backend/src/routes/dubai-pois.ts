/**
 * Dubai POI API routes
 * - Optimized for frontend performance with caching
 * - Supports bulk loading and real-time toggle
 */

import { Router, Request, Response } from 'express'
import pool from '../db/pool'

const router = Router()

// Valid POI categories
const VALID_CATEGORIES = [
  'hospital', 'clinic', 'school', 'university', 'metro_station', 'bus_station',
  'mall', 'supermarket', 'bank', 'atm', 'gas_station', 'hotel', 'mosque',
  'church', 'park', 'gym', 'restaurant', 'cafe', 'pharmacy', 'police',
  'fire_station', 'post_office', 'embassy', 'beach', 'cinema', 'other'
]

// In-memory cache for bulk POI data
let cachedPois: any[] | null = null
let cacheTimestamp: number = 0
const CACHE_TTL = 60 * 60 * 1000 // 1 hour

// ETag for client-side caching
let currentETag: string = ''

async function loadAllPois(): Promise<any[]> {
  const now = Date.now()
  if (cachedPois && (now - cacheTimestamp) < CACHE_TTL) {
    return cachedPois
  }

  const result = await pool.query(`
    SELECT
      id,
      name,
      category,
      subcategory,
      ST_X(location::geometry) as lng,
      ST_Y(location::geometry) as lat
    FROM dubai_pois
    ORDER BY category, name
  `)

  cachedPois = result.rows
  cacheTimestamp = now
  currentETag = `"pois-${now}"`

  console.log(`[POI Cache] Loaded ${cachedPois.length} POIs`)
  return cachedPois
}

/**
 * GET /api/dubai-pois
 * Get POIs within map bounds, optionally filtered by categories
 *
 * Query params:
 *   - minLat, minLng, maxLat, maxLng: Bounding box (required)
 *   - categories: Comma-separated list of categories (optional)
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { minLat, minLng, maxLat, maxLng, categories } = req.query

    // Validate bounds
    if (!minLat || !minLng || !maxLat || !maxLng) {
      res.status(400).json({ error: 'Missing bounding box parameters' })
      return
    }

    const bounds = {
      minLat: parseFloat(minLat as string),
      minLng: parseFloat(minLng as string),
      maxLat: parseFloat(maxLat as string),
      maxLng: parseFloat(maxLng as string)
    }

    // Parse categories filter
    let categoryFilter: string[] | null = null
    if (categories) {
      categoryFilter = (categories as string)
        .split(',')
        .map(c => c.trim().toLowerCase())
        .filter(c => VALID_CATEGORIES.includes(c))
    }

    // Build query
    let query = `
      SELECT
        id,
        name,
        name_ar,
        category,
        subcategory,
        ST_X(location::geometry) as lng,
        ST_Y(location::geometry) as lat,
        address,
        phone,
        website
      FROM dubai_pois
      WHERE ST_Within(
          location::geometry,
          ST_MakeEnvelope($1, $2, $3, $4, 4326)
        )
    `
    const params: any[] = [bounds.minLng, bounds.minLat, bounds.maxLng, bounds.maxLat]

    if (categoryFilter && categoryFilter.length > 0) {
      query += ` AND category = ANY($5::poi_category[])`
      params.push(categoryFilter)
    }

    query += ` ORDER BY category, name LIMIT 1000`

    const result = await pool.query(query, params)

    res.json({
      count: result.rows.length,
      pois: result.rows
    })
  } catch (error) {
    console.error('Error fetching POIs:', error)
    res.status(500).json({ error: 'Failed to fetch POIs' })
  }
})

/**
 * GET /api/dubai-pois/all
 * Get ALL POIs for client-side caching (compressed, with HTTP caching)
 * Frontend should cache this and filter client-side for instant toggle
 */
router.get('/all', async (req: Request, res: Response) => {
  try {
    // Check If-None-Match for 304 response
    const clientETag = req.headers['if-none-match']
    if (clientETag && clientETag === currentETag && cachedPois) {
      res.status(304).end()
      return
    }

    const pois = await loadAllPois()

    // Set strong caching headers
    res.set({
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
      'ETag': currentETag,
      'Last-Modified': new Date(cacheTimestamp).toUTCString()
    })

    res.json({
      count: pois.length,
      timestamp: cacheTimestamp,
      pois
    })
  } catch (error) {
    console.error('Error fetching all POIs:', error)
    res.status(500).json({ error: 'Failed to fetch POIs' })
  }
})

/**
 * GET /api/dubai-pois/categories
 * Get available POI categories with counts (cached)
 */
router.get('/categories', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT
        category,
        COUNT(*)::int as count
      FROM dubai_pois
      GROUP BY category
      ORDER BY count DESC
    `)

    // Cache for 1 hour
    res.set('Cache-Control', 'public, max-age=3600')

    res.json({
      categories: result.rows
    })
  } catch (error) {
    console.error('Error fetching POI categories:', error)
    res.status(500).json({ error: 'Failed to fetch categories' })
  }
})

/**
 * POST /api/dubai-pois/refresh-cache
 * Force refresh the server-side POI cache
 */
router.post('/refresh-cache', async (_req: Request, res: Response) => {
  try {
    cachedPois = null
    cacheTimestamp = 0
    await loadAllPois()

    res.json({
      success: true,
      count: cachedPois?.length || 0,
      timestamp: cacheTimestamp
    })
  } catch (error) {
    console.error('Error refreshing POI cache:', error)
    res.status(500).json({ error: 'Failed to refresh cache' })
  }
})

/**
 * GET /api/dubai-pois/near
 * Get POIs near a specific point
 *
 * Query params:
 *   - lat, lng: Center point (required)
 *   - radius: Radius in meters (default 1000)
 *   - categories: Comma-separated list of categories (optional)
 */
router.get('/near', async (req: Request, res: Response) => {
  try {
    const { lat, lng, radius = '1000', categories } = req.query

    if (!lat || !lng) {
      res.status(400).json({ error: 'Missing lat/lng parameters' })
      return
    }

    const point = {
      lat: parseFloat(lat as string),
      lng: parseFloat(lng as string)
    }
    const radiusMeters = Math.min(parseInt(radius as string), 10000) // Max 10km

    // Parse categories
    let categoryArray: string[] | null = null
    if (categories) {
      categoryArray = (categories as string)
        .split(',')
        .map(c => c.trim().toLowerCase())
        .filter(c => VALID_CATEGORIES.includes(c))
    }

    const result = await pool.query(
      `SELECT * FROM get_pois_near_point($1, $2, $3, $4::poi_category[])`,
      [point.lng, point.lat, radiusMeters, categoryArray]
    )

    res.json({
      center: point,
      radius: radiusMeters,
      count: result.rows.length,
      pois: result.rows
    })
  } catch (error) {
    console.error('Error fetching nearby POIs:', error)
    res.status(500).json({ error: 'Failed to fetch nearby POIs' })
  }
})

export default router
