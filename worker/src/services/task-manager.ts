/**
 * Task Manager Service
 *
 * Manages PDF processing tasks with support for:
 * - Task creation and lifecycle management
 * - Pause/Resume with checkpoint-based recovery
 * - Cancellation with proper cleanup
 * - Database persistence for cross-session recovery
 */

import pool from '../db/pool';
import { v4 as uuidv4 } from 'uuid';

// Task status types
export type TaskStatus = 'pending' | 'uploading' | 'queued' | 'processing' | 'paused' | 'completed' | 'failed' | 'cancelled';

// Task creation parameters
export interface CreateTaskParams {
  jobId?: string;  // Optional - if not provided, will generate one
  userId: string;
  userEmail?: string;
  taskName?: string;
  pdfCount: number;
  pdfNames?: string[];
  pdfUrls?: string[];  // R2 keys for uploaded PDFs (for worker architecture)
  totalPages?: number;
  totalChunks?: number;
  totalSizeBytes?: number;
  metadata?: Record<string, any>;  // Additional job metadata
}

// Log entry structure
export interface TaskLogEntry {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  stage: string;
  message: string;
  data?: any;
}

// Debug snapshot structure
export interface DebugSnapshot {
  lastUpdate: string;
  currentState: any;
  metrics: {
    memoryUsage?: number;
    processingTime?: number;
    apiCalls?: number;
    [key: string]: any;
  };
}

// Task record from database
export interface TaskRecord {
  id: string;
  job_id: string;
  user_id: string;
  user_email: string | null;
  task_name: string | null;
  pdf_count: number;
  pdf_names: string[];
  pdf_urls: string[];  // R2 keys for uploaded PDFs
  total_pages: number | null;
  total_size_bytes: number | null;
  status: TaskStatus;
  progress: number;
  current_stage: string | null;
  paused_at: Date | null;
  checkpoint_data: CheckpointData | null;
  total_chunks: number | null;
  processed_chunks: number;
  result_data: any | null;
  errors: string[];
  processing_logs: TaskLogEntry[];
  debug_snapshot: DebugSnapshot | null;
  metadata: Record<string, any> | null;
  worker_id: string | null;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

// Checkpoint data structure for pause/resume
export interface CheckpointData {
  processedChunks: number;
  aggregatedData: any;
  pageRegistryState: any;
  lastProcessedChunkIndex: number;
  timestamp: number;
}

// Custom error for aborted tasks
export class TaskAbortedError extends Error {
  constructor(public reason: 'paused' | 'cancelled') {
    super(`Task ${reason}`);
    this.name = 'TaskAbortedError';
  }
}

/**
 * TaskManager - Singleton service for managing PDF processing tasks
 */
export class TaskManager {
  private static instance: TaskManager;

  // Active AbortControllers for running tasks
  private activeAbortControllers: Map<string, AbortController> = new Map();

  // Abort reasons for tracking why a task was stopped
  private abortReasons: Map<string, 'paused' | 'cancelled'> = new Map();

  private constructor() {}

  static getInstance(): TaskManager {
    if (!TaskManager.instance) {
      TaskManager.instance = new TaskManager();
    }
    return TaskManager.instance;
  }

  /**
   * Create a new task and return the job ID
   */
  async createTask(params: CreateTaskParams): Promise<string> {
    const jobId = params.jobId || `job_${uuidv4().replace(/-/g, '').substring(0, 12)}`;

    const query = `
      INSERT INTO pdf_processing_tasks (
        job_id, user_id, user_email, task_name,
        pdf_count, pdf_names, pdf_urls, total_pages, total_chunks, total_size_bytes,
        metadata, status, progress
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending', 0)
      RETURNING id, job_id
    `;

    const values = [
      jobId,
      params.userId,
      params.userEmail || null,
      params.taskName || null,
      params.pdfCount,
      params.pdfNames || [],
      params.pdfUrls || [],
      params.totalPages || null,
      params.totalChunks || null,
      params.totalSizeBytes || null,
      params.metadata || {},
    ];

    await pool.query(query, values);
    console.log(`📋 Task created: ${jobId}`);

    return jobId;
  }

