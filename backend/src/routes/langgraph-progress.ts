/**
 * LangGraph Progress API Routes
 * 
 * SSE endpoints for real-time progress updates
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import { executePdfWorkflow } from '../langgraph/workflow-executor';
import { progressEmitter } from '../services/progress-emitter';
import { generateJobId } from '../utils/pdf/file-manager';
import { updateBuildingDataWithImageUrls } from '../langgraph/utils/image-url-helper';
import { join } from 'path';

const router = Router();

// Configure multer for PDF upload (kept for potential single file endpoint)
// const upload = multer({
//   storage: multer.memoryStorage(),
//   limits: {
//     fileSize: 50 * 1024 * 1024,
//   },
//   fileFilter: (_req, file, cb) => {
//     if (file.mimetype === 'application/pdf') {
//       cb(null, true);
//     } else {
//       cb(new Error('Only PDF files are allowed'));
//     }
//   },
// });

/**
 * POST /api/langgraph-progress/start
 * 
 * Start PDF processing and return job ID for SSE connection
 */
// Update to support multiple files
const uploadMultiple = multer({
  storage: multer.memoryStorage(),
  limits: { 
    fileSize: 100 * 1024 * 1024,  // 100MB per file
    files: 5,  // Max 5 files
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  },
});

router.post(
  '/start',
  uploadMultiple.array('files', 5),  // Support up to 5 PDFs
  async (req: Request, res: Response) => {
    try {
      const files = req.files as Express.Multer.File[];
      
      if (!files || files.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No PDF files provided',
        });
      }

      const jobId = generateJobId();

      console.log(`\n📄 Starting job ${jobId}: ${files.length} document(s)`);
      files.forEach((f, i) => {
        console.log(`   ${i + 1}. ${f.originalname} (${(f.size / 1024).toFixed(2)} KB)`);
      });

      // Chunked processing - all PDFs → 5-page chunks → batch process
      (async () => {
        try {
          // Execute workflow
          const result = await executePdfWorkflow({
            pdfBuffers: files.map(f => f.buffer),
            pdfNames: files.map(f => f.originalname),
            outputBaseDir: join(process.cwd(), 'uploads', 'langgraph-output'),
            jobId,
            pagesPerChunk: 5,
            batchSize: 10,
            batchDelay: 1000,
          });

          // Convert image paths to URLs before sending to frontend
          const updatedResult = {
            ...result,
            buildingData: updateBuildingDataWithImageUrls(result.buildingData, jobId),
          };

          // Send final completion
          progressEmitter.complete(jobId, updatedResult);

        } catch (error) {
          console.error(`Job ${jobId} failed:`, error);
          progressEmitter.error(jobId, String(error));
        }
      })();

      // Return job ID immediately
      res.json({
        success: true,
        jobId,
        message: 'Processing started. Connect to /api/langgraph-progress/stream/:jobId for updates',
      });
    } catch (error) {
      console.error('Error starting PDF processing:', error);
      
      res.status(500).json({
        success: false,
        error: 'Failed to start processing',
        details: String(error),
      });
    }
  }
);

/**
 * GET /api/langgraph-progress/stream/:jobId
 * 
 * SSE endpoint for real-time progress updates
 */
router.get('/stream/:jobId', (req: Request, res: Response) => {
  const { jobId } = req.params;

  console.log(`📡 SSE client connected for job ${jobId}`);

  // Register client for progress updates
  progressEmitter.registerClient(jobId, res);

  // Handle client disconnect
  req.on('close', () => {
    console.log(`📡 SSE client disconnected for job ${jobId}`);
  });
});

/**
 * GET /api/langgraph-progress/status/:jobId
 * 
 * Check if a job is still being processed
 */
router.get('/status/:jobId', (req: Request, res: Response) => {
  const { jobId } = req.params;
  const isActive = progressEmitter.hasClient(jobId);

  res.json({
    jobId,
    isActive,
    message: isActive ? 'Job is being processed' : 'Job not found or completed',
  });
});

/**
 * Merge results from multiple files (currently unused, kept for reference)
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function mergeAllResults(results: any[]): any {
  if (results.length === 0) return {};
  if (results.length === 1) return results[0].buildingData || {};

  const merged: any = {
    name: '',
    developer: '',
    address: '',
    units: [],
    paymentPlans: [],
    amenities: [],
  };

  // Take basic info from first result
  for (const result of results) {
    if (result.buildingData) {
      merged.name = result.buildingData.name || merged.name;
      merged.developer = result.buildingData.developer || merged.developer;
      merged.address = result.buildingData.address || merged.address;
      merged.area = result.buildingData.area || merged.area;
      merged.completionDate = result.buildingData.completionDate || merged.completionDate;
      merged.description = result.buildingData.description || merged.description;
      break; // Use first non-empty
    }
  }

  // Merge units, payment plans, amenities
  const allUnits: any[] = [];
  const allPaymentPlans: any[] = [];
  const amenitiesSet = new Set<string>();

  for (const result of results) {
    if (result.buildingData?.units) allUnits.push(...result.buildingData.units);
    if (result.buildingData?.paymentPlans) allPaymentPlans.push(...result.buildingData.paymentPlans);
    if (result.buildingData?.amenities) {
      result.buildingData.amenities.forEach((a: string) => amenitiesSet.add(a));
    }
  }

  merged.units = allUnits;
  merged.paymentPlans = allPaymentPlans;
  merged.amenities = Array.from(amenitiesSet);

  return merged;
}

export default router;
