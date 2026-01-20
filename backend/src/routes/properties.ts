import { Router, Request, Response } from 'express';
import { query, validationResult } from 'express-validator';
import pool from '../db/pool';
import { OffPlanProperty } from '../types';

const router = Router();

/**
 * Convert database row to OffPlanProperty interface
 */
function dbRowToProperty(row: any): OffPlanProperty {
  return {
    id: row.id,
    building_id: row.building_id,
    building_name: row.building_name,
    project_name: row.project_name,
    building_description: row.building_description,
    developer: row.developer,
    developer_id: row.developer_id,
    developer_logo_url: row.developer_logo_url,
    location: {
      lat: row.latitude,
      lng: row.longitude,
    },
    area_name: row.area_name,
    area_id: row.area_id,
    dld_location_id: row.dld_location_id,
    min_bedrooms: row.min_bedrooms,
    max_bedrooms: row.max_bedrooms,
    beds_description: row.beds_description,
    min_size: row.min_size,
    max_size: row.max_size,
    starting_price: row.starting_price ? parseFloat(row.starting_price) : undefined,
    median_price_sqft: row.median_price_sqft ? parseFloat(row.median_price_sqft) : undefined,
    median_price_per_unit: row.median_price_per_unit ? parseFloat(row.median_price_per_unit) : undefined,
    median_rent_per_unit: row.median_rent_per_unit ? parseFloat(row.median_rent_per_unit) : undefined,
    launch_date: row.launch_date,
    completion_date: row.completion_date,
    completion_percent: row.completion_percent,
    status: row.status,
    unit_count: row.unit_count,
    building_unit_count: row.building_unit_count,
    sales_volume: row.sales_volume,
    prop_sales_volume: row.prop_sales_volume,
    images: row.images || [],
    logo_url: row.logo_url,
    brochure_url: row.brochure_url,
    amenities: row.amenities || [],
    display_as: row.display_as,
    verified: row.verified,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * GET /api/properties/clusters
 * Returns clustered properties for map view (optimized, only returns IDs)
 * Uses PostGIS ST_ClusterKMeans for server-side clustering
 * Max 50 clusters regardless of bounds size (reduced for better map visibility)
 */
router.get('/clusters', [
  query('zoom').optional().isInt(),
  query('minLng').optional().isFloat(),
  query('minLat').optional().isFloat(),
  query('maxLng').optional().isFloat(),
  query('maxLat').optional().isFloat(),
  query('minPrice').optional().isNumeric(),
  query('maxPrice').optional().isNumeric(),
  query('minBedrooms').optional().isInt(),
  query('maxBedrooms').optional().isInt(),
  query('minSize').optional().isNumeric(),
  query('maxSize').optional().isNumeric(),
  query('minPriceSqft').optional().isNumeric(),
  query('maxPriceSqft').optional().isNumeric(),
  query('minCompletionPercent').optional().isInt(),
  query('maxCompletionPercent').optional().isInt(),
  query('developer').optional().isString(),
  query('project').optional().isString(),
  query('area').optional().isString(),
  query('status').optional().isIn(['upcoming', 'under-construction', 'completed']),
], async (req: Request, res: Response) => {
  try {
    const { 
      zoom = 11, 
      minLng, minLat, maxLng, maxLat,
      minPrice, maxPrice,
      minBedrooms, maxBedrooms,
      minSize, maxSize,
      minPriceSqft, maxPriceSqft,
      minCompletionPercent, maxCompletionPercent,
      developer, project, area, status
    } = req.query;
    
    // Always return max 50 clusters (reduced for better visibility)
    const clusterCount = 50;
    
    let queryText = `
      WITH clustered AS (
        SELECT 
          id,
          starting_price,
          min_bedrooms,
          max_bedrooms,
          ST_Y(location::geometry) as latitude,
          ST_X(location::geometry) as longitude,
          ST_ClusterKMeans(location::geometry, $1) OVER() as cluster_id
        FROM off_plan_properties
        WHERE verified = true AND location IS NOT NULL
    `;
    
    const queryParams: any[] = [clusterCount];
    let paramCount = 2;
    
    // Bounding box filter
    if (minLng && minLat && maxLng && maxLat) {
      queryText += ` AND ST_Intersects(
        location,
        ST_MakeEnvelope($${paramCount}, $${paramCount + 1}, $${paramCount + 2}, $${paramCount + 3}, 4326)::geography
      )`;
      queryParams.push(minLng, minLat, maxLng, maxLat);
      paramCount += 4;
    }
    
    // Apply all filters
    if (minPrice) {
      queryText += ` AND starting_price >= $${paramCount}`;
      queryParams.push(minPrice);
      paramCount++;
    }
    if (maxPrice) {
      queryText += ` AND starting_price <= $${paramCount}`;
      queryParams.push(maxPrice);
      paramCount++;
    }
    if (minBedrooms) {
      queryText += ` AND max_bedrooms >= $${paramCount}`;
      queryParams.push(minBedrooms);
      paramCount++;
    }
    if (maxBedrooms) {
      queryText += ` AND min_bedrooms <= $${paramCount}`;
      queryParams.push(maxBedrooms);
      paramCount++;
    }
    if (minSize) {
      queryText += ` AND (max_size >= $${paramCount} OR max_size IS NULL)`;
      queryParams.push(minSize);
      paramCount++;
    }
    if (maxSize) {
      queryText += ` AND (min_size <= $${paramCount} OR min_size IS NULL)`;
      queryParams.push(maxSize);
      paramCount++;
    }
    if (minPriceSqft) {
      queryText += ` AND median_price_sqft >= $${paramCount}`;
      queryParams.push(minPriceSqft);
      paramCount++;
    }
    if (maxPriceSqft) {
      queryText += ` AND median_price_sqft <= $${paramCount}`;
      queryParams.push(maxPriceSqft);
      paramCount++;
    }
    if (minCompletionPercent !== undefined) {
      queryText += ` AND completion_percent >= $${paramCount}`;
      queryParams.push(minCompletionPercent);
      paramCount++;
    }
    if (maxCompletionPercent !== undefined) {
      queryText += ` AND completion_percent <= $${paramCount}`;
      queryParams.push(maxCompletionPercent);
      paramCount++;
    }
    if (developer) {
      queryText += ` AND developer = $${paramCount}`;
      queryParams.push(developer);
      paramCount++;
    }
    if (project) {
      queryText += ` AND project_name = $${paramCount}`;
      queryParams.push(project);
      paramCount++;
    }
    if (area) {
      queryText += ` AND area_name = $${paramCount}`;
      queryParams.push(area);
      paramCount++;
    }
    if (status) {
      queryText += ` AND status = $${paramCount}`;
      queryParams.push(status);
      paramCount++;
    }
    
    queryText += `
      )
      SELECT 
        cluster_id,
        COUNT(*) as count,
        MIN(starting_price) as min_price,
        MAX(starting_price) as max_price,
        AVG(starting_price) as avg_price,
        MIN(min_bedrooms) as min_beds,
        MAX(max_bedrooms) as max_beds,
        ST_Y(ST_Centroid(ST_Collect(ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)))) as center_lat,
        ST_X(ST_Centroid(ST_Collect(ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)))) as center_lng,
        ARRAY_AGG(id) as property_ids
      FROM clustered
      GROUP BY cluster_id
      HAVING COUNT(*) > 0
      ORDER BY count DESC
      LIMIT 50
    `;
    
    const result = await pool.query(queryText, queryParams);
    
    return res.json({
      success: true,
      count: result.rows.length,
      zoom: Number(zoom),
      data: result.rows.map(row => ({
        cluster_id: row.cluster_id,
        count: parseInt(row.count),
        center: {
          lat: parseFloat(row.center_lat),
          lng: parseFloat(row.center_lng)
        },
        price_range: {
          min: row.min_price ? parseFloat(row.min_price) : null,
          max: row.max_price ? parseFloat(row.max_price) : null,
          avg: row.avg_price ? parseFloat(row.avg_price) : null,
        },
        bed_range: {
          min: row.min_beds || 0,
          max: row.max_beds || 0,
        },
        property_ids: row.property_ids || []
      }))
    });
  } catch (error) {
    console.error('Error fetching property clusters:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch property clusters',
    });
  }
});

/**
 * POST /api/properties/batch
 * Get multiple properties by IDs (max 10 at a time)
 */
router.post('/batch', async (req: Request, res: Response) => {
  try {
    const { ids } = req.body;
    
    if (!ids || !Array.isArray(ids)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request: ids array is required'
      });
    }
    
    // Limit to 10 properties at a time
    const limitedIds = ids.slice(0, 10);
    
    const result = await pool.query(
      `
      SELECT 
        id, building_id, building_name, project_name, building_description,
        developer, developer_id, developer_logo_url,
        ST_Y(location::geometry) as latitude,
        ST_X(location::geometry) as longitude,
        area_name, area_id, dld_location_id,
        min_bedrooms, max_bedrooms, beds_description,
        min_size, max_size,
        starting_price, median_price_sqft, median_price_per_unit, median_rent_per_unit,
        launch_date, completion_date, completion_percent, status,
        unit_count, building_unit_count,
        sales_volume, prop_sales_volume,
        images, logo_url, brochure_url, amenities,
        display_as, verified, created_at, updated_at
      FROM off_plan_properties
      WHERE id = ANY($1) AND verified = true
      ORDER BY starting_price DESC
      `,
      [limitedIds]
    );
    
    return res.json({
      success: true,
      count: result.rows.length,
      data: result.rows.map(dbRowToProperty)
    });
  } catch (error) {
    console.error('Error fetching properties batch:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch properties'
    });
  }
});