  /**
   * Get an AbortController for a task
   * Creates a new one if it doesn't exist
   */
  getAbortController(jobId: string): AbortController {
    let controller = this.activeAbortControllers.get(jobId);
    if (!controller) {
      controller = new AbortController();
      this.activeAbortControllers.set(jobId, controller);
    }
    return controller;
  }

  /**
   * Get the AbortSignal for a task
   */
  getAbortSignal(jobId: string): AbortSignal {
    return this.getAbortController(jobId).signal;
  }

  /**
   * Update task status
   */
  async updateStatus(
    jobId: string,
    status: TaskStatus,
    additionalData?: Partial<{
      progress: number;
      currentStage: string;
      processedChunks: number;
      errors: string[];
      resultData: any;
      queuePosition: number;  // Queue position (for queued status)
      queuedAt: number;  // Timestamp when queued
    }>
  ): Promise<void> {
    const updates: string[] = ['status = $2', 'updated_at = CURRENT_TIMESTAMP'];
    const values: any[] = [jobId, status];
    let paramIndex = 3;

    if (status === 'processing' || status === 'uploading') {
      updates.push(`started_at = COALESCE(started_at, CURRENT_TIMESTAMP)`);
    }

    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      updates.push(`completed_at = CURRENT_TIMESTAMP`);
    }

    if (status === 'paused') {
      updates.push(`paused_at = CURRENT_TIMESTAMP`);
    }

    if (additionalData?.progress !== undefined) {
      updates.push(`progress = $${paramIndex}`);
      values.push(Math.round(additionalData.progress));  // Round to integer for DB
      paramIndex++;
    }

    if (additionalData?.currentStage !== undefined) {
      updates.push(`current_stage = $${paramIndex}`);
      values.push(additionalData.currentStage);
      paramIndex++;
    }

    if (additionalData?.processedChunks !== undefined) {
      updates.push(`processed_chunks = $${paramIndex}`);
      values.push(additionalData.processedChunks);
      paramIndex++;
    }

    if (additionalData?.errors !== undefined) {
      updates.push(`errors = $${paramIndex}`);
      values.push(additionalData.errors);
      paramIndex++;
    }

    if (additionalData?.resultData !== undefined) {
      updates.push(`result_data = $${paramIndex}`);
      values.push(JSON.stringify(additionalData.resultData));
      paramIndex++;
    }

    const query = `
      UPDATE pdf_processing_tasks
      SET ${updates.join(', ')}
      WHERE job_id = $1
    `;

    await pool.query(query, values);
    console.log(`📋 Task ${jobId} status updated to: ${status}`);
  }

  /**
   * Pause a running task
   *
   * This triggers the AbortController which will cause the batch processor
   * to save a checkpoint and stop processing
   */
  async pauseTask(jobId: string): Promise<void> {
    const task = await this.getTask(jobId);
    if (!task) {
      throw new Error(`Task not found: ${jobId}`);
    }

    if (task.status !== 'processing' && task.status !== 'uploading') {
      throw new Error(`Cannot pause task in status: ${task.status}`);
    }

    // Set abort reason and trigger abort
    this.abortReasons.set(jobId, 'paused');

    const controller = this.activeAbortControllers.get(jobId);
    if (controller) {
      controller.abort('paused');
    }

    // Update status in database
    await this.updateStatus(jobId, 'paused');
    console.log(`⏸️  Task ${jobId} paused`);
  }

  /**
   * Resume a paused task
   *
   * This creates a new AbortController and returns the checkpoint data
   * for the batch processor to resume from
   */
  async resumeTask(jobId: string): Promise<CheckpointData | null> {
    const task = await this.getTask(jobId);
    if (!task) {
      throw new Error(`Task not found: ${jobId}`);
    }

    if (task.status !== 'paused') {
      throw new Error(`Cannot resume task in status: ${task.status}`);
    }

    // Create a new AbortController for the resumed task
    this.activeAbortControllers.delete(jobId);
    this.abortReasons.delete(jobId);
    this.getAbortController(jobId);

    // Update status to processing
    await this.updateStatus(jobId, 'processing');
    console.log(`▶️  Task ${jobId} resumed`);

    return task.checkpoint_data;
  }

