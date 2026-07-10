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
import { readFile, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { executeWithQueue, getQueueStats, canStartImmediately } from '../services/job-queue';
import { uploadPdfForProcessing } from '../services/r2-storage';
import { resolveAgentId } from '../lib/agent-identity';
import { checkCredits, spend, creditError } from '../luna-tour/credits';

// Worker mode: if enabled, upload PDFs to R2 and let worker process
// If disabled (local dev), process inline
const USE_WORKER_MODE = process.env.USE_WORKER_MODE === 'true';

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
// Upload directory for temporary PDF storage (disk-based to avoid OOM)
const UPLOAD_DIR = join(process.cwd(), 'uploads', 'temp-pdfs');

// Ensure upload directory exists
if (!existsSync(UPLOAD_DIR)) {
  mkdir(UPLOAD_DIR, { recursive: true }).catch(console.error);
}

// Use disk storage to handle large PDFs without OOM
const diskStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    // Unique filename with timestamp
    const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2)}-${file.originalname}`;
    cb(null, uniqueName);
  },
});

// Update to support multiple files and large PDFs (up to 1GB each)
const uploadMultiple = multer({
  storage: diskStorage,  // Disk storage instead of memory to prevent OOM
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

      // AI 楼书解析订阅 gating(验证 token,不信任 x-user-* 头)。owner 无限;
      // 匿名/未订阅/超额一律拦。与直传 R2 路径(/api/r2-upload/complete)同口径。
      const agentId = await resolveAgentId(req);
      if (!agentId) {
        res.status(401).json({ success: false, error: '请先登录经纪账号再上传楼书。', code: 'auth_required', upgradeUrl: '/agent' });
        return;
      }
      const quota = await checkCredits(agentId, 'brochures');
      if (!quota.allowed) { const e = creditError('brochures', quota); res.status(e.status).json(e.body); return; }
      await spend(agentId, 'brochures', { type: 'brochure', label: files[0]?.originalname }).catch(() => {});

      // Calculate total file size
      const totalSizeBytes = files.reduce((sum, f) => sum + f.size, 0);

      console.log(`\n📄 Starting job ${jobId}: ${files.length} document(s), ${(totalSizeBytes / 1024 / 1024).toFixed(2)} MB`);
      console.log(`   User: ${userId}${userEmail ? ` (${userEmail})` : ''}`);
      files.forEach((f, i) => {
        console.log(`   ${i + 1}. ${f.originalname} (${(f.size / 1024).toFixed(2)} KB)`);
      });

      // ========================================
      // WORKER MODE: Upload to R2, return immediately
      // ========================================
      if (USE_WORKER_MODE) {
        console.log(`🔄 Worker mode enabled - uploading PDFs to R2...`);

        try {
          // Upload PDFs to R2
          const pdfUrls: string[] = [];
          for (const file of files) {
            const buffer = await readFile(file.path);
            const r2Key = await uploadPdfForProcessing(buffer, jobId, file.originalname);
            pdfUrls.push(r2Key);
            console.log(`   ✓ Uploaded ${file.originalname} to R2`);
          }

          // Create task with pdf_urls - worker will pick it up
          await taskManager.createTask({
            jobId,
            userId,
            userEmail,
            taskName: files.length === 1
              ? files[0].originalname
              : `${files.length} PDFs: ${files.map(f => f.originalname).join(', ').substring(0, 100)}`,
            pdfCount: files.length,
            pdfNames: files.map(f => f.originalname),
            pdfUrls,  // Worker will download from these
            totalSizeBytes,
            metadata: {
              uploadedAt: Date.now(),
              workerMode: true,
            },
          });

          console.log(`📋 Task created for worker: ${jobId}`);

          // Clean up temp files
          for (const file of files) {
            try {
              await unlink(file.path);
            } catch (e) { /* ignore */ }
          }

          // Return immediately - worker will process
          res.json({
            success: true,
            jobId,
            message: 'PDFs uploaded. Worker will process. Connect to /api/langgraph-progress/stream/:jobId for updates',
            workerMode: true,
          });
          return;

        } catch (uploadError: any) {
          console.error(`❌ Failed to upload PDFs to R2:`, uploadError);
          res.status(500).json({
            success: false,
            error: 'Failed to upload PDFs for processing',
            details: uploadError.message,
          });
          return;
        }
      }

      // ========================================
      // INLINE MODE: Process directly (local dev)
      // ========================================

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
      console.log(`🚀 Starting inline workflow for job ${jobId}...`);

      // Check queue status
      const initialStats = getQueueStats();
      const willQueue = !canStartImmediately();
      console.log(`📊 Queue status: ${initialStats.processing} processing, ${initialStats.queued} queued${willQueue ? ' (this job will be queued)' : ''}`);

      // Wait for SSE client to connect before starting heavy processing
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

      // Store file paths for cleanup (outside the queue execution)
      const filePaths = files.map(f => f.path);

      (async () => {
        await waitForClient();

        // Execute with queue management
        await executeWithQueue(
          jobId,
          // onQueued - called when job enters queue
          (position, stats) => {
            console.log(`📋 Job ${jobId} queued at position ${position}`);
            progressEmitter.emit(jobId, {
              stage: 'queued',
              code: 'JOB_QUEUED',
              message: `排队中... 前面还有 ${position} 个任务`,
              progress: 0,
              timestamp: Date.now(),
              data: {
                queuePosition: position,
                processing: stats.processing,
                maxConcurrent: stats.maxConcurrent,
              },
            });

            // Update task status
            try {
              taskManager.updateStatus(jobId, 'queued', {
                queuePosition: position,
                queuedAt: Date.now(),
              });
            } catch (e) { /* ignore */ }
          },
          // onStart - called when job starts processing
          () => {
            console.log(`⚡ Job ${jobId} starting processing`);
            progressEmitter.emit(jobId, {
              stage: 'ingestion',
              code: 'PROCESSING_STARTED',
              message: '开始处理...',
              progress: 1,
              timestamp: Date.now(),
            });
          },
          // executor - the actual job
          async () => {
            // Update task status to processing
            try {
              await taskManager.updateStatus(jobId, 'processing', { currentStage: 'Starting workflow' });
            } catch (e) { /* ignore */ }

            try {
              // Read PDF files from disk (one at a time to manage memory)
              console.log(`📖 Reading ${files.length} PDF(s) from disk...`);
              const pdfBuffers: Buffer[] = [];
              for (const file of files) {
                const buffer = await readFile(file.path);
                pdfBuffers.push(buffer);
                console.log(`   ✓ Loaded ${file.originalname} (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);
              }

              // Execute workflow
              const result = await executePdfWorkflow({
                pdfBuffers,
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
                  summary: {
                    unitsCount: result.buildingData?.units?.length || 0,
                    paymentPlansCount: result.buildingData?.paymentPlans?.length || 0,
                    amenitiesCount: result.buildingData?.amenities?.length || 0,
                    projectImagesCount: result.buildingData?.images?.projectImages?.length || 0,
                    floorPlanImagesCount: result.buildingData?.images?.floorPlanImages?.length || 0,
                  },
                  buildingData: result.buildingData,
                  errors: result.errors,
                  warnings: result.warnings,
                });
              } catch (e) {
                console.warn(`⚠️ Failed to update task completion:`, e);
              }

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
              throw error;  // Re-throw to signal queue that job failed
            } finally {
              // Clean up temporary files
              console.log(`🧹 Cleaning up ${filePaths.length} temporary file(s)...`);
              for (const filePath of filePaths) {
                try {
                  await unlink(filePath);
                } catch (e) {
                  // Ignore cleanup errors
                }
              }
            }
          }
        );
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
 * In worker mode, polls DB for updates. In inline mode, uses in-memory events.
 */
