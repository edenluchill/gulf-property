/**
 * Progress Emitter Service (Worker Version)
 *
 * Simplified version for worker - updates database directly without SSE.
 * The frontend polls the database for progress updates.
 */

import { taskManager } from './task-manager';

export interface ProgressEvent {
  stage: 'starting' | 'queued' | 'ingestion' | 'mapping' | 'reducing' | 'insight' | 'complete' | 'error';
  code: string;  // Machine-readable code for i18n
  message: string;  // English message for backend logs
  progress: number; // 0-100
  currentPage?: number;
  totalPages?: number;
  data?: any;
  timestamp: number;
}

export class ProgressEmitter {
  // Track completed jobs to avoid race conditions with async updates
  private completedJobs = new Set<string>();

  /**
   * Emit progress event - updates database directly
   */
  emit(jobId: string, event: ProgressEvent) {
    // Skip if job is already marked complete (avoid race condition)
    if (this.completedJobs.has(jobId)) {
      return;
    }

    console.log(`📊 [${jobId}] ${event.stage}: ${event.message} (${event.progress}%)`);

    // Update database with progress (async, don't await)
    this.updateTaskProgress(jobId, event).catch(err => {
      console.warn(`⚠️ Failed to update task progress in DB:`, err);
    });
  }

  /**
   * Update task progress in database
   */
  private async updateTaskProgress(jobId: string, event: ProgressEvent) {
    // Skip if job was marked complete while we were waiting
    if (this.completedJobs.has(jobId)) {
      return;
    }

    // Skip 'starting' and 'error' events - those are handled elsewhere
    if (event.stage === 'starting' || event.stage === 'error' || event.stage === 'complete') {
      return;
    }

    // Map stage to human-readable string
    const stageLabels: Record<string, string> = {
      ingestion: 'Extracting pages',
      mapping: 'Analyzing pages',
      reducing: 'Aggregating results',
      insight: 'Generating insights',
    };

    await taskManager.updateStatus(jobId, 'processing', {
      progress: event.progress,
      currentStage: event.message || stageLabels[event.stage] || event.stage,
    });
  }

  /**
   * Mark job as complete - prevents further progress updates
   */
  complete(jobId: string, finalData?: any) {
    this.completedJobs.add(jobId);
    console.log(`✅ [${jobId}] Processing complete`);
  }

  /**
   * Send error event
   */
  error(jobId: string, errorMessage: string) {
    console.error(`❌ [${jobId}] Error: ${errorMessage}`);
  }

  /**
   * Check if a client is connected (always false for worker)
   */
  hasClient(jobId: string): boolean {
    return false;
  }
}

// Global singleton instance
export const progressEmitter = new ProgressEmitter();
