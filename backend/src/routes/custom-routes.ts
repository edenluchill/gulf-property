import { Router, Request, Response } from 'express'
import pool from '../db/pool'

const router = Router()

// ============================================================================
// Types
// ============================================================================

interface CustomStop {
  id: string
  route_id: string
  name: string
  name_ar?: string
  description?: string
  color?: string
  location: { lat: number; lng: number }
  position_on_route?: number
  images?: string[]
  display_order: number
  is_active: boolean
}

interface DbRoute {
  id: string
  name: string
  name_ar?: string
  description?: string
  color: string
  line_width: number
  route_type: string
  geometry: GeoJSON.LineString
  images?: string[]
  display_order: number
  is_active: boolean
}

interface DbStop extends CustomStop {
  route_color?: string
  route_type?: string
}

// ============================================================================
// Routes CRUD
// ============================================================================

// Get all routes with their stops
router.get('/', async (_req: Request, res: Response) => {
  try {
    const routesResult = await pool.query(`
      SELECT * FROM custom_routes
      WHERE is_active = true
      ORDER BY display_order, name
    `)

    const stopsResult = await pool.query(`
      SELECT * FROM custom_stops
      WHERE is_active = true
      ORDER BY route_id, display_order, position_on_route
    `)

    // Group stops by route
    const stopsByRoute: Record<string, CustomStop[]> = {}
    for (const stop of stopsResult.rows) {
      if (!stopsByRoute[stop.route_id]) {
        stopsByRoute[stop.route_id] = []
      }
      stopsByRoute[stop.route_id].push(stop)
    }

    // Attach stops to routes
    const routes = routesResult.rows.map((route: DbRoute) => ({
      ...route,
      stops: stopsByRoute[route.id] || []
    }))

    res.json(routes)
  } catch (error) {
    console.error('Error fetching custom routes:', error)
    res.status(500).json({ error: 'Failed to fetch routes' })
  }
})

// Get single route with stops
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params

    const routeResult = await pool.query(
      'SELECT * FROM custom_routes WHERE id = $1',
      [id]
    )

    if (routeResult.rows.length === 0) {
      return res.status(404).json({ error: 'Route not found' })
    }

    const stopsResult = await pool.query(
      'SELECT * FROM custom_stops WHERE route_id = $1 ORDER BY display_order, position_on_route',
      [id]
    )

    res.json({
      ...routeResult.rows[0],
      stops: stopsResult.rows
    })
  } catch (error) {
    console.error('Error fetching route:', error)
    res.status(500).json({ error: 'Failed to fetch route' })
  }
})

// Create route
router.post('/', async (req: Request, res: Response) => {
  try {
    const {
      name,
      name_ar,
      description,
      color = '#3b82f6',
      line_width = 3,
      route_type = 'metro',
      geometry,
      images = [],
      display_order = 0
    } = req.body

    if (!name || !geometry) {
      return res.status(400).json({ error: 'Name and geometry are required' })
    }

    const result = await pool.query(
      `INSERT INTO custom_routes
       (name, name_ar, description, color, line_width, route_type, geometry, images, display_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [name, name_ar, description, color, line_width, route_type, geometry, images, display_order]
    )

    res.status(201).json(result.rows[0])
  } catch (error) {
    console.error('Error creating route:', error)
    res.status(500).json({ error: 'Failed to create route' })
  }
})

// Update route
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const {
      name,
      name_ar,
      description,
      color,
      line_width,
      route_type,
      geometry,
      images,
      display_order,
      is_active
    } = req.body

    const result = await pool.query(
      `UPDATE custom_routes SET
        name = COALESCE($1, name),
        name_ar = COALESCE($2, name_ar),
        description = COALESCE($3, description),
        color = COALESCE($4, color),
        line_width = COALESCE($5, line_width),
        route_type = COALESCE($6, route_type),
        geometry = COALESCE($7, geometry),
        images = COALESCE($8, images),
        display_order = COALESCE($9, display_order),
        is_active = COALESCE($10, is_active)
       WHERE id = $11
       RETURNING *`,
      [name, name_ar, description, color, line_width, route_type, geometry, images, display_order, is_active, id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Route not found' })
    }

    res.json(result.rows[0])
  } catch (error) {
    console.error('Error updating route:', error)
    res.status(500).json({ error: 'Failed to update route' })
  }
})

// Delete route (and its stops via CASCADE)
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params

    const result = await pool.query(
      'DELETE FROM custom_routes WHERE id = $1 RETURNING id',
      [id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Route not found' })
    }

    res.json({ success: true, id })
  } catch (error) {
    console.error('Error deleting route:', error)
    res.status(500).json({ error: 'Failed to delete route' })
  }
})

// ============================================================================
// Stops CRUD
// ============================================================================

// Create stop
router.post('/:routeId/stops', async (req: Request, res: Response) => {
  try {
    const { routeId } = req.params
    const {
      name,
      name_ar,
      description,
      color,
      location,
      position_on_route,
      images = [],
      display_order = 0
    } = req.body

    if (!name || !location) {
      return res.status(400).json({ error: 'Name and location are required' })
    }

    const result = await pool.query(
      `INSERT INTO custom_stops
       (route_id, name, name_ar, description, color, location, position_on_route, images, display_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [routeId, name, name_ar, description, color, location, position_on_route, images, display_order]
    )

    res.status(201).json(result.rows[0])
  } catch (error) {
    console.error('Error creating stop:', error)
    res.status(500).json({ error: 'Failed to create stop' })
  }
})

// Update stop
router.put('/stops/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const {
      name,
      name_ar,
      description,
      color,
      location,
      position_on_route,
      images,
      display_order,
      is_active
    } = req.body

    const result = await pool.query(
      `UPDATE custom_stops SET
        name = COALESCE($1, name),
        name_ar = COALESCE($2, name_ar),
        description = COALESCE($3, description),
        color = COALESCE($4, color),
        location = COALESCE($5, location),
        position_on_route = COALESCE($6, position_on_route),
        images = COALESCE($7, images),
        display_order = COALESCE($8, display_order),
        is_active = COALESCE($9, is_active)
       WHERE id = $10
       RETURNING *`,
      [name, name_ar, description, color, location, position_on_route, images, display_order, is_active, id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Stop not found' })
    }

    res.json(result.rows[0])
  } catch (error) {
    console.error('Error updating stop:', error)
    res.status(500).json({ error: 'Failed to update stop' })
  }
})

