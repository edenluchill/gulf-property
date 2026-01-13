/**
 * Result Validation API Routes
 */

import { Router, Request, Response } from 'express';
import { validateAndScoreResults, generateQualityReport } from '../services/result-validator';

const router = Router();

/**
 * POST /api/langgraph/validate
 * 
 * Validate extraction results and get quality score
 */
router.post('/validate', (req: Request, res: Response) => {
  try {
    const { buildingData } = req.body;

    if (!buildingData) {
      return res.status(400).json({
        success: false,
        error: 'buildingData is required',
      });
    }

    const validation = validateAndScoreResults(buildingData);
    const report = generateQualityReport(validation);

    res.json({
      success: true,
      validation,
      report,
    });
  } catch (error) {
    console.error('Error validating results:', error);
    res.status(500).json({
      success: false,
      error: 'Validation failed',
      details: String(error),
    });
  }
});

export default router;
