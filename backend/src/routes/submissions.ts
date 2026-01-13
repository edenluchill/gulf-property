import { Router, Request, Response } from 'express'
import { body, validationResult } from 'express-validator'
import pool from '../db/pool'

const router = Router()

// Submit new project
router.post(
  '/',
  [
    body('projectName').trim().notEmpty().withMessage('Project name is required'),
    body('developerName').trim().notEmpty().withMessage('Developer name is required'),
    body('location').trim().notEmpty().withMessage('Location is required'),
    body('district').trim().notEmpty().withMessage('District is required'),
    body('minPrice').isNumeric().withMessage('Minimum price must be a number'),
    body('maxPrice').isNumeric().withMessage('Maximum price must be a number'),
    body('completionDate').isISO8601().withMessage('Invalid completion date'),
    body('contactEmail').isEmail().withMessage('Valid email is required'),
    body('contactPhone').trim().notEmpty().withMessage('Phone number is required'),
    body('description').trim().notEmpty().withMessage('Description is required'),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      })
    }

    try {
      const {
        projectName,
        developerName,
        location,
        district,
        minPrice,
        maxPrice,
        completionDate,
        contactEmail,
        contactPhone,
        description
      } = req.body

      const result = await pool.query(
        `INSERT INTO developer_submissions 
         (project_name, developer_name, location, district, min_price, max_price, 
          completion_date, contact_email, contact_phone, description)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id, created_at`,
        [
          projectName,
          developerName,
          location,
          district,
          minPrice,
          maxPrice,
          completionDate,
          contactEmail,
          contactPhone,
          description
        ]
      )

      res.status(201).json({
        success: true,
        message: 'Project submission received successfully',
        data: {
          id: result.rows[0].id,
          submittedAt: result.rows[0].created_at
        }
      })
    } catch (error) {
      console.error('Error submitting project:', error)
      res.status(500).json({
        success: false,
        error: 'Failed to submit project'
      })
    }
  }
)

// Get all submissions (admin only - you'd add auth middleware here)
router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT * FROM developer_submissions ORDER BY created_at DESC'
    )

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    })
  } catch (error) {
    console.error('Error fetching submissions:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to fetch submissions'
    })
  }
})

export default router
