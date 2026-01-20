import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import pool from '../db/pool';

const router = Router();

/**
 * GET /api/dubai/areas
 * Returns all Dubai areas (districts) with polygon boundaries
 * Frontend will render these as colored overlays on the map
 */
router.get('/areas', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT 
        id,
        name,
        name_ar,
        ST_AsGeoJSON(boundary)::json as boundary,
        description,
        description_ar,
        color,
        opacity,
        display_order,
        project_counts,
        average_price,
        sales_volume,
        capital_appreciation,
        rental_yield
      FROM dubai_areas
      WHERE visible = true
      ORDER BY display_order ASC, name ASC
    `);

    const areas = result.rows.map(row => ({
      id: row.id,
      name: row.name,
      nameAr: row.name_ar,
      boundary: row.boundary, // GeoJSON format
      description: row.description,
      descriptionAr: row.description_ar,
      color: row.color,
      opacity: parseFloat(row.opacity),
      displayOrder: row.display_order,
      // Market statistics
      projectCounts: row.project_counts || 0,
      averagePrice: row.average_price ? parseFloat(row.average_price) : null,
      salesVolume: row.sales_volume ? parseFloat(row.sales_volume) : null,
      capitalAppreciation: row.capital_appreciation ? parseFloat(row.capital_appreciation) : null,
      rentalYield: row.rental_yield ? parseFloat(row.rental_yield) : null,
    }));

    res.json(areas);
  } catch (error) {
    console.error('Error fetching Dubai areas:', error);
    res.status(500).json({ error: 'Failed to fetch Dubai areas' });
  }
});

/**
 * GET /api/dubai/landmarks
 * Returns all Dubai landmarks (points of interest)
 * Frontend will render these as markers on the map
 */
router.get('/landmarks', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT 
        id,
        name,
        name_ar,
        ST_Y(location::geometry) as latitude,
        ST_X(location::geometry) as longitude,
        landmark_type,
        icon_name,
        description,
        description_ar,
        year_built,
        website_url,
        image_url,
        color,
        size,
        display_order
      FROM dubai_landmarks
      WHERE visible = true
      ORDER BY display_order ASC, name ASC
    `);

    const landmarks = result.rows.map(row => ({
      id: row.id,
      name: row.name,
      nameAr: row.name_ar,
      location: {
        lat: parseFloat(row.latitude),
        lng: parseFloat(row.longitude),
      },
      landmarkType: row.landmark_type,
      iconName: row.icon_name,
      description: row.description,
      descriptionAr: row.description_ar,
      yearBuilt: row.year_built,
      websiteUrl: row.website_url,
      imageUrl: row.image_url,
      color: row.color,
      size: row.size,
      displayOrder: row.display_order,
    }));

    res.json(landmarks);
  } catch (error) {
    console.error('Error fetching Dubai landmarks:', error);
    res.status(500).json({ error: 'Failed to fetch Dubai landmarks' });
  }
});

/**
 * GET /api/dubai/areas/:id
 * Get a single area by ID
 */
router.get('/areas/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(`
      SELECT 
        id,
        name,
        name_ar,
        ST_AsGeoJSON(boundary)::json as boundary,
        description,
        description_ar,
        color,
        opacity,
        display_order,
        project_counts,
        average_price,
        sales_volume,
        capital_appreciation,
        rental_yield,
        created_at,
        updated_at
      FROM dubai_areas
      WHERE id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Area not found' });
    }

    const row = result.rows[0];
    const area = {
      id: row.id,
      name: row.name,
      nameAr: row.name_ar,
      boundary: row.boundary,
      description: row.description,
      descriptionAr: row.description_ar,
      color: row.color,
      opacity: parseFloat(row.opacity),
      displayOrder: row.display_order,
      // Market statistics
      projectCounts: row.project_counts || 0,
      averagePrice: row.average_price ? parseFloat(row.average_price) : null,
      salesVolume: row.sales_volume ? parseFloat(row.sales_volume) : null,
      capitalAppreciation: row.capital_appreciation ? parseFloat(row.capital_appreciation) : null,
      rentalYield: row.rental_yield ? parseFloat(row.rental_yield) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    res.json(area);
  } catch (error) {
    console.error('Error fetching area:', error);
    res.status(500).json({ error: 'Failed to fetch area' });
  }
});