  /**
   * Cancel a task
   *
   * This permanently stops the task and cleans up resources
   */
  async cancelTask(jobId: string): Promise<void> {
    const task = await this.getTask(jobId);
    if (!task) {
      throw new Error(`Task not found: ${jobId}`);
    }

    if (task.status === 'completed' || task.status === 'cancelled') {
      throw new Error(`Cannot cancel task in status: ${task.status}`);
    }

    // Set abort reason and trigger abort
    this.abortReasons.set(jobId, 'cancelled');

    const controller = this.activeAbortControllers.get(jobId);
    if (controller) {
      controller.abort('cancelled');
    }

    // Update status and cleanup
    await this.updateStatus(jobId, 'cancelled');
    this.cleanup(jobId);
    console.log(`🚫 Task ${jobId} cancelled`);
  }

  /**
   * Save checkpoint data for pause/resume
   */
  async saveCheckpoint(jobId: string, data: CheckpointData): Promise<void> {
    const query = `
      UPDATE pdf_processing_tasks
      SET checkpoint_data = $2,
          processed_chunks = $3,
          updated_at = CURRENT_TIMESTAMP
      WHERE job_id = $1
    `;

    await pool.query(query, [
      jobId,
      JSON.stringify(data),
      data.processedChunks,
    ]);

    console.log(`💾 Checkpoint saved for task ${jobId} at chunk ${data.processedChunks}`);
  }

  /**
   * Load checkpoint data for resuming a task
   */
  async loadCheckpoint(jobId: string): Promise<CheckpointData | null> {
    const task = await this.getTask(jobId);
    return task?.checkpoint_data || null;
  }

  /**
   * Get a task by job ID
   */
  async getTask(jobId: string): Promise<TaskRecord | null> {
    const query = `
      SELECT * FROM pdf_processing_tasks
      WHERE job_id = $1
    `;

    const result = await pool.query(query, [jobId]);
    return result.rows[0] || null;
  }

  /**
   * Get tasks for a specific user
   */
  async getUserTasks(userId: string, options?: {
    status?: TaskStatus[];
    limit?: number;
    offset?: number;
  }): Promise<TaskRecord[]> {
    let query = `
      SELECT * FROM pdf_processing_tasks
      WHERE user_id = $1
    `;
    const values: any[] = [userId];
    let paramIndex = 2;

    if (options?.status && options.status.length > 0) {
      query += ` AND status = ANY($${paramIndex})`;
      values.push(options.status);
      paramIndex++;
    }

    query += ' ORDER BY created_at DESC';

    if (options?.limit) {
      query += ` LIMIT $${paramIndex}`;
      values.push(options.limit);
      paramIndex++;
    }

    if (options?.offset) {
      query += ` OFFSET $${paramIndex}`;
      values.push(options.offset);
    }

    const result = await pool.query(query, values);
    return result.rows;
  }

  /**
   * Get all tasks (for admin)
   */
  async getAllTasks(options?: {
    status?: TaskStatus[];
    limit?: number;
    offset?: number;
  }): Promise<{ tasks: TaskRecord[]; total: number }> {
    let query = 'SELECT * FROM pdf_processing_tasks WHERE 1=1';
    let countQuery = 'SELECT COUNT(*) FROM pdf_processing_tasks WHERE 1=1';
    const values: any[] = [];
    let paramIndex = 1;

    if (options?.status && options.status.length > 0) {
      query += ` AND status = ANY($${paramIndex})`;
      countQuery += ` AND status = ANY($${paramIndex})`;
      values.push(options.status);
      paramIndex++;
    }

    query += ' ORDER BY created_at DESC';

    const countResult = await pool.query(countQuery, values);
    const total = parseInt(countResult.rows[0].count);

    if (options?.limit) {
      query += ` LIMIT $${paramIndex}`;
      values.push(options.limit);
      paramIndex++;
    }

    if (options?.offset) {
      query += ` OFFSET $${paramIndex}`;
      values.push(options.offset);
    }

    const result = await pool.query(query, values);
    return { tasks: result.rows, total };
  }

