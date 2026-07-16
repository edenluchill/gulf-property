/**
 * Tasks API Routes
 *
 * User-facing API for managing PDF processing tasks
 *
 * Routes:
 * - POST   /api/tasks/start        - Start a new task (called by upload page)
 * - GET    /api/tasks              - Get user's tasks
 * - GET    /api/tasks/:jobId       - Get task details
 * - GET    /api/tasks/:jobId/stream - SSE progress stream
 * - POST   /api/tasks/:jobId/pause  - Pause a task
 * - POST   /api/tasks/:jobId/resume - Resume a paused task
 * - POST   /api/tasks/:jobId/cancel - Cancel a task
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import { taskManager, TaskStatus, TaskAbortedError } from '../services/task-manager';
import { progressEmitter } from '../services/progress-emitter';
import { executePdfWorkflow } from '../langgraph/workflow-executor';
import { PageRegistryManager } from '../langgraph/core/page-registry';
import { requireAuth } from '../middleware/auth';
import { requireUploader } from '../middleware/requireUploader';

const router = Router();

// PDF 任务管理(列表/启动/暂停/恢复/取消)全是「可管理项目」能力,服务端强制。
// 旧版只从可伪造的 x-user-* 头取身份、不做任何校验。
router.use(requireAuth, requireUploader);

// Configure multer for PDF uploads (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB per file
    files: 10, // Max 10 files
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
 * Extract user info from request
 * In production, this would come from authentication middleware
 */
function getUserFromRequest(req: Request): { userId: string; userEmail?: string } {
  // For now, use a header-based approach
  // In production, this should come from JWT or session
  const userId = req.headers['x-user-id'] as string || 'anonymous';
  const userEmail = req.headers['x-user-email'] as string || undefined;
  return { userId, userEmail };
}

/**
 * POST /api/tasks/start
 * Start a new PDF processing task
 */
router.post('/start', upload.array('pdfs', 10), async (req: Request, res: Response) => {
  try {
    const files = req.files as Express.Multer.File[];

    if (!files || files.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No PDF files uploaded',
      });
    }

    const { userId, userEmail } = getUserFromRequest(req);
    const taskName = req.body.taskName || files.map(f => f.originalname).join(', ');

    // Create task in database
    const jobId = await taskManager.createTask({
      userId,
      userEmail,
      taskName,
      pdfCount: files.length,
      pdfNames: files.map(f => f.originalname),
    });

    // Prepare buffers and names
    const pdfBuffers = files.map(f => f.buffer);
    const pdfNames = files.map(f => f.originalname);

    // Update status to uploading
    await taskManager.updateStatus(jobId, 'uploading', {
      currentStage: 'Preparing files',
    });

    // Start processing in background
    processTaskAsync(jobId, pdfBuffers, pdfNames).catch(err => {
      console.error(`Background processing error for ${jobId}:`, err);
    });

    res.json({
      success: true,
      jobId,
      message: 'Task started',
    });
  } catch (error) {
    console.error('Error starting task:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to start task',
    });
  }
});

/**
 * Background task processing
 */
