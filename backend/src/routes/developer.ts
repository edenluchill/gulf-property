import { Router, Request, Response } from 'express'
import { Pool } from 'pg'
import multer from 'multer'
import { processPdfWithGemini } from '../services/pdf-processor-gemini'

const router = Router()

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true)
    } else {
      cb(new Error('Only PDF files are allowed'))
    }
  },
})

export function createDeveloperRouter(pool: Pool): Router {
  
  // POST /api/developer/process-pdf
  // Upload PDF and extract data using AI
  router.post('/process-pdf', upload.single('pdf'), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No PDF file uploaded' })
      }

      console.log('Processing PDF:', req.file.originalname, 'Size:', req.file.size)

      // Process PDF with Gemini AI to extract structured data
      const extractedData = await processPdfWithGemini(req.file.buffer, req.file.originalname)

      res.json(extractedData)
    } catch (error) {
      console.error('Error processing PDF:', error)
      res.status(500).json({ 
        error: 'Failed to process PDF',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  })

  // POST /api/developer/submit-property
  // Submit a new property to the database
  router.post('/submit-property', async (req: Request, res: Response) => {
    const client = await pool.connect()
    
    try {
      await client.query('BEGIN')

      const {
        projectName,
        developer,
        address,
        latitude,
        longitude,
        minPrice,
        maxPrice,
        minArea,
        maxArea,
        minBedrooms,
        maxBedrooms,
        launchDate,
        completionDate,
        description,
        amenities,
        unitTypes,
        paymentPlan,
        images
      } = req.body

      // Insert main property submission
      const propertyResult = await client.query(`
        INSERT INTO developer_property_submissions (
          project_name,
          developer,
          address,
          latitude,
          longitude,
          min_price,
          max_price,
          min_area,
          max_area,
          min_bedrooms,
          max_bedrooms,
          launch_date,
          completion_date,
          description,
          amenities,
          showcase_images,
          floorplan_images,
          amenity_images,
          status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, 'pending')
        RETURNING id
      `, [
        projectName,
        developer,
        address,
        latitude,
        longitude,
        minPrice,
        maxPrice,
        minArea,
        maxArea,
        minBedrooms,
        maxBedrooms,
        launchDate || null,
        completionDate || null,
        description,
        amenities || [],
        images?.showcase || [],
        images?.floorplans || [],
        images?.amenities || []
      ])

      const submissionId = propertyResult.rows[0].id

      // Insert unit types
      if (unitTypes && Array.isArray(unitTypes)) {
        for (const unit of unitTypes) {
          await client.query(`
            INSERT INTO developer_submission_unit_types (
              submission_id,
              name,
              min_area,
              max_area,
              min_price,
              max_price,
              bedrooms,
              bathrooms
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `, [
            submissionId,
            unit.name,
            unit.minArea,
            unit.maxArea,
            unit.minPrice,
            unit.maxPrice,
            unit.bedrooms,
            unit.bathrooms
          ])
        }
      }

      // Insert payment plan
      if (paymentPlan && Array.isArray(paymentPlan)) {
        for (let i = 0; i < paymentPlan.length; i++) {
          const milestone = paymentPlan[i]
          await client.query(`
            INSERT INTO developer_submission_payment_plans (
              submission_id,
              milestone,
              percentage,
              payment_date,
              sequence_order
            ) VALUES ($1, $2, $3, $4, $5)
          `, [
            submissionId,
            milestone.milestone,
            milestone.percentage,
            milestone.date || null,
            i
          ])
        }
      }

      await client.query('COMMIT')

      res.json({ 
        success: true,
        submissionId,
        message: 'Property submitted successfully' 
      })
    } catch (error) {
      await client.query('ROLLBACK')
      console.error('Error submitting property:', error)
      res.status(500).json({ 
        error: 'Failed to submit property',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    } finally {
      client.release()
    }
  })

  // GET /api/developer/submissions
  // Get all developer submissions (for admin review)
  router.get('/submissions', async (req: Request, res: Response) => {
    try {
      const { status, limit = 50, offset = 0 } = req.query

      let query = `
        SELECT 
          s.*,
          json_agg(DISTINCT jsonb_build_object(
            'id', u.id,
            'name', u.name,
            'minArea', u.min_area,
            'maxArea', u.max_area,
            'minPrice', u.min_price,
            'maxPrice', u.max_price,
            'bedrooms', u.bedrooms,
            'bathrooms', u.bathrooms
          )) FILTER (WHERE u.id IS NOT NULL) as unit_types,
          json_agg(DISTINCT jsonb_build_object(
            'id', p.id,
            'milestone', p.milestone,
            'percentage', p.percentage,
            'date', p.payment_date,
            'order', p.sequence_order
          ) ORDER BY p.sequence_order) FILTER (WHERE p.id IS NOT NULL) as payment_plan
        FROM developer_property_submissions s
        LEFT JOIN developer_submission_unit_types u ON s.id = u.submission_id
        LEFT JOIN developer_submission_payment_plans p ON s.id = p.submission_id
      `

      const params: any[] = []
      
      if (status) {
        query += ` WHERE s.status = $1`
        params.push(status)
      }

      query += ` GROUP BY s.id ORDER BY s.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`
      params.push(limit, offset)

      const result = await pool.query(query, params)

      res.json({
        submissions: result.rows,
        total: result.rowCount
      })
    } catch (error) {
      console.error('Error fetching submissions:', error)
      res.status(500).json({ 
        error: 'Failed to fetch submissions',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  })

  // GET /api/developer/submissions/:id
  // Get a single submission by ID
  router.get('/submissions/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params

      const result = await pool.query(`
        SELECT 
          s.*,
          json_agg(DISTINCT jsonb_build_object(
            'id', u.id,
            'name', u.name,
            'minArea', u.min_area,
            'maxArea', u.max_area,
            'minPrice', u.min_price,
            'maxPrice', u.max_price,
            'bedrooms', u.bedrooms,
            'bathrooms', u.bathrooms
          )) FILTER (WHERE u.id IS NOT NULL) as unit_types,
          json_agg(DISTINCT jsonb_build_object(
            'id', p.id,
            'milestone', p.milestone,
            'percentage', p.percentage,
            'date', p.payment_date,
            'order', p.sequence_order
          ) ORDER BY p.sequence_order) FILTER (WHERE p.id IS NOT NULL) as payment_plan
        FROM developer_property_submissions s
        LEFT JOIN developer_submission_unit_types u ON s.id = u.submission_id
        LEFT JOIN developer_submission_payment_plans p ON s.id = p.submission_id
        WHERE s.id = $1
        GROUP BY s.id
      `, [id])

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Submission not found' })
      }

      res.json(result.rows[0])
    } catch (error) {
      console.error('Error fetching submission:', error)
      res.status(500).json({ 
        error: 'Failed to fetch submission',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  })

  // PATCH /api/developer/submissions/:id/status
  // Update submission status (approve/reject)
  router.patch('/submissions/:id/status', async (req: Request, res: Response) => {
    try {
      const { id } = req.params
      const { status, rejectionReason, reviewedBy } = req.body

      if (!['pending', 'approved', 'rejected'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' })
      }

      const result = await pool.query(`
        UPDATE developer_property_submissions
        SET 
          status = $1,
          rejection_reason = $2,
          reviewed_by = $3,
          reviewed_at = CURRENT_TIMESTAMP
        WHERE id = $4
        RETURNING *
      `, [status, rejectionReason || null, reviewedBy || null, id])

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Submission not found' })
      }

      res.json(result.rows[0])
    } catch (error) {
      console.error('Error updating submission status:', error)
      res.status(500).json({ 
        error: 'Failed to update submission status',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  })

  return router
}

export default createDeveloperRouter