  /**
   * Get task statistics (for admin dashboard)
   */
  async getTaskStats(): Promise<{
    total: number;
    byStatus: Record<TaskStatus, number>;
    activeCount: number;
    completedToday: number;
    failedToday: number;
  }> {
    const statusQuery = `
      SELECT status, COUNT(*) as count
      FROM pdf_processing_tasks
      GROUP BY status
    `;

    const todayQuery = `
      SELECT
        status,
        COUNT(*) as count
      FROM pdf_processing_tasks
      WHERE completed_at >= CURRENT_DATE
      GROUP BY status
    `;

    const [statusResult, todayResult] = await Promise.all([
      pool.query(statusQuery),
      pool.query(todayQuery),
    ]);

    const byStatus: Record<TaskStatus, number> = {
      pending: 0,
      uploading: 0,
      queued: 0,
      processing: 0,
      paused: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    };

    let total = 0;
    for (const row of statusResult.rows) {
      byStatus[row.status as TaskStatus] = parseInt(row.count);
      total += parseInt(row.count);
    }

    let completedToday = 0;
    let failedToday = 0;
    for (const row of todayResult.rows) {
      if (row.status === 'completed') completedToday = parseInt(row.count);
      if (row.status === 'failed') failedToday = parseInt(row.count);
    }

    const activeCount = byStatus.pending + byStatus.uploading + byStatus.processing + byStatus.paused;

    return {
      total,
      byStatus,
      activeCount,
      completedToday,
      failedToday,
    };
  }

  /**
   * Delete a task (admin only)
   */
  async deleteTask(jobId: string): Promise<boolean> {
    // First, make sure to cleanup any active controllers
    this.cleanup(jobId);

    const query = `
      DELETE FROM pdf_processing_tasks
      WHERE job_id = $1
      RETURNING id
    `;

    const result = await pool.query(query, [jobId]);
    return result.rowCount !== null && result.rowCount > 0;
  }

  /**
   * Get the abort reason for a task
   */
  getAbortReason(jobId: string): 'paused' | 'cancelled' | undefined {
    return this.abortReasons.get(jobId);
  }

  /**
   * Check if a task is aborted
   */
  isAborted(jobId: string): boolean {
    const controller = this.activeAbortControllers.get(jobId);
    return controller?.signal.aborted || false;
  }

  /**
   * Append a log entry to the task's processing_logs
   * Logs are stored in the database for production debugging
   */
  async appendLog(
    jobId: string,
    level: TaskLogEntry['level'],
    stage: string,
    message: string,
    data?: any
  ): Promise<void> {
    const logEntry: TaskLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      stage,
      message,
      ...(data && { data }),
    };

    // Also log to console in development
    const logPrefix = `[${jobId}][${stage}]`;
    switch (level) {
      case 'error':
        console.error(`❌ ${logPrefix} ${message}`, data || '');
        break;
      case 'warn':
        console.warn(`⚠️ ${logPrefix} ${message}`, data || '');
        break;
      case 'info':
        console.log(`ℹ️ ${logPrefix} ${message}`, data || '');
        break;
      case 'debug':
        if (process.env.NODE_ENV !== 'production') {
          console.log(`🔍 ${logPrefix} ${message}`, data || '');
        }
        break;
    }

