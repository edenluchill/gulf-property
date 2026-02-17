/**
 * Admin Tasks API Routes
 *
 * Admin-only API for managing all PDF processing tasks
 *
 * Routes:
 * - GET    /api/admin/tasks       - Get all tasks (with pagination/filtering)
 * - GET    /api/admin/tasks/stats - Get task statistics
 * - DELETE /api/admin/tasks/:jobId - Delete a task
 */

import { Router, Request, Response } from 'express';
import { taskManager, TaskStatus } from '../services/task-manager';
import pool from '../db/pool';

const router = Router();

/**
 * Simple admin check middleware
 * In production, this should verify JWT claims or role-based access
 */
function requireAdmin(req: Request, res: Response, next: Function): void {
  const userId = req.headers['x-user-id'] as string;
  const isAdmin = req.headers['x-admin'] === 'true' || userId === 'admin';

  if (!isAdmin) {
    res.status(403).json({
      success: false,
      error: 'Admin access required',
    });
    return;
  }

  next();
}

// Apply admin middleware to all routes
router.use(requireAdmin);

/**
 * GET /api/admin/tasks
 * Get all tasks with pagination and filtering
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const status = req.query.status as TaskStatus | TaskStatus[] | undefined;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    const statusArray = status
      ? (Array.isArray(status) ? status : [status])
      : undefined;

    const { tasks, total } = await taskManager.getAllTasks({
      status: statusArray,
      limit,
      offset,
    });

    res.json({
      success: true,
      tasks,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + tasks.length < total,
      },
    });
  } catch (error) {
    console.error('Error fetching all tasks:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch tasks',
    });
  }
});

/**
 * GET /api/admin/tasks/stats
 * Get task statistics for admin dashboard
 */
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const stats = await taskManager.getTaskStats();

    res.json({
      success: true,
      stats,
    });
  } catch (error) {
    console.error('Error fetching task stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch task statistics',
    });
  }
});

/**
 * GET /api/admin/tasks/:jobId
 * Get detailed task information
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
 * POST /api/admin/tasks/:jobId/pause
 * Admin pause a task
 */
router.post('/:jobId/pause', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;

    const task = await taskManager.getTask(jobId);
    if (!task) {
      return res.status(404).json({
        success: false,
        error: 'Task not found',
      });
    }

    await taskManager.pauseTask(jobId);

    res.json({
      success: true,
      message: 'Task paused by admin',
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
 * POST /api/admin/tasks/:jobId/cancel
 * Admin cancel a task
 */
router.post('/:jobId/cancel', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;

    const task = await taskManager.getTask(jobId);
    if (!task) {
      return res.status(404).json({
        success: false,
        error: 'Task not found',
      });
    }

    await taskManager.cancelTask(jobId);

    res.json({
      success: true,
      message: 'Task cancelled by admin',
    });
  } catch (error) {
    console.error('Error cancelling task:', error);
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to cancel task',
    });
  }
});

/**
 * DELETE /api/admin/tasks/:jobId
 * Delete a task (permanent)
 */
router.delete('/:jobId', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;

    const deleted = await taskManager.deleteTask(jobId);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'Task not found',
      });
    }

    res.json({
      success: true,
      message: 'Task deleted',
    });
  } catch (error) {
    console.error('Error deleting task:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete task',
    });
  }
});

/**
 * POST /api/admin/tasks/batch/cancel
 * Cancel multiple tasks at once
 */