async function processTaskAsync(
  jobId: string,
  pdfBuffers: Buffer[],
  pdfNames: string[]
): Promise<void> {
  try {
    // Update status to processing
    await taskManager.updateStatus(jobId, 'processing', {
      currentStage: 'Starting AI analysis',
    });

    // Get abort signal for this task
    const abortSignal = taskManager.getAbortSignal(jobId);

    // Execute workflow
    const result = await executePdfWorkflow({
      pdfBuffers,
      pdfNames,
      jobId,
      abortSignal, // Pass abort signal to workflow
    });

    // Check if aborted
    if (abortSignal.aborted) {
      const reason = taskManager.getAbortReason(jobId);
      if (reason === 'paused') {
        console.log(`Task ${jobId} was paused`);
        return; // Status already updated by pauseTask
      } else if (reason === 'cancelled') {
        console.log(`Task ${jobId} was cancelled`);
        return; // Status already updated by cancelTask
      }
    }

    // Complete the task
    if (result.success) {
      await taskManager.completeTask(jobId, result.buildingData);
      progressEmitter.complete(jobId, result.buildingData);
    } else {
      await taskManager.failTask(jobId, result.errors);
      progressEmitter.error(jobId, result.errors.join('; '));
    }
  } catch (error) {
    if (error instanceof TaskAbortedError) {
      // Already handled by pause/cancel
      console.log(`Task ${jobId} aborted: ${error.reason}`);
      return;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Task ${jobId} failed:`, errorMessage);

    await taskManager.failTask(jobId, [errorMessage]);
    progressEmitter.error(jobId, errorMessage);
  } finally {
    // Cleanup PageRegistry for this job
    PageRegistryManager.delete(jobId);
  }
}

/**
 * GET /api/tasks
 * Get user's tasks
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { userId } = getUserFromRequest(req);
    const status = req.query.status as TaskStatus | TaskStatus[] | undefined;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;

    const statusArray = status
      ? (Array.isArray(status) ? status : [status])
      : undefined;

    const tasks = await taskManager.getUserTasks(userId, {
      status: statusArray,
      limit,
      offset,
    });

    res.json({
      success: true,
      tasks,
    });
  } catch (error) {
    console.error('Error fetching tasks:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch tasks',
    });
  }
});

/**
 * GET /api/tasks/:jobId
 * Get task details
 */
router.get('/:jobId', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const task = await taskManager.getTask(jobId);

    if (!task) {
      return res.status(404).json({
        success: false,
        error: 'Task not found',
      });
    }

    // Optionally verify user owns this task
    const { userId } = getUserFromRequest(req);
    if (task.user_id !== userId && userId !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    res.json({
      success: true,
      task,
    });
  } catch (error) {
    console.error('Error fetching task:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch task',
    });
  }
});

/**
 * GET /api/tasks/:jobId/stream
 * SSE progress stream for a task
 */
router.get('/:jobId/stream', async (req: Request, res: Response) => {
  const { jobId } = req.params;

  // Verify task exists
  const task = await taskManager.getTask(jobId);
  if (!task) {
    return res.status(404).json({
      success: false,
      error: 'Task not found',
    });
  }

  // Setup SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  // Initial event with current status
  res.write(`data: ${JSON.stringify({
    type: 'status',
    status: task.status,
    progress: task.progress,
    stage: task.current_stage,
  })}\n\n`);

  // If task is already completed or failed, send result and close
  if (task.status === 'completed') {
    res.write(`data: ${JSON.stringify({
      type: 'complete',
      data: task.result_data,
    })}\n\n`);
    res.end();
    return;
  }

  if (task.status === 'failed' || task.status === 'cancelled') {
    res.write(`data: ${JSON.stringify({
      type: 'error',
      errors: task.errors,
    })}\n\n`);
    res.end();
    return;
  }

  // For tasks that are still processing, register with progress emitter
  // The progress emitter will send updates to this client
  progressEmitter.registerClient(jobId, res);
});

/**
 * POST /api/tasks/:jobId/pause
 * Pause a running task
 */
router.post('/:jobId/pause', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;

    // Verify ownership
    const task = await taskManager.getTask(jobId);
    if (!task) {
      return res.status(404).json({
        success: false,
        error: 'Task not found',
      });
    }

    const { userId } = getUserFromRequest(req);
    if (task.user_id !== userId && userId !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    await taskManager.pauseTask(jobId);

    res.json({
      success: true,
      message: 'Task paused',
    });
  } catch (error) {
    console.error('Error pausing task:', error);
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to pause task',
    });
  }
});

/**
 * POST /api/tasks/:jobId/resume
 * Resume a paused task
 */
router.post('/:jobId/resume', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;

    // Verify ownership
    const task = await taskManager.getTask(jobId);
    if (!task) {
      return res.status(404).json({
        success: false,
        error: 'Task not found',
      });
    }

    const { userId } = getUserFromRequest(req);
    if (task.user_id !== userId && userId !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    // Get checkpoint data
    const checkpoint = await taskManager.resumeTask(jobId);

    // Resume processing in background
    // Note: In a real implementation, we would need to re-upload PDFs
    // or store them temporarily. For now, we just resume from checkpoint
    if (checkpoint) {
      resumeTaskAsync(jobId, checkpoint).catch(err => {
        console.error(`Resume processing error for ${jobId}:`, err);
      });
    }

    res.json({
      success: true,
      message: 'Task resumed',
      checkpoint: checkpoint ? { processedChunks: checkpoint.processedChunks } : null,
    });
  } catch (error) {
    console.error('Error resuming task:', error);
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to resume task',
    });
  }
});

/**
 * Resume task processing from checkpoint
 */
async function resumeTaskAsync(
  jobId: string,
  checkpoint: any
): Promise<void> {
  // In a full implementation, this would:
  // 1. Load the PDF files from temporary storage
  // 2. Restore the PageRegistry state
  // 3. Resume batch processing from the checkpoint

  // For now, emit a progress update indicating resumption
  progressEmitter.emit(jobId, {
    stage: 'mapping',
    code: 'RESUMING',
    message: `Resuming from chunk ${checkpoint.processedChunks}`,
    progress: (checkpoint.processedChunks / (checkpoint.totalChunks || 10)) * 100,
    timestamp: Date.now(),
  });

  // TODO: Implement full resume logic
  console.log(`Task ${jobId} resume logic not fully implemented yet`);
}

/**
 * POST /api/tasks/:jobId/cancel
 * Cancel a task
 */
router.post('/:jobId/cancel', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;

    // Verify ownership
    const task = await taskManager.getTask(jobId);
    if (!task) {
      return res.status(404).json({
        success: false,
        error: 'Task not found',
      });
    }

    const { userId } = getUserFromRequest(req);
    if (task.user_id !== userId && userId !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    await taskManager.cancelTask(jobId);

    // Notify SSE subscribers
    progressEmitter.error(jobId, 'Task cancelled by user');

    res.json({
      success: true,
      message: 'Task cancelled',
    });
  } catch (error) {
    console.error('Error cancelling task:', error);
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to cancel task',
    });
  }
});

export default router;
