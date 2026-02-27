/**
 * Job Poller
 *
 * Polls the database for pending jobs and emits them for processing.
 * Uses PostgreSQL row locking to prevent multiple workers from claiming the same job.
 */

import { EventEmitter } from 'events';
import { pool } from './db';

export interface PendingJob {
  job_id: string;
  user_id: string | null;
  user_email: string | null;
  pdf_names: string[];
  pdf_urls: string[];  // R2 keys for PDFs
  total_chunks: number;
  processed_chunks: number;
  checkpoint_data: any;
  created_at: Date;
  metadata: any;
}

interface PollerConfig {
  pollIntervalMs: number;
  maxConcurrentJobs: number;
  workerId: string;
}

export class JobPoller extends EventEmitter {
  private config: PollerConfig;
  private isRunning = false;
  private activeJobCount = 0;
  private pollTimer: NodeJS.Timeout | null = null;

  constructor(config: PollerConfig) {
    super();
    this.config = config;
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    this.poll();
  }

  stop(): void {
    this.isRunning = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async poll(): Promise<void> {
    if (!this.isRunning) return;

    try {
      // Only poll if we have capacity
      if (this.activeJobCount < this.config.maxConcurrentJobs) {
        const job = await this.claimNextJob();
        if (job) {
          this.activeJobCount++;
          // Emit job for processing (async, don't await)
          this.emit('job', job);
          // Decrement when done
          this.once(`job-done:${job.job_id}`, () => {
            this.activeJobCount--;
          });
        }
      }
    } catch (error) {
      this.emit('error', error);
    }

    // Schedule next poll
    this.pollTimer = setTimeout(() => this.poll(), this.config.pollIntervalMs);
  }

  /**
   * Claim the next pending job using row-level locking
   */
  private async claimNextJob(): Promise<PendingJob | null> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Find and lock the oldest pending job
      // FOR UPDATE SKIP LOCKED prevents race conditions between workers
      const result = await client.query(`
        SELECT
          job_id,
          user_id,
          user_email,
          pdf_names,
          pdf_urls,
          total_chunks,
          processed_chunks,
          checkpoint_data,
          created_at,
          metadata
        FROM pdf_processing_tasks
        WHERE status = 'pending'
          AND pdf_urls IS NOT NULL
          AND array_length(pdf_urls, 1) > 0
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `);

      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        return null;
      }

      const job = result.rows[0] as PendingJob;

      // Update status to 'processing' and set worker ID
      await client.query(`
        UPDATE pdf_processing_tasks
        SET
          status = 'processing',
          started_at = NOW(),
          updated_at = NOW(),
          worker_id = $2,
          current_stage = 'Worker claimed job'
        WHERE job_id = $1
      `, [job.job_id, this.config.workerId]);

      await client.query('COMMIT');

      console.log(`📋 Claimed job: ${job.job_id} (${job.pdf_names?.length || 0} PDFs)`);
      return job;

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Notify that a job is complete (success or failure)
   */
  notifyJobDone(jobId: string): void {
    this.emit(`job-done:${jobId}`);
  }
}
