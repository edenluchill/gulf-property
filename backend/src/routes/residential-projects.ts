/**
 * Residential Projects API Routes
 * Handles developer-submitted projects with AI-extracted data
 */

import { Router, Request, Response } from 'express'
import { Pool } from 'pg'
import {
  SubmitProjectRequest,
  SubmitProjectResponse,
  ListProjectsResponse,
} from '../types/residential-projects'
import { isR2PdfCacheUrl } from '../services/r2-storage'
import { requireAuth } from '../middleware/auth'
import { requireUploader } from '../middleware/requireUploader'
import { invalidateProjectInsights } from '../services/projectInsights'

const MONTH_NAMES: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
  may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8,
  september: 9, sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11,
  december: 12, dec: 12,
}

/**
 * Normalize an AI-extracted date into a PostgreSQL `date` (YYYY-MM-DD) or null.
 *
 * Brochures give dates in many shapes — "DECEMBER 2029", "Q4 2029", "2030-06",
 * "2030" — none of which Postgres accepts for a `date` column (that 500'd the
 * submit endpoint). We normalize to month/quarter granularity (1st of the
 * month/quarter) so the date is preserved instead of lost, and fall back to
 * null only when truly unparseable so a submit never crashes on a date again.
 */
function cleanDateFormat(dateStr: string | undefined | null): string | null {
  if (!dateStr) return null
  const s = String(dateStr).trim()
  if (!s) return null

  const pad = (n: number) => String(n).padStart(2, '0')

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s

  // YYYY-MM or YYYY/MM → first of month
  let m = s.match(/^(\d{4})[-/](\d{1,2})$/)
  if (m) {
    const mon = Number(m[2])
    if (mon >= 1 && mon <= 12) return `${m[1]}-${pad(mon)}-01`
  }

  // Quarter: "Q4 2029", "2029 Q4", "2029-Q4" → first month of the quarter
  m = s.match(/^Q([1-4])[\s-]*(\d{4})$/i) || s.match(/^(\d{4})[\s-]*Q([1-4])$/i)
  if (m) {
    const isLeading = /^Q/i.test(s)
    const q = Number(isLeading ? m[1] : m[2])
    const year = isLeading ? m[2] : m[1]
    return `${year}-${pad((q - 1) * 3 + 1)}-01`
  }

  // Month name + year: "DECEMBER 2029", "Dec 2029" → first of month
  m = s.match(/^([A-Za-z]+)[\s,]+(\d{4})$/) || s.match(/^(\d{4})[\s,]+([A-Za-z]+)$/)
  if (m) {
    const word = (/^\d/.test(m[1]) ? m[2] : m[1]).toLowerCase()
    const year = /^\d/.test(m[1]) ? m[1] : m[2]
    const mon = MONTH_NAMES[word]
    if (mon) return `${year}-${pad(mon)}-01`
  }

  // Bare year → Jan 1
  if (/^\d{4}$/.test(s)) return `${s}-01-01`

  console.warn(`⚠️ Unparseable date format: "${dateStr}", storing null`)
  return null
}

/**
 * Transform payment plan data to JSONB format
 */
function transformPaymentPlanToJson(paymentPlan: any[] | undefined): any[] {
  if (!paymentPlan || !Array.isArray(paymentPlan) || paymentPlan.length === 0) {
    return []
  }

  return paymentPlan.map((milestone, i) => {
    const cleanedDate = cleanDateFormat(milestone.date)

    // Auto-calculate interval if not provided
    let intervalMonths = milestone.intervalMonths
    let intervalDescription = milestone.intervalDescription

    if (intervalMonths === undefined && i > 0 && cleanedDate && paymentPlan[i - 1].date) {
      const prevDate = cleanDateFormat(paymentPlan[i - 1].date)
      if (prevDate) {
        const current = new Date(cleanedDate)
        const previous = new Date(prevDate)
        const monthsDiff = Math.round(
          (current.getTime() - previous.getTime()) / (1000 * 60 * 60 * 24 * 30.44)
        )
        intervalMonths = monthsDiff > 0 ? monthsDiff : undefined

        if (!intervalDescription && intervalMonths) {
          intervalDescription = `${intervalMonths} month${intervalMonths !== 1 ? 's' : ''} later`
        }
      }
    } else if (i === 0 && intervalMonths === undefined) {
      intervalMonths = 0
      if (!intervalDescription) {
        intervalDescription = 'At booking'
      }
    }

    return {
      milestone: milestone.milestone,
      percentage: milestone.percentage,
      date: cleanedDate,
      intervalMonths,
      intervalDescription,
      description: milestone.description || null,
      displayOrder: i,
    }
  })
}

// 从 payment_plan milestones 推导付款结构标签「建设期/交付」(如 "80/20"、"50/50")。
// 交付里程碑按名字识别(handover/completion/交房…),没识别到就把最后一期当交付;
// 百分比总和不在 95~105 的脏数据(楼书解析不全)不出标签。取 5 的倍数对齐
// 常见档位,供地图筛选用。
function derivePaymentSplit(plan: unknown): string | null {
  if (!Array.isArray(plan) || plan.length === 0) return null
  let total = 0
  let handover = 0
  let matched = false
  for (const m of plan) {
    const pct = Number((m as { percentage?: unknown })?.percentage)
    if (!isFinite(pct) || pct <= 0) continue
    total += pct
    const name = String((m as { milestone?: unknown })?.milestone ?? '').toLowerCase()
    if (/handover|completion|possession|交房|交付|完工|完成/.test(name)) {
      handover += pct
      matched = true
    }
  }
  if (total < 95 || total > 105) return null
  if (!matched) {
    const withPct = (plan as { percentage?: unknown }[]).filter(m => isFinite(Number(m?.percentage)) && Number(m?.percentage) > 0)
    const last = withPct[withPct.length - 1]
    if (!last) return null
    handover = Number(last.percentage)
  }
  const h = Math.min(95, Math.max(5, Math.round((handover / total) * 100 / 5) * 5))
  return `${100 - h}/${h}`
}

