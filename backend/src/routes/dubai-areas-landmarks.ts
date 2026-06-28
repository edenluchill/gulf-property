import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import pool from '../db/pool';
import { requireAuth } from '../middleware/auth';
import { cachedRender, acceptsGzip, invalidate } from '../services/microCache';
import { seal } from '../services/seal';

const router = Router();

// Map first-screen reads (/areas, /landmarks) are the hottest public endpoints and
// the proven load-test bottleneck. Cache them in-process with single-flight; the
// underlying DLD-derived metrics only change on the daily recompute, so a few-minute
// TTL is plenty fresh while collapsing a herd of cold visitors into one DB query.
const AREAS_TTL_MS = Number(process.env.AREAS_CACHE_TTL_MS) || 5 * 60 * 1000;

// Area boundaries are the bulk of the /areas payload (672KB raw). We keep them as
// ONE preloaded geojson vector source (zero pop-in for Luna tours, instant
// recolor/highlight anywhere) — NOT per-viewport MVT tiles which would stream/pop.
// To make that preloaded source lean: simplify geometry (Douglas-Peucker, topology
// preserved) + drop coordinate precision to 5 decimals (~1.1m, invisible at map
// zoom). Tunable so we can dial fidelity↔size. degrees: 0.0001 ≈ 11m.
const AREA_SIMPLIFY_TOL = Number(process.env.AREA_SIMPLIFY_TOLERANCE) || 0.0001;
const AREA_COORD_DIGITS = Number(process.env.AREA_COORD_DIGITS) || 5;

// Any write to areas/landmarks (editor saves, batch-update) drops the cache after
// the response finishes, so the editor's post-save refetch always sees fresh data.
router.use((req, res, next) => {
  if (req.method !== 'GET') {
    res.on('finish', () => { invalidate('render:areas'); invalidate('render:landmarks'); });
  }
  next();
});

