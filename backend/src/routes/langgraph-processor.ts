/**
 * LangGraph PDF Processor API Route
 * 
 * Endpoint for processing PDFs using the LangGraph multi-agent system
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import { executePdfWorkflow } from '../langgraph/workflow-executor';
import { join } from 'path';

const router = Router();

// Configure multer for PDF upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  },
});

/**
 * POST /api/langgraph/process-pdf
 * 
 * Process a PDF using the LangGraph multi-agent workflow
 * 
 * Body:
 * - file: PDF file (multipart/form-data)
 * - simplified: boolean (optional, default: false) - use simplified workflow
 */
router.post(
  '/process-pdf',
  upload.single('file'),
  async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: 'No PDF file provided',
        });
      }

      console.log(`\n📄 Received PDF: ${req.file.originalname} (${(req.file.size / 1024).toFixed(2)} KB)`);

      // Generate job ID
      const { generateJobId } = require('../utils/pdf/file-manager');
      const jobId = generateJobId();

      // Execute workflow with single PDF
      const result = await executePdfWorkflow({
        pdfBuffers: [req.file.buffer],
        pdfNames: [req.file.originalname],
        outputBaseDir: join(process.cwd(), 'uploads', 'langgraph-output'),
        jobId,
        pagesPerChunk: 5,
        batchSize: 10,
        batchDelay: 1000,
      });

      // Return result
      return res.json({
        success: result.success,
        jobId: result.jobId,
        data: {
          building: result.buildingData,
        },
        metadata: {
          processingTime: result.processingTime,
          processingTimeSeconds: (result.processingTime / 1000).toFixed(2),
          totalChunks: result.totalChunks,
          totalPages: result.totalPages,
        },
        errors: result.errors,
        warnings: result.warnings,
      });
    } catch (error) {
      console.error('Error in LangGraph PDF processing:', error);
      
      return res.status(500).json({
        success: false,
        error: 'PDF processing failed',
        details: String(error),
      });
    }
  }
);

/**
 * GET /api/langgraph/health
 * 
 * Check if LangGraph service is ready
 */
router.get('/health', async (_req: Request, res: Response) => {
  try {
    const hasGeminiKey = !!process.env.GEMINI_API_KEY;

    res.json({
      status: 'ok',
      service: 'LangGraph PDF Processor',
      ready: hasGeminiKey,
        config: {
          geminiConfigured: hasGeminiKey,
          models: {
            classifier: 'gemini-3-flash-preview',
            extractor: 'gemini-3-flash-preview',
          },
          modes: {
            direct: 'Direct PDF processing (default, no canvas needed)',
            image: 'Image-based processing (requires canvas module)',
          },
        },
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: String(error),
    });
  }
});

/**
 * GET /api/langgraph/info
 * 
 * Get information about the workflow
 */
router.get('/info', (_req: Request, res: Response) => {
  res.json({
    service: 'LangGraph Multi-Agent PDF Processor',
    version: '1.0.0',
    description: 'Automated real estate PDF analysis using LangGraph and Gemini AI',
    workflow: {
      phases: [
        {
          name: 'Ingestion',
          description: 'Convert PDF to high-resolution images (300 DPI)',
        },
        {
          name: 'Map (Parallel)',
          description: 'Classify and extract data from each page in parallel',
          agents: ['Visual Classifier', 'Floor Plan Auditor', 'Financial Structurer'],
        },
        {
          name: 'Reduce (Aggregation)',
          description: 'Merge all page results and validate data quality',
          agents: ['Manager Agent'],
        },
        {
          name: 'Insight (Sequential)',
          description: 'Generate market intelligence and marketing content',
          agents: ['Market Intelligence', 'Creative Copywriter'],
        },
      ],
      features: [
        'Parallel page processing for speed',
        'Quality validation with automatic retries',
        'Multi-platform marketing content generation',
        'Market research and competitor analysis',
        'Structured output with Zod validation',
      ],
    },
    agents: [
      {
        name: 'Visual Classifier',
        role: 'Fast page classification using Gemini Flash',
        categories: ['Cover', 'Rendering', 'FloorPlan', 'PaymentPlan', 'LocationMap', 'Amenities', 'GeneralText'],
      },
      {
        name: 'Floor Plan Auditor',
        role: 'Precision extraction of unit types, sizes, and specifications',
      },
      {
        name: 'Financial Structurer',
        role: 'Payment plan extraction and standardization',
      },
      {
        name: 'Market Intelligence',
        role: 'Web research for market context and competitor analysis',
      },
      {
        name: 'Creative Copywriter',
        role: 'Generate marketing content for multiple platforms (Xiaohongshu, Twitter, Email)',
      },
      {
        name: 'Manager Agent',
        role: 'Quality validation, data aggregation, and workflow orchestration',
      },
    ],
    usage: {
      endpoint: 'POST /api/langgraph/process-pdf',
      method: 'multipart/form-data',
      parameters: {
        file: 'PDF file (required)',
        simplified: 'boolean (optional) - use simplified workflow without retries',
      },
    },
  });
});

export default router;