    // Append to database (keep last 500 entries to prevent bloat)
    try {
      await pool.query(`
        UPDATE pdf_processing_tasks
        SET processing_logs = (
          SELECT jsonb_agg(elem)
          FROM (
            SELECT elem FROM jsonb_array_elements(
              COALESCE(processing_logs, '[]'::jsonb) || $2::jsonb
            ) AS elem
            ORDER BY elem->>'timestamp' DESC
            LIMIT 500
          ) sub
        ),
        updated_at = CURRENT_TIMESTAMP
        WHERE job_id = $1
      `, [jobId, JSON.stringify([logEntry])]);
    } catch (err) {
      console.error(`Failed to append log for ${jobId}:`, err);
    }
  }

  /**
   * Batch append multiple log entries (more efficient for bulk logging)
   */
  async appendLogs(jobId: string, entries: TaskLogEntry[]): Promise<void> {
    if (entries.length === 0) return;

    try {
      await pool.query(`
        UPDATE pdf_processing_tasks
        SET processing_logs = (
          SELECT jsonb_agg(elem)
          FROM (
            SELECT elem FROM jsonb_array_elements(
              COALESCE(processing_logs, '[]'::jsonb) || $2::jsonb
            ) AS elem
            ORDER BY elem->>'timestamp' DESC
            LIMIT 500
          ) sub
        ),
        updated_at = CURRENT_TIMESTAMP
        WHERE job_id = $1
      `, [jobId, JSON.stringify(entries)]);
    } catch (err) {
      console.error(`Failed to append logs for ${jobId}:`, err);
    }
  }

  /**
   * Update the debug snapshot for a task
   * Useful for capturing state at specific points for debugging
   */
  async updateDebugSnapshot(jobId: string, snapshot: Partial<DebugSnapshot>): Promise<void> {
    const fullSnapshot: DebugSnapshot = {
      lastUpdate: new Date().toISOString(),
      currentState: snapshot.currentState || {},
      metrics: snapshot.metrics || {},
    };

    try {
      await pool.query(`
        UPDATE pdf_processing_tasks
        SET debug_snapshot = $2,
            updated_at = CURRENT_TIMESTAMP
        WHERE job_id = $1
      `, [jobId, JSON.stringify(fullSnapshot)]);
    } catch (err) {
      console.error(`Failed to update debug snapshot for ${jobId}:`, err);
    }
  }

  /**
   * Get logs for a task (for admin viewing)
   */
  async getTaskLogs(jobId: string, options?: {
    level?: TaskLogEntry['level'][];
    limit?: number;
    offset?: number;
  }): Promise<TaskLogEntry[]> {
    const task = await this.getTask(jobId);
    if (!task || !task.processing_logs) return [];

    let logs = task.processing_logs;

    // Filter by level if specified
    if (options?.level && options.level.length > 0) {
      logs = logs.filter(log => options.level!.includes(log.level));
    }

    // Apply pagination
    const offset = options?.offset || 0;
    const limit = options?.limit || 100;
    return logs.slice(offset, offset + limit);
  }

  /**
   * Cleanup resources for a task
   */
  cleanup(jobId: string): void {
    this.activeAbortControllers.delete(jobId);
    this.abortReasons.delete(jobId);
    console.log(`🧹 Cleaned up resources for task ${jobId}`);
  }

  /**
   * Update task counts (total_pages, total_chunks) after PDF analysis
   */
  async updateTaskCounts(jobId: string, totalPages: number, totalChunks: number): Promise<void> {
    const query = `
      UPDATE pdf_processing_tasks
      SET total_pages = $2,
          total_chunks = $3,
          updated_at = CURRENT_TIMESTAMP
      WHERE job_id = $1
    `;
    await pool.query(query, [jobId, totalPages, totalChunks]);
  }

  /**
   * Mark a task as complete with result data
   */
  async completeTask(jobId: string, resultData: any): Promise<void> {
    await this.updateStatus(jobId, 'completed', {
      progress: 100,
      resultData,
    });
    this.cleanup(jobId);
  }

  /**
   * Mark a task as failed with errors
   */
  async failTask(jobId: string, errors: string[]): Promise<void> {
    await this.updateStatus(jobId, 'failed', { errors });
    this.cleanup(jobId);
  }

  /**
   * Recover interrupted tasks on server startup
   * Marks any 'processing' or 'queued' tasks as failed since they were interrupted
   */
  async recoverInterruptedTasks(): Promise<number> {
    const query = `
      UPDATE pdf_processing_tasks
      SET
        status = 'failed',
        errors = COALESCE(errors, ARRAY[]::TEXT[]) || ARRAY['服务器重启，任务中断。请重新提交。'],
        completed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE status IN ('processing', 'queued', 'uploading')
      RETURNING job_id
    `;

    try {
      const result = await pool.query(query);
      const count = result.rowCount || 0;

      if (count > 0) {
        console.log(`🔄 Recovered ${count} interrupted task(s) on startup:`);
        result.rows.forEach(row => {
          console.log(`   - ${row.job_id}`);
        });
      }

      return count;
    } catch (err) {
      console.error('Failed to recover interrupted tasks:', err);
      return 0;
    }
  }
}

// Export singleton instance
export const taskManager = TaskManager.getInstance();