/**
 * GET /api/properties/map
 * High-performance map search endpoint
 * Returns properties within the specified bounding box with optional filters
 */
router.get('/map', [
  query('minLng').optional().isFloat(),
  query('minLat').optional().isFloat(),
  query('maxLng').optional().isFloat(),
  query('maxLat').optional().isFloat(),
  query('minPrice').optional().isNumeric(),
  query('maxPrice').optional().isNumeric(),
  query('minBedrooms').optional().isInt(),
  query('maxBedrooms').optional().isInt(),
  query('minSize').optional().isNumeric(),
  query('maxSize').optional().isNumeric(),
  query('minPriceSqft').optional().isNumeric(),
  query('maxPriceSqft').optional().isNumeric(),
  query('minCompletionPercent').optional().isInt(),
  query('maxCompletionPercent').optional().isInt(),
  query('developer').optional().isString(),
  query('project').optional().isString(),
  query('area').optional().isString(),
  query('status').optional().isIn(['upcoming', 'under-construction', 'completed']),
], async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const {
      minLng,
      minLat,
      maxLng,
      maxLat,
      minPrice,
      maxPrice,
      minBedrooms,
      maxBedrooms,
      minSize,
      maxSize,
      minPriceSqft,
      maxPriceSqft,
      minCompletionPercent,
      maxCompletionPercent,
      developer,
      project,
      area,
      status,
    } = req.query;

    let queryText = `
      SELECT 
        id, building_id, building_name, project_name, developer, area_name,
        ST_Y(location::geometry) as latitude,
        ST_X(location::geometry) as longitude,
        starting_price, min_bedrooms, max_bedrooms,
        completion_date, completion_percent, status,
        images, amenities, verified
      FROM off_plan_properties
      WHERE verified = true AND location IS NOT NULL
    `;

    const queryParams: any[] = [];
    let paramCount = 1;

    // Bounding box filter (critical for map performance)
    if (minLng && minLat && maxLng && maxLat) {
      queryText += ` AND ST_Intersects(
        location,
        ST_MakeEnvelope($${paramCount}, $${paramCount + 1}, $${paramCount + 2}, $${paramCount + 3}, 4326)::geography
      )`;
      queryParams.push(minLng, minLat, maxLng, maxLat);
      paramCount += 4;
    }

    // Price filters
    if (minPrice) {
      queryText += ` AND starting_price >= $${paramCount}`;
      queryParams.push(minPrice);
      paramCount++;
    }
    if (maxPrice) {
      queryText += ` AND starting_price <= $${paramCount}`;
      queryParams.push(maxPrice);
      paramCount++;
    }

    // Bedroom filters
    if (minBedrooms) {
      queryText += ` AND max_bedrooms >= $${paramCount}`;
      queryParams.push(minBedrooms);
      paramCount++;
    }
    if (maxBedrooms) {
      queryText += ` AND min_bedrooms <= $${paramCount}`;
      queryParams.push(maxBedrooms);
      paramCount++;
    }

    // Size filters
    if (minSize) {
      queryText += ` AND (max_size >= $${paramCount} OR max_size IS NULL)`;
      queryParams.push(minSize);
      paramCount++;
    }
    if (maxSize) {
      queryText += ` AND (min_size <= $${paramCount} OR min_size IS NULL)`;
      queryParams.push(maxSize);
      paramCount++;
    }

    // Price per sqft filters
    if (minPriceSqft) {
      queryText += ` AND median_price_sqft >= $${paramCount}`;
      queryParams.push(minPriceSqft);
      paramCount++;
    }
    if (maxPriceSqft) {
      queryText += ` AND median_price_sqft <= $${paramCount}`;
      queryParams.push(maxPriceSqft);
      paramCount++;
    }

    // Completion percent filters
    if (minCompletionPercent) {
      queryText += ` AND completion_percent >= $${paramCount}`;
      queryParams.push(minCompletionPercent);
      paramCount++;
    }
    if (maxCompletionPercent) {
      queryText += ` AND completion_percent <= $${paramCount}`;
      queryParams.push(maxCompletionPercent);
      paramCount++;
    }

    // Developer filter
    if (developer) {
      queryText += ` AND developer = $${paramCount}`;
      queryParams.push(developer);
      paramCount++;
    }

    // Project filter
    if (project) {
      queryText += ` AND project_name = $${paramCount}`;
      queryParams.push(project);
      paramCount++;
    }

    // Area filter
    if (area) {
      queryText += ` AND area_name = $${paramCount}`;
      queryParams.push(area);
      paramCount++;
    }

    // Status filter
    if (status) {
      queryText += ` AND status = $${paramCount}`;
      queryParams.push(status);
      paramCount++;
    }

    // Limit results for performance (can be paginated)
    queryText += ' LIMIT 500';

    const result = await pool.query(queryText, queryParams);

    return res.json({
      success: true,
      count: result.rows.length,
      data: result.rows.map(dbRowToProperty),
    });
  } catch (error) {
    console.error('Error fetching properties for map:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch properties',
    });
  }
});