// Delete stop
router.delete('/stops/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params

    const result = await pool.query(
      'DELETE FROM custom_stops WHERE id = $1 RETURNING id',
      [id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Stop not found' })
    }

    res.json({ success: true, id })
  } catch (error) {
    console.error('Error deleting stop:', error)
    res.status(500).json({ error: 'Failed to delete stop' })
  }
})

// Batch update stops (for reordering or bulk position updates)
router.post('/:routeId/stops/batch', async (req: Request, res: Response) => {
  try {
    const { routeId } = req.params
    const { stops } = req.body  // Array of {id, location, position_on_route, display_order}

    if (!Array.isArray(stops)) {
      return res.status(400).json({ error: 'Stops array is required' })
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      for (const stop of stops) {
        await client.query(
          `UPDATE custom_stops SET
            location = COALESCE($1, location),
            position_on_route = COALESCE($2, position_on_route),
            display_order = COALESCE($3, display_order)
           WHERE id = $4 AND route_id = $5`,
          [stop.location, stop.position_on_route, stop.display_order, stop.id, routeId]
        )
      }

      await client.query('COMMIT')
      res.json({ success: true })
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  } catch (error) {
    console.error('Error batch updating stops:', error)
    res.status(500).json({ error: 'Failed to batch update stops' })
  }
})

// ============================================================================
// GeoJSON Export (for map display - matches existing transport format)
// ============================================================================

router.get('/geojson/all', async (_req: Request, res: Response) => {
  try {
    const routesResult = await pool.query(`
      SELECT * FROM custom_routes
      WHERE is_active = true
      ORDER BY display_order
    `)

    const stopsResult = await pool.query(`
      SELECT s.*, r.color as route_color, r.route_type
      FROM custom_stops s
      JOIN custom_routes r ON s.route_id = r.id
      WHERE s.is_active = true AND r.is_active = true
      ORDER BY s.route_id, s.display_order
    `)

    // Build GeoJSON features
    const features: GeoJSON.Feature[] = []

    // Add route lines
    for (const route of routesResult.rows as DbRoute[]) {
      features.push({
        type: 'Feature',
        properties: {
          id: route.id,
          name: route.name,
          nameAr: route.name_ar,
          category: `${route.route_type}_lines`,  // e.g. metro_lines, tram_lines
          line: route.route_type,  // For color matching
          color: route.color,
          description: route.description,
          images: route.images
        },
        geometry: route.geometry
      })
    }

    // Add stops as points
    for (const stop of stopsResult.rows as DbStop[]) {
      features.push({
        type: 'Feature',
        properties: {
          id: stop.id,
          name: stop.name,
          nameAr: stop.name_ar,
          category: `${stop.route_type}_stations`,  // e.g. metro_stations
          line: stop.route_type,
          color: stop.color || stop.route_color,
          description: stop.description,
          images: stop.images,
          routeId: stop.route_id
        },
        geometry: {
          type: 'Point',
          coordinates: [stop.location.lng, stop.location.lat]
        }
      })
    }

    res.json({
      type: 'FeatureCollection',
      features
    })
  } catch (error) {
    console.error('Error generating GeoJSON:', error)
    res.status(500).json({ error: 'Failed to generate GeoJSON' })
  }
})

export default router
