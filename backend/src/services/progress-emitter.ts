/**
 * Progress Emitter Service
 *
 * Manages real-time progress updates for PDF processing workflow
 * using Server-Sent Events (SSE)
 */

import { Response } from 'express';
import { taskManager } from './task-manager';

export interface ProgressEvent {
  stage: 'starting' | 'ingestion' | 'mapping' | 'reducing' | 'insight' | 'complete' | 'error';
  code: string;  // Machine-readable code for i18n
  message: string;  // English message for backend logs
  progress: number; // 0-100
  currentPage?: number;
  totalPages?: number;
  data?: any;
  timestamp: number;
}

export class ProgressEmitter {
  private clients: Map<string, Response> = new Map();

  /**
   * Register a new SSE client
   */
  registerClient(jobId: string, res: Response) {
    console.log(`📡 Registering SSE client for job ${jobId}`);
    
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable Nginx buffering
    
    // ⭐ CRITICAL FIX: Disable Nagle's algorithm to send data immediately
    // This prevents TCP from buffering small packets
    const socket = (res as any).socket;
    if (socket && typeof socket.setNoDelay === 'function') {
      socket.setNoDelay(true);
      console.log(`   ✅ TCP_NODELAY enabled for immediate SSE delivery`);
    }
    
    res.flushHeaders(); // ⭐ Important: Send headers immediately

    this.clients.set(jobId, res);
    console.log(`   Total active clients: ${this.clients.size}`);

    // Send initial connection message
    this.emit(jobId, {
      stage: 'starting',
      code: 'CONNECTED',
      message: 'Connected to processing stream',
      progress: 0,
      timestamp: Date.now(),
    });

    // Clean up on disconnect
    res.on('close', () => {
      console.log(`🔌 Client disconnected for job ${jobId}`);
      this.clients.delete(jobId);
    });
  }

  /**
   * Emit progress event to a specific client
   */
  emit(jobId: string, event: ProgressEvent) {
    const client = this.clients.get(jobId);
    if (!client) {
      console.warn(`⚠️ No client found for job ${jobId}`);
      return;
    }

    try {
      // Format as SSE
      const data = JSON.stringify(event);
      client.write(`data: ${data}\n\n`);

      // ⭐ Data is sent immediately due to socket.setNoDelay(true) in registerClient
      // No need to manually flush

      console.log(`📤 Sent event to ${jobId}: ${event.stage} (${event.progress}%)`);

      // Also update database with progress (async, don't await)
      this.updateTaskProgress(jobId, event).catch(err => {
        console.warn(`⚠️ Failed to update task progress in DB:`, err);
      });
    } catch (error) {
      console.error(`❌ Error emitting progress for job ${jobId}:`, error);
      this.clients.delete(jobId);
    }
  }

  /**
   * Update task progress in database
   */
  private async updateTaskProgress(jobId: string, event: ProgressEvent) {
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
   * Close connection for a job
   */
  complete(jobId: string, finalData?: any) {
    this.emit(jobId, {
      stage: 'complete',
      code: 'COMPLETE',
      message: 'Processing complete',
      progress: 100,
      data: finalData,
      timestamp: Date.now(),
    });

    const client = this.clients.get(jobId);
    if (client) {
      client.end();
      this.clients.delete(jobId);
    }
  }

  /**
   * Send error event
   */
  error(jobId: string, errorMessage: string) {
    this.emit(jobId, {
      stage: 'error',
      code: 'ERROR',
      message: errorMessage,
      progress: 0,
      timestamp: Date.now(),
    });

    const client = this.clients.get(jobId);
    if (client) {
      client.end();
      this.clients.delete(jobId);
    }
  }

  /**
   * Check if a client is connected
   */
  hasClient(jobId: string): boolean {
    return this.clients.has(jobId);
  }
}

// Global singleton instance
export const progressEmitter = new ProgressEmitter();