/**
 * GET /api/properties
 * General property search with full filtering
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const {
      developer,
      project,
      area,
      minPrice,
      maxPrice,
      minBedrooms,
      maxBedrooms,
      minSize,
      maxSize,
      minPriceSqft,
      maxPriceSqft,
      launchDateStart,
      launchDateEnd,
      completionDateStart,
      completionDateEnd,
      minCompletionPercent,
      maxCompletionPercent,
      status,
      searchQuery,
      limit = '50',
      offset = '0',
    } = req.query as any;

    let queryText = `
      SELECT 
        id, building_id, building_name, project_name, building_description,
        developer, developer_id, developer_logo_url,
        ST_Y(location::geometry) as latitude,
        ST_X(location::geometry) as longitude,
        area_name, area_id, dld_location_id,
        min_bedrooms, max_bedrooms, beds_description,
        min_size, max_size,
        starting_price, median_price_sqft, median_price_per_unit, median_rent_per_unit,
        launch_date, completion_date, completion_percent, status,
        unit_count, building_unit_count,
        sales_volume, prop_sales_volume,
        images, logo_url, brochure_url, amenities,
        display_as, verified, created_at, updated_at
      FROM off_plan_properties
      WHERE verified = true
    `;

    const queryParams: any[] = [];
    let paramCount = 1;

    if (developer) {
      queryText += ` AND developer = $${paramCount}`;
      queryParams.push(developer);
      paramCount++;
    }

    if (project) {
      queryText += ` AND project_name = $${paramCount}`;
      queryParams.push(project);
      paramCount++;
    }

    if (area) {
      queryText += ` AND area_name = $${paramCount}`;
      queryParams.push(area);
      paramCount++;
    }

    if (minPrice) {
      queryText += ` AND starting_price >= $${paramCount}`;
      queryParams.push(minPrice);
      paramCount++;
    }

    if (maxPrice) {
      queryText += ` AND starting_price <= $${paramCount}`;
      queryParams.push(maxPrice);
      paramCount++;
    }

    if (minBedrooms) {
      queryText += ` AND max_bedrooms >= $${paramCount}`;
      queryParams.push(minBedrooms);
      paramCount++;
    }

    if (maxBedrooms) {
      queryText += ` AND min_bedrooms <= $${paramCount}`;
      queryParams.push(maxBedrooms);
      paramCount++;
    }

    if (minSize) {
      queryText += ` AND (max_size >= $${paramCount} OR max_size IS NULL)`;
      queryParams.push(minSize);
      paramCount++;
    }

    if (maxSize) {
      queryText += ` AND (min_size <= $${paramCount} OR min_size IS NULL)`;
      queryParams.push(maxSize);
      paramCount++;
    }

    if (minPriceSqft) {
      queryText += ` AND median_price_sqft >= $${paramCount}`;
      queryParams.push(minPriceSqft);
      paramCount++;
    }

    if (maxPriceSqft) {
      queryText += ` AND median_price_sqft <= $${paramCount}`;
      queryParams.push(maxPriceSqft);
      paramCount++;
    }

    if (launchDateStart) {
      queryText += ` AND launch_date >= $${paramCount}`;
      queryParams.push(launchDateStart);
      paramCount++;
    }

    if (launchDateEnd) {
      queryText += ` AND launch_date <= $${paramCount}`;
      queryParams.push(launchDateEnd);
      paramCount++;
    }

    if (completionDateStart) {
      queryText += ` AND completion_date >= $${paramCount}`;
      queryParams.push(completionDateStart);
      paramCount++;
    }

    if (completionDateEnd) {
      queryText += ` AND completion_date <= $${paramCount}`;
      queryParams.push(completionDateEnd);
      paramCount++;
    }

    if (minCompletionPercent !== undefined && minCompletionPercent !== null) {
      queryText += ` AND completion_percent >= $${paramCount}`;
      queryParams.push(minCompletionPercent);
      paramCount++;
    }

    if (maxCompletionPercent !== undefined && maxCompletionPercent !== null) {
      queryText += ` AND completion_percent <= $${paramCount}`;
      queryParams.push(maxCompletionPercent);
      paramCount++;
    }

    if (status) {
      queryText += ` AND status = $${paramCount}`;
      queryParams.push(status);
      paramCount++;
    }

    // Full-text search
    if (searchQuery) {
      queryText += ` AND (
        building_name ILIKE $${paramCount} OR
        project_name ILIKE $${paramCount} OR
        developer ILIKE $${paramCount} OR
        area_name ILIKE $${paramCount}
      )`;
      queryParams.push(`%${searchQuery}%`);
      paramCount++;
    }

    queryText += ` ORDER BY created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    queryParams.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(queryText, queryParams);

    // Get total count for pagination
    let countQuery = `SELECT COUNT(*) FROM off_plan_properties WHERE verified = true`;
    const countResult = await pool.query(countQuery);

    return res.json({
      success: true,
      count: result.rows.length,
      total: parseInt(countResult.rows[0].count),
      data: result.rows.map(dbRowToProperty),
    });
  } catch (error) {
    console.error('Error fetching properties:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch properties',
    });
  }
});

/**
 * GET /api/properties/meta/developers
 * Get unique developers list (optimized with materialized view)
 */