// Shared helper: map a dubai_areas row to API response shape
function mapAreaRow(row: any) {
  return {
    id: row.id,
    name: row.name,
    nameAr: row.name_ar,
    boundary: row.boundary,
    description: row.description,
    descriptionAr: row.description_ar,
    color: row.color,
    opacity: parseFloat(row.opacity),
    displayOrder: row.display_order,
    visible: row.visible,
    areaCategory: row.area_category,
    investmentProfile: row.investment_profile,
    rentalRestrictions: row.rental_restrictions,
    growthPotential: row.growth_potential,
    aiSummary: row.ai_summary,
    translations: row.translations || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Standard SELECT columns for dubai_areas
const AREA_SELECT = `
  id, name, name_ar, ST_AsGeoJSON(boundary)::json as boundary,
  description, description_ar, color, opacity, display_order, visible,
  area_category, investment_profile, rental_restrictions, growth_potential, ai_summary,
  translations, created_at, updated_at
`;

/**
 * GET /api/dubai/areas
 * Returns all Dubai areas (districts) with polygon boundaries
 * Frontend will render these as colored overlays on the map
 * Metrics are calculated from real DLD transaction data
 */
const USAGE_BUCKETS = ['all', 'residential', 'commercial', 'hospitality', 'industrial', 'other']

router.get('/areas', async (req: Request, res: Response) => {
  try {
    // usage lens — the MAP shows 'all' (every property type combined); the area
    // detail dialog can filter to a specific usage. Nothing is hidden.
    const usage = USAGE_BUCKETS.includes(String(req.query.usage)) ? String(req.query.usage) : 'all'
    const rendered = await cachedRender(`areas:${usage}`, AREAS_TTL_MS, async () => {
    // Join with real-time metrics from DLD transactions
    const result = await pool.query(`
      SELECT
        da.id, da.name, da.name_ar,
        ST_AsGeoJSON(ST_SimplifyPreserveTopology(da.boundary::geometry, ${AREA_SIMPLIFY_TOL}), ${AREA_COORD_DIGITS})::json as boundary,
        da.description, da.description_ar, da.color, da.opacity, da.display_order, da.visible,
        -- Metrics from DLD transactions
        m.avg_price_sqm as average_price,
        m.median_price_sqm as median_price_sqm,
        m.median_unit_price as median_unit_price,
        m.sales_volume as sales_volume,
        m.capital_growth_pct as capital_appreciation,
        m.rental_yield_pct as rental_yield,
        m.rent_stability_pct as rent_stability,
        m.median_new_rent_sqm as median_new_rent_sqm,
        m.new_contract_count as new_contract_count,
        m.renew_contract_count as renew_contract_count,
        m.transaction_count,
        ny.net_yield_pct as net_yield_pct,
        ny.service_charge_sqft as service_charge_sqft,
        ny.gross_yield_pct as net_gross_yield_pct,
        ny.sc_drag_pct as sc_drag_pct,
        da.area_category, da.investment_profile, da.rental_restrictions, da.growth_potential, da.ai_summary,
        da.translations, da.created_at, da.updated_at
      FROM dubai_areas da
      LEFT JOIN get_dubai_area_metrics($1) m ON m.id = da.id
      LEFT JOIN mv_area_net_yield ny ON ny.dubai_area_id = da.id
      WHERE da.visible = true
      ORDER BY da.display_order ASC, da.name ASC
    `, [usage]);

    const mapped = result.rows.map(row => ({
      ...mapAreaRow(row),
      // Metrics from DLD transactions (read-only, not stored in areas table)
      averagePrice: row.average_price ? parseFloat(row.average_price) : null,
      salesVolume: row.sales_volume ? parseFloat(row.sales_volume) : null,
      capitalAppreciation: row.capital_appreciation ? parseFloat(row.capital_appreciation) : null,
      rentalYield: row.rental_yield ? parseFloat(row.rental_yield) : null,
      rentStability: row.rent_stability != null ? parseFloat(row.rent_stability) : null,
      medianNewRentSqm: row.median_new_rent_sqm != null ? parseFloat(row.median_new_rent_sqm) : null,
      newContractCount: row.new_contract_count != null ? parseInt(row.new_contract_count) : null,
      renewContractCount: row.renew_contract_count != null ? parseInt(row.renew_contract_count) : null,
      transactionCount: row.transaction_count ? parseInt(row.transaction_count) : null,
      medianPriceSqm: row.median_price_sqm ? parseFloat(row.median_price_sqm) : null,
      medianUnitPrice: row.median_unit_price ? parseFloat(row.median_unit_price) : null,
      netYield: row.net_yield_pct != null ? parseFloat(row.net_yield_pct) : null,
      serviceChargeSqft: row.service_charge_sqft != null ? parseFloat(row.service_charge_sqft) : null,
      // gross + drag come from the SAME view as netYield, so gross − drag = net is self-consistent
      // in the area-detail Net Yield breakdown (don't mix with rentalYield, a different source).
      netGrossYield: row.net_gross_yield_pct != null ? parseFloat(row.net_gross_yield_pct) : null,
      scDragPct: row.sc_drag_pct != null ? parseFloat(row.sc_drag_pct) : null,
    }));
      return mapped;
    });

    // ALWAYS sealed (multi-stage, date-rotating obfuscation): the bare URL must not
    // return copy-pasteable JSON. The map decrypts client-side (frontend lib/api.ts);
    // our own node tools use unseal() from services/seal. ~127KB, gzip kept inside.
    res.type('application/octet-stream');
    res.setHeader('Cache-Control', 'no-transform'); // keep nginx/CF off the binary
    res.end(seal(rendered.gz));
  } catch (error) {
    console.error('Error fetching Dubai areas:', error);
    res.status(500).json({ error: 'Failed to fetch Dubai areas' });
  }
});

/**
 * GET /api/dubai/areas/search
 * Search areas by name for navigation feature
 * Returns areas with centroid for map fly-to
 */
router.get('/areas/search', async (req: Request, res: Response) => {
  try {
    const { q } = req.query;

    if (!q || typeof q !== 'string' || q.length < 2) {
      return res.json([]);
    }

    const searchTerm = `%${q.toLowerCase()}%`;

    const result = await pool.query(`
      SELECT
        da.id,
        da.name,
        da.name_ar,
        ST_X(ST_Centroid(da.boundary::geometry)) as lng,
        ST_Y(ST_Centroid(da.boundary::geometry)) as lat,
        m.transaction_count,
        m.avg_price_sqm
      FROM dubai_areas da
      LEFT JOIN get_dubai_area_metrics() m ON m.id = da.id
      WHERE da.visible = true
        AND (LOWER(da.name) LIKE $1 OR LOWER(da.name_ar) LIKE $1)
      ORDER BY
        CASE WHEN LOWER(da.name) LIKE $2 THEN 0 ELSE 1 END,
        m.transaction_count DESC NULLS LAST
      LIMIT 10
    `, [searchTerm, `${q.toLowerCase()}%`]);

    const areas = result.rows.map(row => ({
      id: row.id,
      name: row.name,
      nameAr: row.name_ar,
      centroid: {
        lat: parseFloat(row.lat),
        lng: parseFloat(row.lng),
      },
      transactionCount: row.transaction_count ? parseInt(row.transaction_count) : null,
      avgPriceSqm: row.avg_price_sqm ? parseFloat(row.avg_price_sqm) : null,
    }));

    res.json(areas);
  } catch (error) {
    console.error('Error searching Dubai areas:', error);
    res.status(500).json({ error: 'Failed to search Dubai areas' });
  }
});

/**
 * GET /api/dubai/landmarks
 * Returns all Dubai landmarks (points of interest)
 * Frontend will render these as markers on the map
 */
router.get('/landmarks', async (req: Request, res: Response) => {
  try {
    const rendered = await cachedRender('landmarks', AREAS_TTL_MS, async () => {
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
        translations
      FROM dubai_landmarks
      WHERE visible = true
      ORDER BY display_order ASC, name ASC
    `);

    const mapped = result.rows.map(row => ({
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
      translations: row.translations || {},
    }));
      return mapped;
    });

    res.type('application/json');
    res.setHeader('Vary', 'Accept-Encoding');
    if (acceptsGzip(req.headers['accept-encoding'])) {
      res.setHeader('Content-Encoding', 'gzip');
      res.end(rendered.gz);
    } else {
      res.end(rendered.json);
    }
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
      SELECT ${AREA_SELECT}
      FROM dubai_areas
      WHERE id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Area not found' });
    }

    const area = mapAreaRow(result.rows[0]);

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
 * Create a new area (requires authentication)
 */
router.post('/areas', requireAuth, [
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
      areaCategory,
      investmentProfile,
      rentalRestrictions,
      growthPotential,
      aiSummary,
      translations = {},
    } = req.body;

    // Convert GeoJSON to PostGIS geometry
    const result = await pool.query(`
      INSERT INTO dubai_areas (
        name, name_ar, boundary,
        description, description_ar,
        color, opacity, display_order,
        area_category, investment_profile, rental_restrictions,
        growth_potential, ai_summary, translations
      ) VALUES (
        $1, $2, ST_GeomFromGeoJSON($3)::geography, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14
      )
      RETURNING ${AREA_SELECT}
    `, [name, nameAr, JSON.stringify(boundary),
        description, descriptionAr, color, opacity, displayOrder,
        areaCategory, investmentProfile, rentalRestrictions,
        growthPotential, aiSummary, JSON.stringify(translations)]);

    const newArea = mapAreaRow(result.rows[0]);

    res.status(201).json(newArea);
  } catch (error) {
    console.error('Error creating area:', error);
    res.status(500).json({ error: 'Failed to create area' });
  }
});

/**
 * PUT /api/dubai/areas/:id
 * Update an existing area (requires authentication)
 */
router.put('/areas/:id', requireAuth, [
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
      areaCategory,
      investmentProfile,
      rentalRestrictions,
      growthPotential,
      aiSummary,
      translations,
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
    // AI analysis fields
    if (areaCategory !== undefined) {
      updates.push(`area_category = $${paramCount++}`);
      values.push(areaCategory);
    }
    if (investmentProfile !== undefined) {
      updates.push(`investment_profile = $${paramCount++}`);
      values.push(investmentProfile);
    }
    if (rentalRestrictions !== undefined) {
      updates.push(`rental_restrictions = $${paramCount++}`);
      values.push(rentalRestrictions);
    }
    if (growthPotential !== undefined) {
      updates.push(`growth_potential = $${paramCount++}`);
      values.push(growthPotential);
    }
    if (aiSummary !== undefined) {
      updates.push(`ai_summary = $${paramCount++}`);
      values.push(aiSummary);
    }
    if (translations !== undefined) {
      updates.push(`translations = $${paramCount++}`);
      values.push(JSON.stringify(translations));
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(id);
    const result = await pool.query(`
      UPDATE dubai_areas
      SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $${paramCount}
      RETURNING ${AREA_SELECT}
    `, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Area not found' });
    }

    const updatedArea = mapAreaRow(result.rows[0]);

    res.json(updatedArea);
  } catch (error) {
    console.error('Error updating area:', error);
    res.status(500).json({ error: 'Failed to update area' });
  }
});

/**
 * DELETE /api/dubai/areas/:id
 * Delete an area (requires authentication)
 */
router.delete('/areas/:id', requireAuth, async (req: Request, res: Response) => {
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
 * Create a new landmark (requires authentication)
 */
router.post('/landmarks', requireAuth, [
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
 * Update an existing landmark (requires authentication)
 */
router.put('/landmarks/:id', requireAuth, async (req: Request, res: Response) => {
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
 * Delete a landmark (requires authentication)
 */
router.delete('/landmarks/:id', requireAuth, async (req: Request, res: Response) => {
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

/**
 * POST /api/dubai/batch-update
 * Batch update multiple areas and landmarks at once
 * This is optimized for the editor to save multiple changes efficiently
 * Requires authentication
 */
router.post('/batch-update', requireAuth, async (req: Request, res: Response) => {
  const client = await pool.connect();
  
  try {
    const { areas = [], landmarks = [] } = req.body;
    
    if (!Array.isArray(areas) || !Array.isArray(landmarks)) {
      return res.status(400).json({ error: 'Areas and landmarks must be arrays' });
    }

    // Start transaction
    await client.query('BEGIN');

    const updatedAreas = [];
    const updatedLandmarks = [];

    // Update all areas
    for (const area of areas) {
      const {
        id,
        name,
        nameAr,
        boundary,
        description,
        descriptionAr,
        color,
        opacity,
        visible,
        displayOrder,
        areaCategory,
        investmentProfile,
        rentalRestrictions,
        growthPotential,
        aiSummary,
        translations,
      } = area;

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
      if (areaCategory !== undefined) {
        updates.push(`area_category = $${paramCount++}`);
        values.push(areaCategory);
      }
      if (investmentProfile !== undefined) {
        updates.push(`investment_profile = $${paramCount++}`);
        values.push(investmentProfile);
      }
      if (rentalRestrictions !== undefined) {
        updates.push(`rental_restrictions = $${paramCount++}`);
        values.push(rentalRestrictions);
      }
      if (growthPotential !== undefined) {
        updates.push(`growth_potential = $${paramCount++}`);
        values.push(growthPotential);
      }
      if (aiSummary !== undefined) {
        updates.push(`ai_summary = $${paramCount++}`);
        values.push(aiSummary);
      }
      if (translations !== undefined) {
        updates.push(`translations = $${paramCount++}`);
        values.push(JSON.stringify(translations));
      }

      if (updates.length > 0) {
        values.push(id);
        const result = await client.query(`
          UPDATE dubai_areas
          SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
          WHERE id = $${paramCount}
          RETURNING ${AREA_SELECT}
        `, values);

        if (result.rows.length > 0) {
          updatedAreas.push(mapAreaRow(result.rows[0]));
        }
      }
    }

    // Update all landmarks
    for (const landmark of landmarks) {
      const {
        id,
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
      } = landmark;

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

      if (updates.length > 0) {
        values.push(id);
        const result = await client.query(`
          UPDATE dubai_landmarks 
          SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
          WHERE id = $${paramCount}
          RETURNING id, name, name_ar, ST_Y(location::geometry) as latitude,
                    ST_X(location::geometry) as longitude, landmark_type, icon_name,
                    description, description_ar, year_built, website_url, image_url,
                    color, size, visible, display_order, created_at, updated_at
        `, values);

        if (result.rows.length > 0) {
          const row = result.rows[0];
          updatedLandmarks.push({
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
          });
        }
      }
    }

    // Commit transaction
    await client.query('COMMIT');

    res.json({
      success: true,
      updated: {
        areas: updatedAreas,
        landmarks: updatedLandmarks,
      },
      counts: {
        areas: updatedAreas.length,
        landmarks: updatedLandmarks.length,
      },
    });
  } catch (error) {
    // Rollback on error
    await client.query('ROLLBACK');
    console.error('Error in batch update:', error);
    res.status(500).json({ error: 'Failed to batch update items' });
  } finally {
    client.release();
  }
});

export default router;
