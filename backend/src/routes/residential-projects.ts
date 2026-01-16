/**
 * Residential Projects API Routes
 * Handles developer-submitted projects with AI-extracted data
 */

import { Router, Request, Response } from 'express'
import { Pool } from 'pg'
import {
  SubmitProjectRequest,
  SubmitProjectResponse,
  GetProjectResponse,
  ListProjectsResponse,
} from '../types/residential-projects'
import { moveMultipleToR2Permanent, isR2TempUrl } from '../services/r2-storage'

export function createResidentialProjectsRouter(pool: Pool): Router {
  const router = Router()

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

      // 0. Move images from temp to permanent R2 storage
      let projectImages = data.projectImages || []
      let floorPlanImages = data.floorPlanImages || []
      
      // Check if we have temp images that need to be moved
      const hasTempProjectImages = projectImages.some(url => isR2TempUrl(url))
      const hasTempFloorPlanImages = floorPlanImages.some(url => isR2TempUrl(url))
      
      if (hasTempProjectImages || hasTempFloorPlanImages) {
        // Generate temporary project ID for image migration
        const tempProjectId = `temp_${Date.now()}`
        
        console.log('🔄 Moving images from temp to permanent storage...')
        
        if (hasTempProjectImages) {
          console.log(`   Moving ${projectImages.length} project images...`)
          projectImages = await moveMultipleToR2Permanent(projectImages, tempProjectId)
        }
        
        if (hasTempFloorPlanImages) {
          console.log(`   Moving ${floorPlanImages.length} floor plan images...`)
          floorPlanImages = await moveMultipleToR2Permanent(floorPlanImages, tempProjectId)
        }
        
        console.log('✅ Images moved to permanent storage')
      }

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
        projectImages, // Use migrated URLs
        floorPlanImages, // Use migrated URLs
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
        
        for (let i = 0; i < data.unitTypes.length; i++) {
          const unit = data.unitTypes[i]
          
          // Move unit floor plan image if it's a temp URL
          let unitFloorPlanImage = unit.floorPlanImage
          if (unitFloorPlanImage && isR2TempUrl(unitFloorPlanImage)) {
            console.log(`   Moving floor plan for unit ${unit.name}...`)
            const migrated = await moveMultipleToR2Permanent([unitFloorPlanImage], projectId)
            unitFloorPlanImage = migrated[0]
          }
          
          // Extract tower from typeName if not provided
          let tower = unit.tower
          if (!tower && unit.typeName) {
            const matchWithHyphen = unit.typeName.match(/^([A-Z]+)-/)
            const matchLettersOnly = unit.typeName.match(/^([A-Z]+)$/)
            const matchBeforeDigits = unit.typeName.match(/^([A-Z]+)[\d(]/)
            
            if (matchWithHyphen) {
              tower = matchWithHyphen[1]
            } else if (matchLettersOnly) {
              tower = matchLettersOnly[1]
            } else if (matchBeforeDigits) {
              tower = matchBeforeDigits[1]
            }
          }

          await client.query(`
            INSERT INTO project_unit_types (
              project_id,
              unit_type_name,
              category,
              type_code,
              tower,
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
              floor_plan_image,
              display_order
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
            )
          `, [
            projectId,
            unit.name || `Unit Type ${i + 1}`,
            unit.category || null,
            unit.typeName || null,
            tower || null,
            unit.unitNumbers || [],
            unit.unitCount || 1,
            unit.bedrooms,
            unit.bathrooms,
            unit.area,
            unit.balconyArea || null,
            null,  // built_up_area - can be calculated if needed
            unit.price || null,
            unit.pricePerSqft || null,
            unit.orientation || null,
            unit.features || [],
            unitFloorPlanImage || null, // Use migrated URL
            i,  // display_order
          ])
        }
        console.log('✅ Unit types inserted')
      }

      // 3. Insert payment plan
      if (data.paymentPlan && Array.isArray(data.paymentPlan) && data.paymentPlan.length > 0) {
        console.log(`💰 Inserting ${data.paymentPlan.length} payment milestones...`)
        
        for (let i = 0; i < data.paymentPlan.length; i++) {
          const milestone = data.paymentPlan[i]
          
          await client.query(`
            INSERT INTO project_payment_plans (
              project_id,
              milestone_name,
              percentage,
              milestone_date,
              display_order
            ) VALUES ($1, $2, $3, $4, $5)
          `, [
            projectId,
            milestone.milestone,
            milestone.percentage,
            milestone.date || null,
            i,
          ])
        }
        console.log('✅ Payment plan inserted')
      }

      await client.query('COMMIT')
      console.log('🎉 Transaction committed successfully')

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
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params

      // Get project details
      const projectResult = await pool.query(
        'SELECT * FROM residential_projects WHERE id = $1',
        [id]
      )

      if (projectResult.rows.length === 0) {
        return res.status(404).json({ error: 'Project not found' })
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

      const response: GetProjectResponse = {
        project: projectResult.rows[0],
        unitTypes: unitTypesResult.rows,
        paymentPlan: paymentPlanResult.rows,
      }

      res.json(response)
    } catch (error) {
      console.error('Error fetching project:', error)
      res.status(500).json({
        error: 'Failed to fetch project',
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

      // Get projects
      const projectsResult = await pool.query(
        `SELECT * FROM residential_projects 
         ${whereClause}
         ORDER BY created_at DESC
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

  // ============================================================================
  // DELETE /api/residential-projects/:id
  // Delete a project (cascades to unit types and payment plans)
  // ============================================================================
  router.delete('/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params

      const result = await pool.query(
        'DELETE FROM residential_projects WHERE id = $1 RETURNING id',
        [id]
      )

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Project not found' })
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

  return router
}

export default createResidentialProjectsRouter
