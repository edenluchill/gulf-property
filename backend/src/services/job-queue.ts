/**
 * Job Queue Manager
 *
 * Limits concurrent PDF processing jobs to prevent OOM
 * Uses p-limit for sliding window concurrency control
 */

import pLimit from 'p-limit';

// Configuration
// Keep low to avoid CPU saturation - PDF processing is very CPU-intensive
// cpx32 has 4 vCPUs, but each PDF job can use 100%+ CPU during image conversion
const MAX_CONCURRENT_JOBS = 1;  // Process one at a time to keep API responsive

// Create the limiter
const jobLimiter = pLimit(MAX_CONCURRENT_JOBS);

// Track queue state
interface QueuedJob {
  jobId: string;
  queuedAt: number;
  startedAt?: number;
}

const queuedJobs = new Map<string, QueuedJob>();
const processingJobs = new Set<string>();

/**
 * Get current queue position for a job
 */
export function getQueuePosition(jobId: string): number {
  const jobs = Array.from(queuedJobs.values())
    .filter(j => !j.startedAt)  // Only queued, not started
    .sort((a, b) => a.queuedAt - b.queuedAt);

  const index = jobs.findIndex(j => j.jobId === jobId);
  return index === -1 ? 0 : index + 1;
}

/**
 * Get queue stats
 */
export function getQueueStats() {
  return {
    maxConcurrent: MAX_CONCURRENT_JOBS,
    processing: processingJobs.size,
    queued: queuedJobs.size - processingJobs.size,
    pendingCount: jobLimiter.pendingCount,
    activeCount: jobLimiter.activeCount,
  };
}

/**
 * Execute a job with queue management
 *
 * @param jobId - Unique job identifier
 * @param onQueued - Called when job is queued (with position)
 * @param onStart - Called when job starts processing
 * @param executor - The actual job execution function
 */
export async function executeWithQueue<T>(
  jobId: string,
  onQueued: (position: number, stats: ReturnType<typeof getQueueStats>) => void,
  onStart: () => void,
  executor: () => Promise<T>
): Promise<T> {
  // Register job as queued
  queuedJobs.set(jobId, {
    jobId,
    queuedAt: Date.now(),
  });

  // Calculate initial queue position
  const position = getQueuePosition(jobId);
  const stats = getQueueStats();

  // If we're not starting immediately, notify
  if (jobLimiter.activeCount >= MAX_CONCURRENT_JOBS) {
    console.log(`📋 Job ${jobId} queued at position ${position} (${stats.processing} processing, ${stats.queued} waiting)`);
    onQueued(position, stats);
  }

  try {
    // Wait for slot in the queue
    return await jobLimiter(async () => {
      // Mark as processing
      const job = queuedJobs.get(jobId);
      if (job) {
        job.startedAt = Date.now();
      }
      processingJobs.add(jobId);

      console.log(`🚀 Job ${jobId} starting (waited ${job ? Date.now() - job.queuedAt : 0}ms in queue)`);
      onStart();

      try {
        return await executor();
      } finally {
        // Cleanup
        processingJobs.delete(jobId);
        queuedJobs.delete(jobId);
      }
    });
  } catch (error) {
    // Cleanup on error
    processingJobs.delete(jobId);
    queuedJobs.delete(jobId);
    throw error;
  }
}

/**
 * Check if a job can start immediately (no queue wait)
 */
export function canStartImmediately(): boolean {
  return jobLimiter.activeCount < MAX_CONCURRENT_JOBS;
}

export { MAX_CONCURRENT_JOBS };
