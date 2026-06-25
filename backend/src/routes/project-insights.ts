/**
 * Project insights endpoint — investment + location intelligence for the detail
 * page. Isolated thin router (mounted alongside the residential-projects router);
 * delete this file + its mount line to remove. See projectInsights.ts.
 *
 *   GET /api/residential-projects/:id/insights
 */
import { Router, Request, Response } from 'express'
import { getProjectInsights, getProjectTransactions } from '../services/projectInsights'

const router = Router()

router.get('/:id/insights', async (req: Request, res: Response) => {
  try {
    const insights = await getProjectInsights(String(req.params.id))
    if (!insights) return res.status(404).json({ success: false, error: 'project not found' })
    res.set('Cache-Control', 'public, max-age=3600')
    res.json({ success: true, data: insights })
  } catch (err) {
    console.error('[project-insights] error:', err)
    res.status(500).json({ success: false, error: 'failed to build insights' })
  }
})

// Real DLD transactions for this project's matched development.
router.get('/:id/transactions', async (req: Request, res: Response) => {
  try {
    const data = await getProjectTransactions(String(req.params.id))
    if (!data) return res.status(404).json({ success: false, error: 'project not found' })
    res.set('Cache-Control', 'public, max-age=3600')
    res.json({ success: true, data })
  } catch (err) {
    console.error('[project-insights] transactions error:', err)
    res.status(500).json({ success: false, error: 'failed to load transactions' })
  }
})

export default router