export function createResidentialProjectsRouter(pool: Pool): Router {
  const router = Router()

  // `id` is a residential_projects UUID. Without this guard a malformed id goes
  // straight into `WHERE id = $1`, Postgres throws on the uuid cast, and the
  // handler's catch turns it into a 500 — a server error for what is really a
  // bad request. Same defect the area-insights route was fixed for on 2026-06-28;
  // these three /:id routes still had it (GET returned 500 for /not-a-uuid).
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  router.param('id', (_req: Request, res: Response, next, id: string) => {
    if (!UUID_RE.test(id)) {
      res.status(404).json({ error: 'Project not found' })
      return
    }
    next()
  })

  // ============================================================================
  // GET /api/residential-projects/map-pins
  // Returns all projects as individual pins for map view (no clustering)
  // Optimized for map display: minimal data, includes first image
  // ============================================================================
  router.get('/map-pins', async (_req: Request, res: Response) => {
    try {
      const result = await pool.query(`
        SELECT
          id,
          project_name,
          developer,
          area,
          starting_price,
          min_price,
          max_price,
          min_bedrooms,
          max_bedrooms,
          status,
          latitude,
          longitude,
          completion_date,
          payment_plan,
          COALESCE(primary_image, project_images[1]) as first_image
        FROM residential_projects
        WHERE verified = true
          AND location IS NOT NULL
        ORDER BY created_at DESC
      `)

      res.json({
        success: true,
        data: result.rows.map(row => ({
          id: row.id,
          name: row.project_name,
          developer: row.developer,
          area: row.area,
          minPrice: row.min_price ? parseFloat(row.min_price) : (row.starting_price ? parseFloat(row.starting_price) : null),
          maxPrice: row.max_price ? parseFloat(row.max_price) : null,
          minBeds: row.min_bedrooms,
          maxBeds: row.max_bedrooms,
          status: row.status,
          lat: row.latitude,
          lng: row.longitude,
          image: row.first_image || null,
          completionDate: row.completion_date || null,
          paymentPlan: derivePaymentSplit(row.payment_plan)
        }))
      })
    } catch (error) {
      console.error('Error fetching map pins:', error)
      res.status(500).json({
        success: false,
        error: 'Failed to fetch map pins',
        message: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  })

  // ============================================================================
  // GET /api/residential-projects/clusters
  // Returns clustered projects for map view (server-side clustering with PostGIS)
  // ============================================================================
  router.get('/clusters', async (req: Request, res: Response) => {
    try {
      const { 
        minLng, minLat, maxLng, maxLat,
        minPrice, maxPrice,
        minBedrooms, maxBedrooms,
        developer, project, area, status
      } = req.query
      
      // Build filter conditions that will be applied to both data_count and clustered CTEs
      const queryParams: any[] = []
      let paramCount = 1
      const filterConditions: string[] = []
      
      // Bounding box filter
      if (minLng && minLat && maxLng && maxLat) {
        filterConditions.push(`ST_Intersects(
          location,
          ST_MakeEnvelope($${paramCount}, $${paramCount + 1}, $${paramCount + 2}, $${paramCount + 3}, 4326)::geography
        )`)
        queryParams.push(minLng, minLat, maxLng, maxLat)
        paramCount += 4
      }
      
      // Apply filters
      if (minPrice) {
        filterConditions.push(`starting_price >= $${paramCount}`)
        queryParams.push(minPrice)
        paramCount++
      }
      if (maxPrice) {
        filterConditions.push(`starting_price <= $${paramCount}`)
        queryParams.push(maxPrice)
        paramCount++
      }
      if (minBedrooms) {
        filterConditions.push(`max_bedrooms >= $${paramCount}`)
        queryParams.push(minBedrooms)
        paramCount++
      }
      if (maxBedrooms) {
        filterConditions.push(`min_bedrooms <= $${paramCount}`)
        queryParams.push(maxBedrooms)
        paramCount++
      }
      if (developer) {
        filterConditions.push(`developer = $${paramCount}`)
        queryParams.push(developer)
        paramCount++
      }
      if (project) {
        filterConditions.push(`project_name = $${paramCount}`)
        queryParams.push(project)
        paramCount++
      }
      if (area) {
        filterConditions.push(`area = $${paramCount}`)
        queryParams.push(area)
        paramCount++
      }
      if (status) {
        filterConditions.push(`status = $${paramCount}`)
        queryParams.push(status)
        paramCount++
      }
      
      // Build WHERE clause with all conditions
      const whereClause = filterConditions.length > 0 
        ? `AND ${filterConditions.join(' AND ')}` 
        : ''
      
      // Get zoom level and determine cluster count dynamically
      const zoom = parseInt(req.query.zoom as string) || 11
      const maxClusters = zoom >= 14 ? 100 : zoom >= 12 ? 50 : 30
      
      // OPTIMIZED: Single scan with window function for count
      const queryText = `
        WITH filtered_data AS (
          SELECT 
            id,
            project_name,
            starting_price,
            min_bedrooms,
            max_bedrooms,
            ST_Y(location::geometry) as latitude,
            ST_X(location::geometry) as longitude,
            location::geometry as geom,
            COUNT(*) OVER() as total_count
          FROM residential_projects
          WHERE verified = true 
            AND location IS NOT NULL
            ${whereClause}
        ),
        clustered AS (
          SELECT 
            id,
            project_name,
            starting_price,
            min_bedrooms,
            max_bedrooms,
            latitude,
            longitude,
            ST_ClusterKMeans(
              geom, 
              LEAST(${maxClusters}, GREATEST(1, total_count::integer))::integer
            ) OVER() as cluster_id
          FROM filtered_data
        )
        SELECT 
          cluster_id,
          COUNT(*) as count,
          AVG(latitude) as lat,
          AVG(longitude) as lng,
          MIN(starting_price) as min_price,
          MAX(starting_price) as max_price,
          AVG(starting_price) as avg_price,
          MIN(min_bedrooms) as min_beds,
          MAX(max_bedrooms) as max_beds,
          array_agg(id) as property_ids
        FROM clustered
        GROUP BY cluster_id
        ORDER BY count DESC
      `
      
      const result = await pool.query(queryText, queryParams)
      
      res.json({
        success: true,
        data: result.rows,
      })
    } catch (error) {
      console.error('Error fetching project clusters:', error)
      res.status(500).json({
        success: false,
        error: 'Failed to fetch project clusters',
        message: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  })

  // ============================================================================
  // GET /api/residential-projects/meta/developers
  // Get list of all developers
  // ============================================================================
  router.get('/meta/developers', async (_req: Request, res: Response) => {
    try {
      const result = await pool.query(`
        SELECT DISTINCT developer
        FROM residential_projects
        WHERE developer IS NOT NULL
        ORDER BY developer
      `)
      
      res.json({
        success: true,
        data: result.rows,
      })
    } catch (error) {
      console.error('Error fetching developers:', error)
      res.status(500).json({
        success: false,
        error: 'Failed to fetch developers',
      })
    }
  })

  // ============================================================================
  // GET /api/residential-projects/meta/areas
  // Get list of all areas with statistics
  // ============================================================================
  router.get('/meta/areas', async (_req: Request, res: Response) => {
    try {
      const result = await pool.query(`
        SELECT 
          area as area_name,
          COUNT(*) as project_count,
          AVG(starting_price) as avg_price,
          MIN(starting_price) as min_price,
          MAX(starting_price) as max_price
        FROM residential_projects
        WHERE area IS NOT NULL AND area != ''
        GROUP BY area
        ORDER BY project_count DESC
      `)
      
      res.json({
        success: true,
        data: result.rows,
      })
    } catch (error) {
      console.error('Error fetching areas:', error)
      res.status(500).json({
        success: false,
        error: 'Failed to fetch areas',
      })
    }
  })

  // ============================================================================
  // GET /api/residential-projects/meta/projects
  // Get list of all projects with statistics
  // ============================================================================
  router.get('/meta/projects', async (_req: Request, res: Response) => {
    try {
      const result = await pool.query(`
        SELECT 
          project_name,
          developer,
          starting_price as avg_price,
          min_price,
          max_price,
          total_units as property_count
        FROM residential_projects
        WHERE project_name IS NOT NULL
        ORDER BY project_name
      `)
      
      res.json({
        success: true,
        data: result.rows,
      })
    } catch (error) {
      console.error('Error fetching projects:', error)
      res.status(500).json({
        success: false,
        error: 'Failed to fetch projects',
      })
    }
  })

  // ============================================================================
  // GET /api/residential-projects/meta/resolve-area?lat=..&lng=..
  // Resolve coordinates to the canonical dubai_areas name (or null if the
  // point falls outside every area polygon — that's a legitimate result).
  // Used by the upload/review forms to auto-fill area whenever the user
  // changes the map location.
  // ============================================================================
  router.get('/meta/resolve-area', async (req: Request, res: Response) => {
    try {
      const lat = parseFloat(String(req.query.lat))
      const lng = parseFloat(String(req.query.lng))
      if (!isFinite(lat) || !isFinite(lng)) {
        return res.status(400).json({ success: false, error: 'lat and lng are required' })
      }
      const { resolveCanonicalArea } = await import('../langgraph/utils/canonical-area')
      const area = await resolveCanonicalArea(lat, lng)
      res.json({ success: true, area: area || null })
    } catch (error) {
      console.error('Error resolving area:', error)
      res.status(500).json({ success: false, error: 'Failed to resolve area' })
    }
  })

  // ============================================================================
  // POST /api/residential-projects/batch
  // Fetch multiple projects by IDs (for cluster expansion)
  // ============================================================================
  router.post('/batch', async (req: Request, res: Response): Promise<void> => {
    try {
      const { ids } = req.body
      
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        res.status(400).json({
          success: false,
          error: 'Invalid or empty ids array',
        })
        return
      }
      
      // Limit to 20 projects at once
      const limitedIds = ids.slice(0, 20)
      
      const result = await pool.query(`
        SELECT 
          id,
          project_name,
          developer,
          address,
          area,
          description,
          latitude,
          longitude,
          launch_date,
          completion_date,
          handover_date,
          construction_progress,
          status,
          min_price,
          max_price,
          starting_price,
          total_unit_types,
          total_units,
          min_bedrooms,
          max_bedrooms,
          primary_image,
          project_images,
          floor_plan_images,
          brochure_url,
          has_renderings,
          has_floor_plans,
          has_location_maps,
          rendering_descriptions,
          floor_plan_descriptions,
          amenities,
          verified,
          featured,
          views_count,
          created_at,
          updated_at
        FROM residential_projects
        WHERE id = ANY($1)
      `, [limitedIds])
      
      // Transform database rows to frontend format (snake_case to camelCase)
      const transformedData = result.rows.map(row => {
        return {
          id: row.id,
          buildingId: null,
          buildingName: row.project_name,
          projectName: row.project_name,
          buildingDescription: row.description,
          developer: row.developer,
          developerId: null,
          developerLogoUrl: null,
          location: {
            lat: row.latitude,
            lng: row.longitude,
          },
          areaName: row.area,
          areaId: null,
          dldLocationId: null,
          minBedrooms: row.min_bedrooms || 0,
          maxBedrooms: row.max_bedrooms || 0,
          bedsDescription: null,
          minSize: null,
          maxSize: null,
          startingPrice: row.starting_price,
          medianPriceSqft: null,
          medianPricePerUnit: null,
          medianRentPerUnit: null,
          launchDate: row.launch_date,
          completionDate: row.completion_date,
          completionPercent: row.construction_progress || 0,  // Now a direct number (0-100)
          status: row.status,
          unitCount: row.total_units,
          buildingUnitCount: row.total_units,
          salesVolume: null,
          propSalesVolume: null,
          primaryImage: row.primary_image || (row.project_images && row.project_images[0]) || null,
          images: row.project_images || [],
          logoUrl: null,
          brochureUrl: row.brochure_url,
          amenities: row.amenities || [],
          displayAs: null,
          verified: row.verified,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }
      })
      
      res.json({
        success: true,
        data: transformedData,
      })
    } catch (error) {
      console.error('Error fetching projects batch:', error)
      res.status(500).json({
        success: false,
        error: 'Failed to fetch projects',
        message: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  })

  // ============================================================================
  // POST /api/residential-projects/submit
  // Submit a new residential project (from DeveloperPropertyUploadPageV2)
  // Requires authentication
  // ============================================================================
  router.post('/submit', requireAuth, requireUploader, async (req: Request, res: Response) => {
    const client = await pool.connect()
    
    try {
      await client.query('BEGIN')

      const data: SubmitProjectRequest = req.body

      console.log('📝 Submitting residential project:', data.projectName)
      console.log('📊 Data summary:')
      console.log('   - Unit types:', data.unitTypes?.length || 0)
      console.log('   - Payment plan milestones:', data.paymentPlan?.length || 0)
      console.log('   - Project images:', data.projectImages?.length || 0)
      console.log('   - Floor plan images:', data.floorPlanImages?.length || 0)
      
      // Debug: Log payment plan data if exists
      if (data.paymentPlan && data.paymentPlan.length > 0) {
        console.log('💰 Payment Plan Data:', JSON.stringify(data.paymentPlan, null, 2))
      } else {
        console.warn('⚠️  No payment plan data received from frontend!')
      }

      // All images should already be in PDF cache (pdf-cache/{pdfHash}/images/*)
      // No need to move anything - pdf-cache is permanent and deduplicated
      const projectImages = data.projectImages || []
      const floorPlanImages = data.floorPlanImages || []
      
      // Validate images are from PDF cache
      const validateImages = (images: string[], type: string) => {
        images.forEach((url, idx) => {
          if (!isR2PdfCacheUrl(url)) {
            console.warn(`⚠️ ${type} image ${idx + 1} is not from PDF cache: ${url.substring(0, 80)}...`)
          }
        })
      }
      
      validateImages(projectImages, 'Project')
      validateImages(floorPlanImages, 'Floor plan')
      
      const finalProjectImages = projectImages
      const finalFloorPlanImages = floorPlanImages

      // ⭐ 幂等提交(2026-07-09):同名项目重提 = 替换,不再追加。此前每次 submit 都
      // INSERT 新项目记录 → 重复上传/重新提交会产生两条项目+两套户型(The Willows 实锤)。
      // 先删同名旧项目(及其户型),把旧项目的收藏迁到新项目,再插新的。
      const oldProjects = await client.query(
        `SELECT id FROM residential_projects WHERE project_name = $1`,
        [data.projectName]
      )
      const oldProjectIds: string[] = oldProjects.rows.map((r: any) => r.id)
      if (oldProjectIds.length > 0) {
        await client.query(`DELETE FROM project_unit_types WHERE project_id = ANY($1)`, [oldProjectIds])
        await client.query(`DELETE FROM residential_projects WHERE id = ANY($1)`, [oldProjectIds])
        console.log(`♻️  Replacing existing project "${data.projectName}" — removed ${oldProjectIds.length} old record(s)`)
      }

      // 1. Insert main project (including payment_plan as JSONB)
      const paymentPlanJson = transformPaymentPlanToJson(data.paymentPlan)
      console.log(`💰 Payment plan: ${paymentPlanJson.length} milestones`)

      const projectResult = await client.query(`
        INSERT INTO residential_projects (
          project_name,
          developer,
          address,
          area,
          description,
          latitude,
          longitude,
          launch_date,
          completion_date,
          handover_date,
          construction_progress,
          project_images,
          floor_plan_images,
          primary_image,
          amenities,
          has_renderings,
          has_floor_plans,
          has_location_maps,
          rendering_descriptions,
          floor_plan_descriptions,
          verified,
          status,
          payment_plan,
          service_charge_per_sqft,
          landmark_distances
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25
        )
        RETURNING id
      `, [
        data.projectName,
        data.developer,
        data.address,
        data.area || null,  // area 可空：坐标不在任何区域内属合法状态
        data.description || '',
        data.latitude || null,
        data.longitude || null,
        cleanDateFormat(data.launchDate),
        cleanDateFormat(data.completionDate),
        cleanDateFormat(data.handoverDate),
        data.constructionProgress || null,
        finalProjectImages,
        finalFloorPlanImages,
        data.primaryImage || null,
        data.amenities || [],
        data.visualContent?.hasRenderings || false,
        data.visualContent?.hasFloorPlans || false,
        data.visualContent?.hasLocationMaps || false,
        data.visualContent?.renderingDescriptions || [],
        data.visualContent?.floorPlanDescriptions || [],
        true,  // Auto-verify for now (no approval workflow)
        data.status || 'upcoming',  // Support sold-out status
        JSON.stringify(paymentPlanJson),
        (data as any).serviceCharge ?? null,
        (data as any).landmarks?.length ? JSON.stringify((data as any).landmarks) : null,
      ])

      const projectId = projectResult.rows[0].id
      console.log('✅ Project created with ID:', projectId)

      // 收藏迁移:旧项目被替换后,把指向旧 id 的收藏改到新项目,避免断了用户收藏。
      // (user_favorites 无 FK 约束,删旧项目不会级联,需手动迁。)
      if (oldProjectIds.length > 0) {
        try {
          const moved = await client.query(
            `UPDATE user_favorites SET project_id = $1 WHERE project_id = ANY($2)`,
            [projectId, oldProjectIds]
          )
          if (moved.rowCount) console.log(`   ⭐ Migrated ${moved.rowCount} favorite(s) to new project id`)
        } catch (e) {
          console.warn('   ⚠️  favorite migration skipped:', (e as Error).message)
        }
      }

      // 2. Insert unit types
      if (data.unitTypes && Array.isArray(data.unitTypes) && data.unitTypes.length > 0) {
        console.log(`📦 Inserting ${data.unitTypes.length} unit types...`)
        
        // Track invalid units for reporting
        const invalidUnits: string[] = [];
        const validUnits = [];
        
        // Validate and fix unit data before insertion
        for (const unit of data.unitTypes) {
          let isValid = true;
          
          // Validate area (must be > 0 per database constraint)
          if (!unit.area || unit.area <= 0) {
            const unitName = unit.name || unit.typeName || 'Unknown'
            console.error(`   ❌ Invalid area for unit "${unitName}": ${unit.area}`);
            console.error(`   🔍 Reason: AI failed to extract unit details (likely misclassified page)`);
            invalidUnits.push(unitName);
            isValid = false;
          }
          
          // Only validate other fields if area is valid
          if (isValid) {
            // Validate bathrooms (must be > 0 per database constraint)
            if (!unit.bathrooms || unit.bathrooms <= 0) {
              const bedrooms = unit.bedrooms || 0;
              // Estimate bathrooms based on bedrooms
              if (bedrooms === 0) {
                unit.bathrooms = 1; // Studio
              } else if (bedrooms === 1) {
                unit.bathrooms = 1;
              } else if (bedrooms === 2) {
                unit.bathrooms = 2;
              } else {
                unit.bathrooms = Math.min(bedrooms, 3);
              }
              console.warn(`   ⚠️  Invalid bathrooms for unit "${unit.name || unit.typeName}", estimated ${unit.bathrooms} based on ${bedrooms} bedrooms`);
            }
            
            // Validate bedrooms (must be >= 0 per database constraint)
            if (unit.bedrooms < 0) {
              console.warn(`   ⚠️  Invalid bedrooms (${unit.bedrooms}) for unit "${unit.name || unit.typeName}", setting to 0`);
              unit.bedrooms = 0;
            }
            
            validUnits.push(unit);
          }
        }
        
        // Report filtering results
        if (invalidUnits.length > 0) {
          console.warn(`\n⚠️  FILTERED OUT ${invalidUnits.length} INVALID UNIT(S):`);
          invalidUnits.forEach(name => console.warn(`   - ${name} (area=0, AI extraction failed)`));
          console.warn(`✅ Proceeding with ${validUnits.length} valid unit(s)\n`);
        }
        
        // Update data.unitTypes to only include valid units
        data.unitTypes = validUnits;
        
        for (let i = 0; i < data.unitTypes.length; i++) {
          const unit = data.unitTypes[i]
          
          // All images should already be in PDF cache
          const unitFloorPlanImage = unit.floorPlanImage || null

          // Build unit_images array: floor plan first, then renderings/interiors/balcony
          // ⭐ 高端楼书一个户型多页效果图（renderingImages/interiorImages）一并入库
          const unitImages: string[] = Array.from(new Set([
            ...(unitFloorPlanImage ? [unitFloorPlanImage] : []),
            ...(unit.floorPlanImages || []),
            ...(unit.renderingImages || []),
            ...(unit.interiorImages || []),
            ...(unit.balconyImages || []),
          ].filter(Boolean)))

          await client.query(`
            INSERT INTO project_unit_types (
              project_id,
              unit_type_name,
              category,
              type_code,
              unit_numbers,
              unit_count,
              bedrooms,
              bathrooms,
              area,
              balcony_area,
              built_up_area,
              price,
              price_per_sqft,
              orientation,
              features,
              description,
              floor_plan_image,
              unit_images,
              display_order,
              parking_spaces
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
            )
          `, [
            projectId,
            unit.name || `Unit Type ${i + 1}`,
            unit.category || null,
            unit.typeName || null,
            unit.unitNumbers || [],
            unit.unitCount || 1,
            unit.bedrooms,
            unit.bathrooms,
            unit.area,
            unit.balconyArea || null,
            unit.suiteArea || null,  // ⭐ Use suiteArea from frontend (interior/built-up area)
            unit.price || null,
            unit.pricePerSqft || null,
            unit.orientation || null,
            unit.features || [],
            unit.description || null,  // ⭐ AI-generated marketing description
            unitFloorPlanImage || null, // Use migrated URL (backwards compatibility)
            unitImages, // Floor plan + additional images array
            i,  // display_order
            (unit as any).parkingSpaces ?? null,  // ⭐ Parking allocation from text-layer inventory
          ])
        }
        console.log('✅ Unit types inserted')
      }

      // Payment plan is already stored in the main project INSERT as JSONB

      await client.query('COMMIT')
      console.log('🎉 Transaction committed successfully')
      
      // Note: R2 temporary files will be auto-cleaned by the daily cleanup script
      // No manual cleanup needed here

      const response: SubmitProjectResponse = {
        success: true,
        projectId,
        message: 'Project submitted successfully',
      }

      res.json(response)
    } catch (error) {
      await client.query('ROLLBACK')
      console.error('❌ Error submitting project:', error)
      res.status(500).json({
        success: false,
        error: 'Failed to submit project',
        message: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      client.release()
    }
  })

  // ============================================================================
  // GET /api/residential-projects/:id
  // Get a single project with all details
  // ============================================================================
  router.get('/:id', async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params

      // Get project details
      const projectResult = await pool.query(
        'SELECT * FROM residential_projects WHERE id = $1',
        [id]
      )

      if (projectResult.rows.length === 0) {
        res.status(404).json({ success: false, error: 'Project not found' })
        return
      }

      // Get unit types
      const unitTypesResult = await pool.query(
        'SELECT * FROM project_unit_types WHERE project_id = $1 ORDER BY display_order',
        [id]
      )

      const project = projectResult.rows[0]
      const units = unitTypesResult.rows

      // payment_plan is already stored as JSONB in the project row
      res.json({
        success: true,
        project: {
          ...project,
          units,
          // payment_plan is already in project from the SELECT *
        },
      })
    } catch (error) {
      console.error('Error fetching project:', error)
      res.status(500).json({
        success: false,
        error: 'Failed to fetch project',
        message: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  })

  // ============================================================================
  // PUT /api/residential-projects/:id
  // Update an existing residential project (full update of all fields)
  // Requires authentication
  // ============================================================================
  router.put('/:id', requireAuth, requireUploader, async (req: Request, res: Response) => {
    const client = await pool.connect()
    
    try {
      await client.query('BEGIN')

      const { id } = req.params
      const data: SubmitProjectRequest = req.body

      console.log('📝 Updating residential project ID:', id)
      console.log('📊 Data summary:')
      console.log('   - Unit types:', data.unitTypes?.length || 0)
      console.log('   - Payment plan milestones:', data.paymentPlan?.length || 0)
      console.log('   - Project images:', data.projectImages?.length || 0)
      console.log('   - Floor plan images:', data.floorPlanImages?.length || 0)

      // Check if project exists
      const existingProject = await client.query(
        'SELECT id FROM residential_projects WHERE id = $1',
        [id]
      )

      if (existingProject.rows.length === 0) {
        await client.query('ROLLBACK')
        res.status(404).json({
          success: false,
          error: 'Project not found',
        })
        return
      }

      // Validate images
      const projectImages = data.projectImages || []
      const floorPlanImages = data.floorPlanImages || []
      
      const validateImages = (images: string[], type: string) => {
        images.forEach((url, idx) => {
          if (!isR2PdfCacheUrl(url)) {
            console.warn(`⚠️ ${type} image ${idx + 1} is not from PDF cache: ${url.substring(0, 80)}...`)
          }
        })
      }
      
      validateImages(projectImages, 'Project')
      validateImages(floorPlanImages, 'Floor plan')

      // 1. Update main project (including payment_plan as JSONB)
      const paymentPlanJson = transformPaymentPlanToJson(data.paymentPlan)
      console.log(`💰 Payment plan: ${paymentPlanJson.length} milestones`)

      await client.query(`
        UPDATE residential_projects SET
          project_name = $1,
          developer = $2,
          address = $3,
          area = $4,
          description = $5,
          latitude = $6,
          longitude = $7,
          launch_date = $8,
          completion_date = $9,
          handover_date = $10,
          construction_progress = $11,
          project_images = $12,
          floor_plan_images = $13,
          primary_image = $14,
          status = $15,
          amenities = $16,
          has_renderings = $17,
          has_floor_plans = $18,
          has_location_maps = $19,
          rendering_descriptions = $20,
          floor_plan_descriptions = $21,
          payment_plan = $22,
          updated_at = NOW()
        WHERE id = $23
      `, [
        data.projectName,
        data.developer,
        data.address,
        data.area || null,  // area 可空：坐标不在任何区域内属合法状态
        data.description || '',
        data.latitude || null,
        data.longitude || null,
        cleanDateFormat(data.launchDate),
        cleanDateFormat(data.completionDate),
        cleanDateFormat(data.handoverDate),
        data.constructionProgress || null,
        projectImages,
        floorPlanImages,
        data.primaryImage || null,
        data.status || 'upcoming',
        data.amenities || [],
        data.visualContent?.hasRenderings || false,
        data.visualContent?.hasFloorPlans || false,
        data.visualContent?.hasLocationMaps || false,
        data.visualContent?.renderingDescriptions || [],
        data.visualContent?.floorPlanDescriptions || [],
        JSON.stringify(paymentPlanJson),
        id,
      ])

      console.log('✅ Project main data updated (including payment plan)')

      // 2. Handle unit types with UPSERT (preserve IDs, update existing, insert new, delete removed)
      if (data.unitTypes && Array.isArray(data.unitTypes)) {
        console.log(`📦 Processing ${data.unitTypes.length} unit types with UPSERT...`)

        // Validate and filter units
        const invalidUnits: string[] = []
        const validUnits: any[] = []

        for (const unit of data.unitTypes) {
          let isValid = true

          if (!unit.area || unit.area <= 0) {
            const unitName = unit.name || unit.typeName || 'Unknown'
            console.error(`   ❌ Invalid area for unit "${unitName}": ${unit.area}`)
            invalidUnits.push(unitName)
            isValid = false
          }

          if (isValid) {
            // Validate bathrooms
            if (!unit.bathrooms || unit.bathrooms <= 0) {
              const bedrooms = unit.bedrooms || 0
              if (bedrooms === 0) {
                unit.bathrooms = 1
              } else if (bedrooms === 1) {
                unit.bathrooms = 1
              } else if (bedrooms === 2) {
                unit.bathrooms = 2
              } else {
                unit.bathrooms = Math.min(bedrooms, 3)
              }
              console.warn(`   ⚠️  Invalid bathrooms for unit "${unit.name || unit.typeName}", estimated ${unit.bathrooms}`)
            }

            // Validate bedrooms
            if (unit.bedrooms < 0) {
              console.warn(`   ⚠️  Invalid bedrooms (${unit.bedrooms}), setting to 0`)
              unit.bedrooms = 0
            }

            validUnits.push(unit)
          }
        }

        if (invalidUnits.length > 0) {
          console.warn(`\n⚠️  FILTERED OUT ${invalidUnits.length} INVALID UNIT(S)`)
          console.warn(`✅ Proceeding with ${validUnits.length} valid unit(s)\n`)
        }

        // Get existing unit type IDs for this project
        const existingUnitsResult = await client.query(
          'SELECT id FROM project_unit_types WHERE project_id = $1',
          [id]
        )
        const existingIds = new Set(existingUnitsResult.rows.map((r: any) => r.id))
        const incomingIds = new Set(validUnits.filter(u => u.id).map(u => u.id))

        // Delete unit types that are no longer in the incoming data
        const idsToDelete = [...existingIds].filter(existingId => !incomingIds.has(existingId))
        if (idsToDelete.length > 0) {
          await client.query(
            'DELETE FROM project_unit_types WHERE id = ANY($1)',
            [idsToDelete]
          )
          console.log(`   🗑️  Deleted ${idsToDelete.length} removed unit types`)
        }

        // UPSERT each unit type
        let updatedCount = 0
        let insertedCount = 0

        for (let i = 0; i < validUnits.length; i++) {
          const unit = validUnits[i]

          const unitFloorPlanImage = unit.floorPlanImage || null
          // ⭐ unit_images = 平面图 + 户型效果图（外观/室内/阳台），去重保序
          const unitImages: string[] = Array.from(new Set([
            ...(unitFloorPlanImage ? [unitFloorPlanImage] : []),
            ...(unit.floorPlanImages || []),
            ...(unit.renderingImages || []),
            ...(unit.interiorImages || []),
            ...(unit.balconyImages || []),
          ].filter(Boolean)))

          // Check if this unit has a valid existing ID
          const hasExistingId = unit.id && existingIds.has(unit.id)

          if (hasExistingId) {
            // UPDATE existing unit type (preserves ID for favorites)
            await client.query(`
              UPDATE project_unit_types SET
                unit_type_name = $1,
                category = $2,
                type_code = $3,
                unit_numbers = $4,
                unit_count = $5,
                bedrooms = $6,
                bathrooms = $7,
                area = $8,
                balcony_area = $9,
                built_up_area = $10,
                price = $11,
                price_per_sqft = $12,
                orientation = $13,
                features = $14,
                description = $15,
                floor_plan_image = $16,
                unit_images = $17,
                display_order = $18,
                updated_at = NOW()
              WHERE id = $19
            `, [
              unit.name || `Unit Type ${i + 1}`,
              unit.category || null,
              unit.typeName || null,
              unit.unitNumbers || [],
              unit.unitCount || 1,
              unit.bedrooms,
              unit.bathrooms,
              unit.area,
              unit.balconyArea || null,
              unit.suiteArea || null,
              unit.price || null,
              unit.pricePerSqft || null,
              unit.orientation || null,
              unit.features || [],
              unit.description || null,
              unitFloorPlanImage || null,
              unitImages,
              i,
              unit.id,
            ])
            updatedCount++
          } else {
            // INSERT new unit type
            await client.query(`
              INSERT INTO project_unit_types (
                project_id,
                unit_type_name,
                category,
                type_code,
                unit_numbers,
                unit_count,
                bedrooms,
                bathrooms,
                area,
                balcony_area,
                built_up_area,
                price,
                price_per_sqft,
                orientation,
                features,
                description,
                floor_plan_image,
                unit_images,
                display_order
              ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
              )
            `, [
              id,
              unit.name || `Unit Type ${i + 1}`,
              unit.category || null,
              unit.typeName || null,
              unit.unitNumbers || [],
              unit.unitCount || 1,
              unit.bedrooms,
              unit.bathrooms,
              unit.area,
              unit.balconyArea || null,
              unit.suiteArea || null,
              unit.price || null,
              unit.pricePerSqft || null,
              unit.orientation || null,
              unit.features || [],
              unit.description || null,
              unitFloorPlanImage || null,
              unitImages,
              i,
            ])
            insertedCount++
          }
        }
        console.log(`✅ Unit types processed: ${updatedCount} updated, ${insertedCount} inserted`)
      } else {
        // No unit types provided, delete all existing
        await client.query('DELETE FROM project_unit_types WHERE project_id = $1', [id])
        console.log('✅ All unit types deleted (none provided)')
      }

      // Payment plan is already updated in the main UPDATE query as JSONB

      await client.query('COMMIT')
      console.log('🎉 Project updated successfully')
      invalidateProjectInsights(id) // 价格/户型可能变了,别让详情页 insights 端 7h 旧缓存

      res.json({
        success: true,
        message: 'Project updated successfully',
        projectId: id,
      })
    } catch (error) {
      await client.query('ROLLBACK')
      console.error('❌ Error updating project:', error)
      res.status(500).json({
        success: false,
        error: 'Failed to update project',
        message: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      client.release()
    }
  })

  // ============================================================================
  // DELETE /api/residential-projects/:id
  // Delete a project (cascades to unit types and payment plans)
  // Requires authentication
  // ============================================================================
  router.delete('/:id', requireAuth, requireUploader, async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params

      const result = await pool.query(
        'DELETE FROM residential_projects WHERE id = $1 RETURNING id',
        [id]
      )

      if (result.rows.length === 0) {
        res.status(404).json({ error: 'Project not found' })
        return
      }

      res.json({
        success: true,
        message: 'Project deleted successfully',
      })
    } catch (error) {
      console.error('Error deleting project:', error)
      res.status(500).json({
        error: 'Failed to delete project',
        message: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  })

  // ============================================================================
  // GET /api/residential-projects
  // List all projects with pagination and filters
  // ============================================================================
  router.get('/', async (req: Request, res: Response) => {
    try {
      const {
        page = '1',
        limit = '20',
        area,
        developer,
        minPrice,
        maxPrice,
        minBeds,
        maxBeds,
        status,
        verified = 'true',
      } = req.query

      const pageNum = parseInt(page as string)
      const limitNum = parseInt(limit as string)
      const offset = (pageNum - 1) * limitNum

      // Build WHERE clause
      const conditions: string[] = []
      const params: any[] = []
      let paramIndex = 1

      if (verified !== 'all') {
        conditions.push(`verified = $${paramIndex}`)
        params.push(verified === 'true')
        paramIndex++
      }

      if (area) {
        conditions.push(`area = $${paramIndex}`)
        params.push(area)
        paramIndex++
      }

      if (developer) {
        conditions.push(`developer = $${paramIndex}`)
        params.push(developer)
        paramIndex++
      }

      if (minPrice) {
        conditions.push(`starting_price >= $${paramIndex}`)
        params.push(parseFloat(minPrice as string))
        paramIndex++
      }

      if (maxPrice) {
        conditions.push(`starting_price <= $${paramIndex}`)
        params.push(parseFloat(maxPrice as string))
        paramIndex++
      }

      if (minBeds) {
        conditions.push(`max_bedrooms >= $${paramIndex}`)
        params.push(parseInt(minBeds as string))
        paramIndex++
      }

      if (maxBeds) {
        conditions.push(`min_bedrooms <= $${paramIndex}`)
        params.push(parseInt(maxBeds as string))
        paramIndex++
      }

      if (status) {
        conditions.push(`status = $${paramIndex}`)
        params.push(status)
        paramIndex++
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

      // Get total count
      const countResult = await pool.query(
        `SELECT COUNT(*) FROM residential_projects ${whereClause}`,
        params
      )
      const total = parseInt(countResult.rows[0].count)

      // Get projects with unit count
      const projectsResult = await pool.query(
        `SELECT 
          rp.*,
          COUNT(DISTINCT put.id) as unit_count
         FROM residential_projects rp
         LEFT JOIN project_unit_types put ON rp.id = put.project_id
         ${whereClause}
         GROUP BY rp.id
         ORDER BY rp.created_at DESC
         LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        [...params, limitNum, offset]
      )

      const response: ListProjectsResponse = {
        projects: projectsResult.rows,
        total,
        page: pageNum,
        limit: limitNum,
      }

      res.json(response)
    } catch (error) {
      console.error('Error listing projects:', error)
      res.status(500).json({
        error: 'Failed to list projects',
        message: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  })

  return router
}

export default createResidentialProjectsRouter