/**
 * GET /api/dubai/landmarks/:id
 * Get a single landmark by ID
 */
router.get('/landmarks/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(`
      SELECT 
        id,
        name,
        name_ar,
        ST_Y(location::geometry) as latitude,
        ST_X(location::geometry) as longitude,
        landmark_type,
        icon_name,
        description,
        description_ar,
        year_built,
        website_url,
        image_url,
        color,
        size,
        display_order,
        created_at,
        updated_at
      FROM dubai_landmarks
      WHERE id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Landmark not found' });
    }

    const row = result.rows[0];
    const landmark = {
      id: row.id,
      name: row.name,
      nameAr: row.name_ar,
      location: {
        lat: parseFloat(row.latitude),
        lng: parseFloat(row.longitude),
      },
      landmarkType: row.landmark_type,
      iconName: row.icon_name,
      description: row.description,
      descriptionAr: row.description_ar,
      yearBuilt: row.year_built,
      websiteUrl: row.website_url,
      imageUrl: row.image_url,
      color: row.color,
      size: row.size,
      displayOrder: row.display_order,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    res.json(landmark);
  } catch (error) {
    console.error('Error fetching landmark:', error);
    res.status(500).json({ error: 'Failed to fetch landmark' });
  }
});

/**
 * POST /api/dubai/areas
 * Create a new area
 */
router.post('/areas', [
  body('name').isString().notEmpty(),
  body('boundary').isObject(),
  body('color').optional().isString(),
  body('opacity').optional().isNumeric(),
], async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      name,
      nameAr,
      boundary,
      description,
      descriptionAr,
      color = '#3B82F6',
      opacity = 0.3,
      displayOrder = 0,
    } = req.body;

    // Convert GeoJSON to PostGIS geometry
    const result = await pool.query(`
      INSERT INTO dubai_areas (
        name, name_ar, boundary,
        description, description_ar, color, opacity, display_order
      ) VALUES (
        $1, $2, ST_GeomFromGeoJSON($3)::geography, $4, $5, $6, $7, $8
      )
      RETURNING id, name, name_ar, ST_AsGeoJSON(boundary)::json as boundary,
                description, description_ar,
                color, opacity, display_order, created_at, updated_at
    `, [name, nameAr, JSON.stringify(boundary),
        description, descriptionAr, color, opacity, displayOrder]);

    const row = result.rows[0];
    const newArea = {
      id: row.id,
      name: row.name,
      nameAr: row.name_ar,
      boundary: row.boundary,
      description: row.description,
      descriptionAr: row.description_ar,
      color: row.color,
      opacity: parseFloat(row.opacity),
      displayOrder: row.display_order,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    res.status(201).json(newArea);
  } catch (error) {
    console.error('Error creating area:', error);
    res.status(500).json({ error: 'Failed to create area' });
  }
});

/**
 * PUT /api/dubai/areas/:id
 * Update an existing area
 */
