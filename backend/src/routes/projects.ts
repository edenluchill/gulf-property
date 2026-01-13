import { Router, Request, Response } from 'express'
import { body, query, validationResult } from 'express-validator'
import pool from '../db/pool'
import { ProjectFilters } from '../types'

const router = Router()

// Get all projects with filters
router.get('/', async (req: Request, res: Response) => {
  try {
    const {
      developer,
      district,
      minPrice,
      maxPrice,
      completionDateStart,
      completionDateEnd,
      status
    } = req.query as any

    let queryText = `
      SELECT * FROM projects 
      WHERE verified = true
    `
    const queryParams: any[] = []
    let paramCount = 1

    if (developer) {
      queryText += ` AND developer = $${paramCount}`
      queryParams.push(developer)
      paramCount++
    }

    if (district) {
      queryText += ` AND location->>'district' = $${paramCount}`
      queryParams.push(district)
      paramCount++
    }

    if (minPrice || maxPrice) {
      if (minPrice) {
        queryText += ` AND (price->>'max')::numeric >= $${paramCount}`
        queryParams.push(minPrice)
        paramCount++
      }
      if (maxPrice) {
        queryText += ` AND (price->>'min')::numeric <= $${paramCount}`
        queryParams.push(maxPrice)
        paramCount++
      }
    }

    if (completionDateEnd) {
      queryText += ` AND completion_date <= $${paramCount}`
      queryParams.push(completionDateEnd)
      paramCount++
    }

    if (status) {
      queryText += ` AND status = $${paramCount}`
      queryParams.push(status)
      paramCount++
    }

    queryText += ' ORDER BY created_at DESC'

    const result = await pool.query(queryText, queryParams)
    
    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    })
  } catch (error) {
    console.error('Error fetching projects:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to fetch projects'
    })
  }
})

// Get single project by ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params

    const result = await pool.query(
      'SELECT * FROM projects WHERE id = $1 AND verified = true',
      [id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Project not found'
      })
    }

    res.json({
      success: true,
      data: result.rows[0]
    })
  } catch (error) {
    console.error('Error fetching project:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to fetch project'
    })
  }
})

// Get unique developers
router.get('/meta/developers', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT DISTINCT developer FROM projects WHERE verified = true ORDER BY developer'
    )

    res.json({
      success: true,
      data: result.rows.map(row => row.developer)
    })
  } catch (error) {
    console.error('Error fetching developers:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to fetch developers'
    })
  }
})

// Get unique districts
router.get('/meta/districts', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      "SELECT DISTINCT location->>'district' as district FROM projects WHERE verified = true ORDER BY district"
    )

    res.json({
      success: true,
      data: result.rows.map(row => row.district)
    })
  } catch (error) {
    console.error('Error fetching districts:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to fetch districts'
    })
  }
})

export default router
