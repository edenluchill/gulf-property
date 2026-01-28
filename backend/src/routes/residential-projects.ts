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

/**
 * Validate and clean date format for PostgreSQL (must be YYYY-MM-DD or null)
 */
function cleanDateFormat(dateStr: string | undefined | null): string | null {
  if (!dateStr) return null
  
  // Check if it's already a valid YYYY-MM-DD format
  const validDatePattern = /^\d{4}-\d{2}-\d{2}$/
  if (validDatePattern.test(dateStr)) {
    return dateStr
  }
  
  // If it's an incomplete date (e.g., "2030-06" or "2030-Q4"), return null
  console.warn(`⚠️ Invalid date format detected: "${dateStr}", skipping it`)
  return null
}

export function createResidentialProjectsRouter(pool: Pool): Router {
  const router = Router()

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
  // ============================================================================
  router.post('/submit', async (req: Request, res: Response) => {
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

      // 1. Insert main project
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
          amenities,
          has_renderings,
          has_floor_plans,
          has_location_maps,
          rendering_descriptions,
          floor_plan_descriptions,
          verified,
          status
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21
        )
        RETURNING id
      `, [
        data.projectName,
        data.developer,
        data.address,
        data.area,
        data.description || '',
        data.latitude || null,
        data.longitude || null,
        data.launchDate || null,
        data.completionDate || null,
        data.handoverDate || null,
        data.constructionProgress || null,
        finalProjectImages, // Use migrated URLs
        finalFloorPlanImages, // Use migrated URLs
        data.amenities || [],
        data.visualContent?.hasRenderings || false,
        data.visualContent?.hasFloorPlans || false,
        data.visualContent?.hasLocationMaps || false,
        data.visualContent?.renderingDescriptions || [],
        data.visualContent?.floorPlanDescriptions || [],
        true,  // Auto-verify for now (no approval workflow)
        'upcoming',  // Default status
      ])

      const projectId = projectResult.rows[0].id
      console.log('✅ Project created with ID:', projectId)

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
          
          // Build unit_images array: floor plan first, then any additional images
          const unitImages: string[] = []
          if (unitFloorPlanImage) {
            unitImages.push(unitFloorPlanImage)
          }
          // TODO: Add support for additional unit images from frontend if needed

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
          ])
        }
        console.log('✅ Unit types inserted')
      }

      // 3. Insert payment plan with interval calculation
      if (data.paymentPlan && Array.isArray(data.paymentPlan) && data.paymentPlan.length > 0) {
        console.log(`💰 Inserting ${data.paymentPlan.length} payment milestones...`)
        
        for (let i = 0; i < data.paymentPlan.length; i++) {
          const milestone = data.paymentPlan[i]
          
          // Clean date format before inserting
          const cleanedDate = cleanDateFormat(milestone.date)
          
          // Auto-calculate interval if not provided by AI
          let intervalMonths = milestone.intervalMonths
          let intervalDescription = milestone.intervalDescription
          
          if (intervalMonths === undefined && i > 0 && cleanedDate && data.paymentPlan[i - 1].date) {
            // Calculate months between current and previous milestone
            const prevDate = cleanDateFormat(data.paymentPlan[i - 1].date)
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
            // First milestone defaults to 0
            intervalMonths = 0
            if (!intervalDescription) {
              intervalDescription = 'At booking'
            }
          }
          
          await client.query(`
            INSERT INTO project_payment_plans (
              project_id,
              milestone_name,
              percentage,
              milestone_date,
              interval_months,
              interval_description,
              display_order
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          `, [
            projectId,
            milestone.milestone,
            milestone.percentage,
            cleanedDate,
            intervalMonths,
            intervalDescription,
            i,
          ])
        }
        console.log('✅ Payment plan inserted with intervals')
      }

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

      // Get payment plan
      const paymentPlanResult = await pool.query(
        'SELECT * FROM project_payment_plans WHERE project_id = $1 ORDER BY display_order',
        [id]
      )

      const project = projectResult.rows[0]
      const units = unitTypesResult.rows

      res.json({
        success: true,
        project: {
          ...project,
          units,
          payment_plan: paymentPlanResult.rows,
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
  // ============================================================================
  router.put('/:id', async (req: Request, res: Response) => {
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

      // 1. Update main project
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
          amenities = $14,
          has_renderings = $15,
          has_floor_plans = $16,
          has_location_maps = $17,
          rendering_descriptions = $18,
          floor_plan_descriptions = $19,
          updated_at = NOW()
        WHERE id = $20
      `, [
        data.projectName,
        data.developer,
        data.address,
        data.area,
        data.description || '',
        data.latitude || null,
        data.longitude || null,
        data.launchDate || null,
        data.completionDate || null,
        data.handoverDate || null,
        data.constructionProgress || null,
        projectImages,
        floorPlanImages,
        data.amenities || [],
        data.visualContent?.hasRenderings || false,
        data.visualContent?.hasFloorPlans || false,
        data.visualContent?.hasLocationMaps || false,
        data.visualContent?.renderingDescriptions || [],
        data.visualContent?.floorPlanDescriptions || [],
        id,
      ])

      console.log('✅ Project main data updated')

      // 2. Delete existing unit types and payment plans (cascading)
      await client.query('DELETE FROM project_unit_types WHERE project_id = $1', [id])
      await client.query('DELETE FROM project_payment_plans WHERE project_id = $1', [id])
      console.log('✅ Existing unit types and payment plans deleted')

      // 3. Insert new unit types
      if (data.unitTypes && Array.isArray(data.unitTypes) && data.unitTypes.length > 0) {
        console.log(`📦 Inserting ${data.unitTypes.length} unit types...`)
        
        // Validate and filter units
        const invalidUnits: string[] = []
        const validUnits = []
        
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
        
        for (let i = 0; i < validUnits.length; i++) {
          const unit = validUnits[i]
          
          const unitFloorPlanImage = unit.floorPlanImage || null
          const unitImages: string[] = []
          if (unitFloorPlanImage) {
            unitImages.push(unitFloorPlanImage)
          }

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
        }
        console.log('✅ Unit types inserted')
      }

      // 4. Insert new payment plan
      if (data.paymentPlan && Array.isArray(data.paymentPlan) && data.paymentPlan.length > 0) {
        console.log(`💰 Inserting ${data.paymentPlan.length} payment milestones...`)
        
        for (let i = 0; i < data.paymentPlan.length; i++) {
          const milestone = data.paymentPlan[i]
          
          const cleanedDate = cleanDateFormat(milestone.date)
          
          let intervalMonths = milestone.intervalMonths
          let intervalDescription = milestone.intervalDescription
          
          if (intervalMonths === undefined && i > 0 && cleanedDate && data.paymentPlan[i - 1].date) {
            const prevDate = cleanDateFormat(data.paymentPlan[i - 1].date)
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
          
          await client.query(`
            INSERT INTO project_payment_plans (
              project_id,
              milestone_name,
              percentage,
              milestone_date,
              interval_months,
              interval_description,
              display_order
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          `, [
            id,
            milestone.milestone,
            milestone.percentage,
            cleanedDate,
            intervalMonths,
            intervalDescription,
            i,
          ])
        }
        console.log('✅ Payment plan inserted')
      }

      await client.query('COMMIT')
      console.log('🎉 Project updated successfully')

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
  // ============================================================================
  router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
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