router.put('/areas/:id', [
  body('name').optional().isString(),
  body('boundary').optional().isObject(),
  body('color').optional().isString(),
  body('opacity').optional().isNumeric(),
], async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const {
      name,
      nameAr,
      boundary,
      description,
      descriptionAr,
      color,
      opacity,
      visible,
      displayOrder,
      projectCounts,
      averagePrice,
      salesVolume,
      capitalAppreciation,
      rentalYield,
    } = req.body;

    // Build dynamic update query
    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramCount++}`);
      values.push(name);
    }
    if (nameAr !== undefined) {
      updates.push(`name_ar = $${paramCount++}`);
      values.push(nameAr);
    }
    if (boundary !== undefined) {
      updates.push(`boundary = ST_GeomFromGeoJSON($${paramCount++})::geography`);
      values.push(JSON.stringify(boundary));
    }
    if (description !== undefined) {
      updates.push(`description = $${paramCount++}`);
      values.push(description);
    }
    if (descriptionAr !== undefined) {
      updates.push(`description_ar = $${paramCount++}`);
      values.push(descriptionAr);
    }
    if (color !== undefined) {
      updates.push(`color = $${paramCount++}`);
      values.push(color);
    }
    if (opacity !== undefined) {
      updates.push(`opacity = $${paramCount++}`);
      values.push(opacity);
    }
    if (visible !== undefined) {
      updates.push(`visible = $${paramCount++}`);
      values.push(visible);
    }
    if (displayOrder !== undefined) {
      updates.push(`display_order = $${paramCount++}`);
      values.push(displayOrder);
    }
    // Market statistics
    if (projectCounts !== undefined) {
      updates.push(`project_counts = $${paramCount++}`);
      values.push(projectCounts);
    }
    if (averagePrice !== undefined) {
      updates.push(`average_price = $${paramCount++}`);
      values.push(averagePrice);
    }
    if (salesVolume !== undefined) {
      updates.push(`sales_volume = $${paramCount++}`);
      values.push(salesVolume);
    }
    if (capitalAppreciation !== undefined) {
      updates.push(`capital_appreciation = $${paramCount++}`);
      values.push(capitalAppreciation);
    }
    if (rentalYield !== undefined) {
      updates.push(`rental_yield = $${paramCount++}`);
      values.push(rentalYield);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(id);
    const result = await pool.query(`
      UPDATE dubai_areas 
      SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $${paramCount}
      RETURNING id, name, name_ar, ST_AsGeoJSON(boundary)::json as boundary,
                description, description_ar,
                color, opacity, visible, display_order,
                project_counts, average_price, sales_volume, capital_appreciation, rental_yield,
                created_at, updated_at
    `, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Area not found' });
    }

    const row = result.rows[0];
    const updatedArea = {
      id: row.id,
      name: row.name,
      nameAr: row.name_ar,
      boundary: row.boundary,
      description: row.description,
      descriptionAr: row.description_ar,
      color: row.color,
      opacity: parseFloat(row.opacity),
      visible: row.visible,
      displayOrder: row.display_order,
      // Market statistics
      projectCounts: row.project_counts || 0,
      averagePrice: row.average_price ? parseFloat(row.average_price) : null,
      salesVolume: row.sales_volume ? parseFloat(row.sales_volume) : null,
      capitalAppreciation: row.capital_appreciation ? parseFloat(row.capital_appreciation) : null,
      rentalYield: row.rental_yield ? parseFloat(row.rental_yield) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    res.json(updatedArea);
  } catch (error) {
    console.error('Error updating area:', error);
    res.status(500).json({ error: 'Failed to update area' });
  }
});

/**
 * DELETE /api/dubai/areas/:id
 * Delete an area
 */
router.delete('/areas/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(`
      DELETE FROM dubai_areas WHERE id = $1 RETURNING id
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Area not found' });
    }

    res.json({ success: true, id: result.rows[0].id });
  } catch (error) {
    console.error('Error deleting area:', error);
    res.status(500).json({ error: 'Failed to delete area' });
  }
});

/**
 * POST /api/dubai/landmarks
 * Create a new landmark
 */
router.post('/landmarks', [
  body('name').isString().notEmpty(),
  body('location').isObject(),
  body('landmarkType').isString().notEmpty(),
], async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      name,
      nameAr,
      location,
      landmarkType,
      iconName = 'landmark',
      description,
      descriptionAr,
      yearBuilt,
      websiteUrl,
      imageUrl,
      color = '#EF4444',
      size = 'medium',
      displayOrder = 0,
    } = req.body;

    const result = await pool.query(`
      INSERT INTO dubai_landmarks (
        name, name_ar, location, landmark_type, icon_name,
        description, description_ar, year_built, website_url, image_url,
        color, size, display_order
      ) VALUES (
        $1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography, $5, $6,
        $7, $8, $9, $10, $11, $12, $13, $14
      )
      RETURNING id, name, name_ar, ST_Y(location::geometry) as latitude,
                ST_X(location::geometry) as longitude, landmark_type, icon_name,
                description, description_ar, year_built, website_url, image_url,
                color, size, display_order, created_at, updated_at
    `, [name, nameAr, location.lng, location.lat, landmarkType, iconName,
        description, descriptionAr, yearBuilt, websiteUrl, imageUrl,
        color, size, displayOrder]);

    const row = result.rows[0];
    const newLandmark = {
      id: row.id,
      name: row.name,
      nameAr: row.name_ar,
      location: {
        lat: parseFloat(row.latitude),
        lng: parseFloat(row.longitude),
      },
      landmarkType: row.landmark_type,
      iconName: row.icon_name,
      description: row.description,
      descriptionAr: row.description_ar,
      yearBuilt: row.year_built,
      websiteUrl: row.website_url,
      imageUrl: row.image_url,
      color: row.color,
      size: row.size,
      displayOrder: row.display_order,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    res.status(201).json(newLandmark);
  } catch (error) {
    console.error('Error creating landmark:', error);
    res.status(500).json({ error: 'Failed to create landmark' });
  }
});

