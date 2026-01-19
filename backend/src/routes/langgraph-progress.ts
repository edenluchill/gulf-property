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
  async (req: Request, res: Response): Promise<void> => {
    try {
      const files = req.files as Express.Multer.File[];
      
      if (!files || files.length === 0) {
        res.status(400).json({
          success: false,
          error: 'No PDF files provided',
        });
        return;
      }

      const jobId = generateJobId();

      console.log(`\n📄 Starting job ${jobId}: ${files.length} document(s)`);
      files.forEach((f, i) => {
        console.log(`   ${i + 1}. ${f.originalname} (${(f.size / 1024).toFixed(2)} KB)`);
      });

      // Chunked processing - all PDFs → 5-page chunks → batch process
      console.log(`🚀 Starting async workflow for job ${jobId}...`);
      
      // Wait for SSE client to connect before starting heavy processing
      const waitForClient = async (maxWaitMs: number = 3000) => {
        const startWait = Date.now();
        while (!progressEmitter.hasClient(jobId)) {
          if (Date.now() - startWait > maxWaitMs) {
            console.warn(`⚠️ SSE client not connected after ${maxWaitMs}ms, proceeding anyway...`);
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        console.log(`✅ SSE client connected for job ${jobId}, starting processing...`);
      };

      (async () => {
        await waitForClient();
        
        console.log(`⚡ Executing workflow for job ${jobId}`);
        
        try {
          // Execute workflow
          const result = await executePdfWorkflow({
            pdfBuffers: files.map(f => f.buffer),
            pdfNames: files.map(f => f.originalname),
            outputBaseDir: join(process.cwd(), 'uploads', 'langgraph-output'),
            jobId,
            pagesPerChunk: 5,
            batchSize: 10,  // ⚡ BALANCED: Reduced to 10 to avoid R2 upload timeouts
            batchDelay: 1000,  // ⚡ BALANCED: Increased to 1000ms for better R2 stability
          });

          console.log(`✅ Workflow completed for job ${jobId}`);

          // All images are already R2 URLs - no conversion needed
          // Send final completion
          progressEmitter.complete(jobId, result);

        } catch (error) {
          console.error(`❌ Job ${jobId} failed:`, error);
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
  console.log(`   Request headers:`, {
    origin: req.headers.origin,
    userAgent: req.headers['user-agent']?.substring(0, 50),
  });

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
/* Commented out to avoid unused function warning - can be re-enabled if needed
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
*/

export default router;
