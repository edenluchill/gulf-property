import { Router, Request, Response } from 'express'
import { Pool } from 'pg'
import { analyzeProperties } from '../services/property-analyzer'

const router = Router()

interface ComparisonItem {
  projectId: string
  unitTypeId?: string
}

interface UserProfile {
  familyStatus: string
  purpose: string
  hasChildren?: boolean
  childrenAges?: string
  investmentHorizon?: string
  riskTolerance?: string
  workLocation?: string
  schoolPreference?: boolean
  budget?: { min: number; max: number }
}

interface ComparisonPropertyData {
  id: string
  projectId: string
  unitTypeId?: string
  projectName: string
  developer: string
  area: string
  address: string
  unitTypeName?: string
  bedrooms: number
  bathrooms?: string
  size: number
  price: number
  pricePerSqft?: number
  completionDate?: string
  status: string
  constructionProgress?: number
  amenities: string[]
  paymentPlan?: {
    downPayment: number
    duringConstruction: number
    onHandover: number
  }
  imageUrl?: string
}

export function createCompareRouter(pool: Pool): Router {

  // POST /api/compare/analyze
  // Analyze and compare properties using AI
  router.post('/analyze', async (req: Request, res: Response): Promise<void> => {
    try {
      const { items, properties, profile, language } = req.body as {
        items: ComparisonItem[]
        properties: ComparisonPropertyData[]
        profile: UserProfile
        language?: string // 'en' | 'zh-CN' etc.
      }

      // Validate input
      if (!items || items.length < 2) {
        res.status(400).json({
          success: false,
          error: 'At least 2 items required for comparison'
        })
        return
      }

      if (items.length > 4) {
        res.status(400).json({
          success: false,
          error: 'Maximum 4 items allowed for comparison'
        })
        return
      }

      if (!properties || properties.length < 2) {
        res.status(400).json({
          success: false,
          error: 'Property data required for comparison'
        })
        return
      }

      if (properties.length > 4) {
        res.status(400).json({
          success: false,
          error: 'Maximum 4 properties allowed for comparison'
        })
        return
      }

      if (!profile) {
        res.status(400).json({
          success: false,
          error: 'User profile required for personalized analysis'
        })
        return
      }

      console.log('Starting property comparison analysis...')
      console.log('Items:', items.length)
      console.log('Profile purpose:', profile.purpose || '(freeform)')
      console.log('Language:', language || 'en')

      // Fetch additional data from database if needed
      const enrichedProperties = await enrichPropertyData(pool, properties)

      // Call AI analysis with language preference
      const report = await analyzeProperties(enrichedProperties, profile, language || 'en')

      res.json({
        success: true,
        report
      })
    } catch (error) {
      console.error('Error in comparison analysis:', error)
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Analysis failed'
      })
    }
  })

  return router
}

// Enrich property data with additional info from database
async function enrichPropertyData(
  pool: Pool,
  properties: ComparisonPropertyData[]
): Promise<ComparisonPropertyData[]> {
  const enriched: ComparisonPropertyData[] = []

  for (const prop of properties) {
    try {
      // Get payment plan from residential_projects JSONB column
      const projectResult = await pool.query(`
        SELECT payment_plan
        FROM residential_projects
        WHERE id = $1
      `, [prop.projectId])

      let paymentPlan = prop.paymentPlan

      if (projectResult.rows.length > 0 && projectResult.rows[0].payment_plan) {
        const milestones = projectResult.rows[0].payment_plan
        if (Array.isArray(milestones) && milestones.length > 0) {
          let downPayment = 0
          let duringConstruction = 0
          let onHandover = 0

          for (const row of milestones) {
            const pct = parseFloat(row.percentage) || 0
            const milestone = (row.milestone || '').toLowerCase()

            if (milestone.includes('down') || milestone.includes('booking')) {
              downPayment += pct
            } else if (milestone.includes('handover') || milestone.includes('completion')) {
              onHandover += pct
            } else {
              duringConstruction += pct
            }
          }

          paymentPlan = { downPayment, duringConstruction, onHandover }
        }
      }

      enriched.push({
        ...prop,
        paymentPlan
      })
    } catch (err) {
      console.error('Error enriching property data:', err)
      enriched.push(prop)
    }
  }

  return enriched
}

export default createCompareRouter
