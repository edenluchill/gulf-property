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
import { taskManager } from '../services/task-manager';

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
// Update to support multiple files and large PDFs (up to 1GB each)
const uploadMultiple = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 1024 * 1024 * 1024,  // 1GB per file
    files: 10,  // Max 10 files
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
  uploadMultiple.array('files', 10),  // Support up to 10 PDFs
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

      // Get user info from request headers or body
      const userId = req.headers['x-user-id'] as string || (req as any).user?.id || req.body.userId || 'anonymous';
      const userEmail = req.headers['x-user-email'] as string || (req as any).user?.email || req.body.userEmail;

      // Calculate total file size
      const totalSizeBytes = files.reduce((sum, f) => sum + f.size, 0);

      console.log(`\n📄 Starting job ${jobId}: ${files.length} document(s), ${(totalSizeBytes / 1024 / 1024).toFixed(2)} MB`);
      console.log(`   User: ${userId}${userEmail ? ` (${userEmail})` : ''}`);
      files.forEach((f, i) => {
        console.log(`   ${i + 1}. ${f.originalname} (${(f.size / 1024).toFixed(2)} KB)`);
      });

      // Create task record in database
      try {
        await taskManager.createTask({
          jobId,
          userId,
          userEmail,
          taskName: files.length === 1
            ? files[0].originalname
            : `${files.length} PDFs: ${files.map(f => f.originalname).join(', ').substring(0, 100)}`,
          pdfCount: files.length,
          pdfNames: files.map(f => f.originalname),
          totalSizeBytes,
        });
        console.log(`📋 Task registered in database: ${jobId}`);
      } catch (dbError: any) {
        console.error(`❌ Failed to create task record:`, dbError.message || dbError);
        console.error(`   Full error:`, dbError);
        // Continue processing even if DB insert fails
      }

      // Chunked processing - all PDFs → 5-page chunks → batch process
      console.log(`🚀 Starting async workflow for job ${jobId}...`);

      // Wait for SSE client to connect before starting heavy processing
      // Extended to 15 seconds for large file uploads where client may be slower to establish SSE
      const waitForClient = async (maxWaitMs: number = 15000) => {
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

        // Update task status to processing
        try {
          await taskManager.updateStatus(jobId, 'processing', { currentStage: 'Starting workflow' });
        } catch (e) { /* ignore */ }

        try {
          // Execute workflow
          const result = await executePdfWorkflow({
            pdfBuffers: files.map(f => f.buffer),
            pdfNames: files.map(f => f.originalname),
            outputBaseDir: join(process.cwd(), 'uploads', 'langgraph-output'),
            jobId,
            pagesPerChunk: 5,
            batchSize: 10,  // ⚡ Max concurrent chunks (p-limit sliding window)
          });

          console.log(`✅ Workflow completed for job ${jobId}`);

          // Mark task as completed with full result data
          try {
            await taskManager.completeTask(jobId, {
              success: result.success,
              totalPages: result.totalPages,
              totalChunks: result.totalChunks,
              processingTime: result.processingTime,
              // Include rich data for admin review
              summary: {
                unitsCount: result.buildingData?.units?.length || 0,
                paymentPlansCount: result.buildingData?.paymentPlans?.length || 0,
                amenitiesCount: result.buildingData?.amenities?.length || 0,
                projectImagesCount: result.buildingData?.images?.projectImages?.length || 0,
                floorPlanImagesCount: result.buildingData?.images?.floorPlanImages?.length || 0,
              },
              // Full building data for review/edit
              buildingData: result.buildingData,
              errors: result.errors,
              warnings: result.warnings,
            });
          } catch (e) {
            console.warn(`⚠️ Failed to update task completion:`, e);
          }

          // All images are already R2 URLs - no conversion needed
          // Send final completion
          progressEmitter.complete(jobId, result);

        } catch (error) {
          console.error(`❌ Job ${jobId} failed:`, error);

          // Mark task as failed
          try {
            await taskManager.failTask(jobId, [String(error)]);
          } catch (e) {
            console.warn(`⚠️ Failed to update task failure:`, e);
          }

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