router.post('/batch/cancel', async (req: Request, res: Response) => {
  try {
    const { jobIds } = req.body as { jobIds: string[] };

    if (!jobIds || !Array.isArray(jobIds) || jobIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'jobIds array required',
      });
    }

    const results: { jobId: string; success: boolean; error?: string }[] = [];

    for (const jobId of jobIds) {
      try {
        await taskManager.cancelTask(jobId);
        results.push({ jobId, success: true });
      } catch (error) {
        results.push({
          jobId,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    const successCount = results.filter(r => r.success).length;

    res.json({
      success: true,
      message: `Cancelled ${successCount}/${jobIds.length} tasks`,
      results,
    });
  } catch (error) {
    console.error('Error batch cancelling tasks:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to cancel tasks',
    });
  }
});

/**
 * DELETE /api/admin/tasks/batch
 * Delete multiple tasks at once
 */
router.delete('/batch', async (req: Request, res: Response) => {
  try {
    const { jobIds } = req.body as { jobIds: string[] };

    if (!jobIds || !Array.isArray(jobIds) || jobIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'jobIds array required',
      });
    }

    const results: { jobId: string; success: boolean; error?: string }[] = [];

    for (const jobId of jobIds) {
      try {
        const deleted = await taskManager.deleteTask(jobId);
        results.push({ jobId, success: deleted });
      } catch (error) {
        results.push({
          jobId,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    const successCount = results.filter(r => r.success).length;

    res.json({
      success: true,
      message: `Deleted ${successCount}/${jobIds.length} tasks`,
      results,
    });
  } catch (error) {
    console.error('Error batch deleting tasks:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete tasks',
    });
  }
});

/**
 * POST /api/admin/tasks/:jobId/submit
 * Submit task results as a new developer property submission
 */
router.post('/:jobId/submit', async (req: Request, res: Response) => {
  const client = await pool.connect();

  try {
    const { jobId } = req.params;

    // Get task with result data
    const task = await taskManager.getTask(jobId);
    if (!task) {
      return res.status(404).json({
        success: false,
        error: 'Task not found',
      });
    }

    if (task.status !== 'completed') {
      return res.status(400).json({
        success: false,
        error: 'Only completed tasks can be submitted',
      });
    }

    const buildingData = task.result_data?.buildingData;
    if (!buildingData) {
      return res.status(400).json({
        success: false,
        error: 'No building data in task result',
      });
    }

    // Start transaction
    await client.query('BEGIN');

    // Calculate min/max from units
    const units = buildingData.units || [];
    let minPrice: number | null = null;
    let maxPrice: number | null = null;
    let minArea: number | null = null;
    let maxArea: number | null = null;
    let minBedrooms: number | null = null;
    let maxBedrooms: number | null = null;

    for (const unit of units) {
      const price = unit.price || unit.minPrice;
      const area = unit.size || unit.minArea;
      const bedrooms = unit.bedrooms;

      if (price) {
        if (minPrice === null || price < minPrice) minPrice = price;
        if (maxPrice === null || price > maxPrice) maxPrice = price;
      }
      if (area) {
        if (minArea === null || area < minArea) minArea = area;
        if (maxArea === null || area > maxArea) maxArea = area;
      }
      if (bedrooms !== undefined && bedrooms !== null) {
        if (minBedrooms === null || bedrooms < minBedrooms) minBedrooms = bedrooms;
        if (maxBedrooms === null || bedrooms > maxBedrooms) maxBedrooms = bedrooms;
      }
    }

    // Collect all images
    const projectImages = buildingData.images?.projectImages || [];
    const floorPlanImages = buildingData.images?.floorPlanImages || [];

    // Insert main submission
    const submissionResult = await client.query(`
      INSERT INTO developer_property_submissions (
        project_name, developer, address,
        min_price, max_price, min_area, max_area,
        min_bedrooms, max_bedrooms,
        description, amenities,
        showcase_images, floorplan_images,
        status, submitted_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'approved', $14)
      RETURNING id
    `, [
      buildingData.name || task.task_name || 'Untitled Project',
      buildingData.developer || 'Unknown Developer',
      buildingData.area || buildingData.address || 'Dubai, UAE',
      minPrice,
      maxPrice,
      minArea,
      maxArea,
      minBedrooms,
      maxBedrooms,
      buildingData.description || null,
      buildingData.amenities || [],
      projectImages,
      floorPlanImages,
      'admin', // submitted_by
    ]);

    const submissionId = submissionResult.rows[0].id;

    // Insert unit types
    for (const unit of units) {
      await client.query(`
        INSERT INTO developer_submission_unit_types (
          submission_id, name,
          min_area, max_area,
          min_price, max_price,
          bedrooms, bathrooms
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        submissionId,
        unit.typeName || unit.name || `${unit.bedrooms || 0} Bedroom`,
        unit.minArea || unit.size || null,
        unit.maxArea || unit.size || null,
        unit.minPrice || unit.price || null,
        unit.maxPrice || unit.price || null,
        unit.bedrooms || null,
        unit.bathrooms || null,
      ]);
    }

    // Insert payment plans
    const paymentPlans = buildingData.paymentPlans || [];
    for (const plan of paymentPlans) {
      const milestones = plan.milestones || [];
      for (let i = 0; i < milestones.length; i++) {
        const milestone = milestones[i];
        await client.query(`
          INSERT INTO developer_submission_payment_plans (
            submission_id, milestone, percentage, sequence_order
          ) VALUES ($1, $2, $3, $4)
        `, [
          submissionId,
          milestone.description || milestone.milestone || `Milestone ${i + 1}`,
          milestone.percentage || 0,
          i,
        ]);
      }
    }

    // Commit transaction
    await client.query('COMMIT');

    console.log(`✅ Task ${jobId} submitted as project ${submissionId}`);

    res.json({
      success: true,
      message: 'Task submitted as project',
      projectId: submissionId,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error submitting task:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to submit task',
    });
  } finally {
    client.release();
  }
});

export default router;