router.get('/meta/developers', async (_req: Request, res: Response) => {
  try {
    // Try to use materialized view first, fallback to direct query
    let result;
    try {
      result = await pool.query(
        `SELECT developer, developer_logo_url, property_count 
         FROM mv_developers 
         ORDER BY developer`
      );
    } catch (mvError) {
      // Fallback to direct query if materialized view doesn't exist
      result = await pool.query(
        `SELECT DISTINCT developer, developer_logo_url 
         FROM off_plan_properties 
         WHERE verified = true AND developer IS NOT NULL
         ORDER BY developer`
      );
    }

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error('Error fetching developers:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch developers',
    });
  }
});

/**
 * GET /api/properties/meta/areas
 * Get unique areas with property counts (optimized with materialized view)
 */
router.get('/meta/areas', async (_req: Request, res: Response) => {
  try {
    // Try to use materialized view first, fallback to direct query
    let result;
    try {
      result = await pool.query(
        `SELECT 
          area_name,
          property_count,
          avg_price,
          min_price,
          max_price
         FROM mv_areas 
         ORDER BY property_count DESC`
      );
    } catch (mvError) {
      // Fallback to direct query if materialized view doesn't exist
      result = await pool.query(
        `SELECT 
          area_name,
          COUNT(*) as property_count,
          AVG(starting_price) as avg_price,
          MIN(starting_price) as min_price,
          MAX(starting_price) as max_price
         FROM off_plan_properties 
         WHERE verified = true AND area_name IS NOT NULL AND starting_price IS NOT NULL
         GROUP BY area_name
         ORDER BY property_count DESC`
      );
    }

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error('Error fetching areas:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch areas',
    });
  }
});