/**
 * PUT /api/dubai/landmarks/:id
 * Update an existing landmark
 */
router.put('/landmarks/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      name,
      nameAr,
      location,
      landmarkType,
      iconName,
      description,
      descriptionAr,
      yearBuilt,
      websiteUrl,
      imageUrl,
      color,
      size,
      visible,
      displayOrder,
    } = req.body;

    // Build dynamic update query
    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramCount++}`);
      values.push(name);
    }
    if (nameAr !== undefined) {
      updates.push(`name_ar = $${paramCount++}`);
      values.push(nameAr);
    }
    if (location !== undefined) {
      updates.push(`location = ST_SetSRID(ST_MakePoint($${paramCount++}, $${paramCount++}), 4326)::geography`);
      values.push(location.lng, location.lat);
    }
    if (landmarkType !== undefined) {
      updates.push(`landmark_type = $${paramCount++}`);
      values.push(landmarkType);
    }
    if (iconName !== undefined) {
      updates.push(`icon_name = $${paramCount++}`);
      values.push(iconName);
    }
    if (description !== undefined) {
      updates.push(`description = $${paramCount++}`);
      values.push(description);
    }
    if (descriptionAr !== undefined) {
      updates.push(`description_ar = $${paramCount++}`);
      values.push(descriptionAr);
    }
    if (yearBuilt !== undefined) {
      updates.push(`year_built = $${paramCount++}`);
      values.push(yearBuilt);
    }
    if (websiteUrl !== undefined) {
      updates.push(`website_url = $${paramCount++}`);
      values.push(websiteUrl);
    }
    if (imageUrl !== undefined) {
      updates.push(`image_url = $${paramCount++}`);
      values.push(imageUrl);
    }
    if (color !== undefined) {
      updates.push(`color = $${paramCount++}`);
      values.push(color);
    }
    if (size !== undefined) {
      updates.push(`size = $${paramCount++}`);
      values.push(size);
    }
    if (visible !== undefined) {
      updates.push(`visible = $${paramCount++}`);
      values.push(visible);
    }
    if (displayOrder !== undefined) {
      updates.push(`display_order = $${paramCount++}`);
      values.push(displayOrder);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(id);
    const result = await pool.query(`
      UPDATE dubai_landmarks 
      SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $${paramCount}
      RETURNING id, name, name_ar, ST_Y(location::geometry) as latitude,
                ST_X(location::geometry) as longitude, landmark_type, icon_name,
                description, description_ar, year_built, website_url, image_url,
                color, size, visible, display_order, created_at, updated_at
    `, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Landmark not found' });
    }

    const row = result.rows[0];
    const updatedLandmark = {
      id: row.id,
      name: row.name,
      nameAr: row.name_ar,
      location: {
        lat: parseFloat(row.latitude),
        lng: parseFloat(row.longitude),
      },
      landmarkType: row.landmark_type,
      iconName: row.icon_name,
      description: row.description,
      descriptionAr: row.description_ar,
      yearBuilt: row.year_built,
      websiteUrl: row.website_url,
      imageUrl: row.image_url,
      color: row.color,
      size: row.size,
      visible: row.visible,
      displayOrder: row.display_order,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    res.json(updatedLandmark);
  } catch (error) {
    console.error('Error updating landmark:', error);
    res.status(500).json({ error: 'Failed to update landmark' });
  }
});

/**
 * DELETE /api/dubai/landmarks/:id
 * Delete a landmark
 */
router.delete('/landmarks/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(`
      DELETE FROM dubai_landmarks WHERE id = $1 RETURNING id
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Landmark not found' });
    }

    res.json({ success: true, id: result.rows[0].id });
  } catch (error) {
    console.error('Error deleting landmark:', error);
    res.status(500).json({ error: 'Failed to delete landmark' });
  }
});

export default router;