router.get('/stream/:jobId', async (req: Request, res: Response) => {
  const { jobId } = req.params;

  console.log(`📡 SSE client connected for job ${jobId}`);
  console.log(`   Mode: ${USE_WORKER_MODE ? 'worker' : 'inline'}`);

  // Always register client for potential inline events
  progressEmitter.registerClient(jobId, res);

  // In worker mode, also poll DB for updates
  if (USE_WORKER_MODE) {
    let lastProgress = -1;
    let lastStatus = '';
    let pollCount = 0;
    const MAX_POLLS = 600; // 10 minutes max at 1s intervals

    const pollInterval = setInterval(async () => {
      try {
        pollCount++;
        const task = await taskManager.getTask(jobId);

        if (!task) {
          // Job not found, stop polling
          clearInterval(pollInterval);
          return;
        }

        // Check if there's new progress
        const hasUpdate = task.progress !== lastProgress || task.status !== lastStatus;

        if (hasUpdate) {
          lastProgress = task.progress;
          lastStatus = task.status;

          // If completed, send complete event with buildingData and stop polling
          // DON'T send a separate progress event first - frontend will close connection on 'complete'
          if (task.status === 'completed') {
            progressEmitter.complete(jobId, {
              success: true,
              buildingData: task.result_data?.buildingData || task.result_data || {},
              processingTime: task.result_data?.processingTime || 0,
              totalPages: task.result_data?.totalPages || 0,
              totalChunks: task.total_chunks || 0,
              errors: task.errors || [],
              warnings: [],
              jobId,
            });
            clearInterval(pollInterval);
            return;
          }

          // If failed, send error event and stop polling
          if (task.status === 'failed') {
            progressEmitter.error(jobId, task.errors?.[0] || 'Processing failed');
            clearInterval(pollInterval);
            return;
          }

          // For other statuses, send progress update
          let stage: string = 'processing';
          if (task.status === 'pending') stage = 'queued';
          else if (task.status === 'processing') stage = task.current_stage?.includes('image') ? 'ingestion' : 'mapping';

          progressEmitter.emit(jobId, {
            stage: stage as any,
            code: `STATUS_${task.status.toUpperCase()}`,
            message: task.current_stage || `Processing... ${task.progress}%`,
            progress: task.progress,
            timestamp: Date.now(),
            data: {
              status: task.status,
              processedChunks: task.processed_chunks,
              totalChunks: task.total_chunks,
            },
          });
        }

        // Stop polling after max time
        if (pollCount >= MAX_POLLS) {
          console.log(`⏰ Max poll time reached for job ${jobId}`);
          clearInterval(pollInterval);
        }

      } catch (error) {
        console.error(`Error polling job ${jobId}:`, error);
      }
    }, 1000); // Poll every 1 second

    // Cleanup on client disconnect
    req.on('close', () => {
      clearInterval(pollInterval);
      console.log(`📡 SSE client disconnected for job ${jobId}`);
    });
  } else {
    // Inline mode - just handle disconnect
    req.on('close', () => {
      console.log(`📡 SSE client disconnected for job ${jobId}`);
    });
  }
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
 * GET /api/langgraph-progress/queue
 *
 * Get current queue statistics (for admin dashboard)
 */
router.get('/queue', (_req: Request, res: Response) => {
  const stats = getQueueStats();

  res.json({
    success: true,
    queue: {
      maxConcurrent: stats.maxConcurrent,
      processing: stats.processing,
      waiting: stats.queued,
      available: stats.maxConcurrent - stats.processing,
    },
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