/**
 * GET /api/properties/meta/projects
 * Get unique projects with property counts (optimized with materialized view)
 */
router.get('/meta/projects', async (_req: Request, res: Response) => {
  try {
    // Try to use materialized view first, fallback to direct query
    let result;
    try {
      result = await pool.query(
        `SELECT 
          project_name,
          developer,
          property_count,
          avg_price,
          min_price,
          max_price
         FROM mv_projects 
         ORDER BY property_count DESC 
         LIMIT 1000`  // Limit to top 1000 projects for performance
      );
    } catch (mvError) {
      // Fallback to direct query if materialized view doesn't exist
      result = await pool.query(
        `SELECT 
          project_name,
          developer,
          COUNT(*) as property_count,
          AVG(starting_price) as avg_price,
          MIN(starting_price) as min_price,
          MAX(starting_price) as max_price
         FROM off_plan_properties 
         WHERE verified = true AND project_name IS NOT NULL AND starting_price IS NOT NULL
         GROUP BY project_name, developer
         ORDER BY property_count DESC
         LIMIT 1000`
      );
    }

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error('Error fetching projects:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch projects',
    });
  }
});

/**
 * GET /api/properties/meta/stats
 * Get overall statistics
 */
router.get('/meta/stats', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT 
        COUNT(*) as total_properties,
        COUNT(DISTINCT developer) as total_developers,
        COUNT(DISTINCT area_name) as total_areas,
        AVG(starting_price) as avg_price,
        MIN(starting_price) as min_price,
        MAX(starting_price) as max_price,
        SUM(CASE WHEN status = 'upcoming' THEN 1 ELSE 0 END) as upcoming_count,
        SUM(CASE WHEN status = 'under-construction' THEN 1 ELSE 0 END) as under_construction_count,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_count
       FROM off_plan_properties 
       WHERE verified = true`
    );

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch statistics',
    });
  }
});

/**
 * GET /api/properties/:id
 * Get single property by ID
 * NOTE: This route must be last to avoid matching /meta/* routes
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `
      SELECT 
        id, building_id, building_name, project_name, building_description,
        developer, developer_id, developer_logo_url,
        ST_Y(location::geometry) as latitude,
        ST_X(location::geometry) as longitude,
        area_name, area_id, dld_location_id,
        min_bedrooms, max_bedrooms, beds_description,
        min_size, max_size,
        starting_price, median_price_sqft, median_price_per_unit, median_rent_per_unit,
        launch_date, completion_date, completion_percent, status,
        unit_count, building_unit_count,
        sales_volume, prop_sales_volume,
        images, logo_url, brochure_url, amenities,
        display_as, verified, created_at, updated_at
      FROM off_plan_properties
      WHERE id = $1 AND verified = true
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Property not found',
      });
    }

    return res.json({
      success: true,
      data: dbRowToProperty(result.rows[0]),
    });
  } catch (error) {
    console.error('Error fetching property:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch property',
    });
  }
});

export default router;
