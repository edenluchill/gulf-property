/**
 * Progress Emitter Service
 *
 * Manages real-time progress updates for PDF processing workflow
 * using Server-Sent Events (SSE)
 */

import { Response } from 'express';
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
  private clients: Map<string, Response> = new Map();
  // ⭐ DB进度写入节流：jobId → { at: 上次写入时间, progress: 上次写入进度 }
  private lastDbWrite: Map<string, { at: number; progress: number }> = new Map();

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
    // ⭐ DB更新必须先于SSE client检查：worker进程上没有SSE client
    // （client连在API服务器上，API的SSE靠轮询DB），之前这里直接return
    // 导致worker模式下所有细粒度进度丢失，前端长时间卡在6%
    this.updateTaskProgressThrottled(jobId, event);

    const client = this.clients.get(jobId);
    if (!client) {
      return;
    }

    try {
      // Format as SSE
      const data = JSON.stringify(event);
      client.write(`data: ${data}\n\n`);

      // ⭐ Data is sent immediately due to socket.setNoDelay(true) in registerClient
      // No need to manually flush

      console.log(`📤 Sent event to ${jobId}: ${event.stage} (${event.progress}%)`);
    } catch (error) {
      console.error(`❌ Error emitting progress for job ${jobId}:`, error);
      this.clients.delete(jobId);
    }
  }

  /**
   * 节流后的DB进度写入：同一job至少间隔1.5s或进度前进≥1%才写，
   * 避免图片生成阶段每张图一次DB UPDATE
   */
  private updateTaskProgressThrottled(jobId: string, event: ProgressEvent) {
    if (event.stage === 'starting' || event.stage === 'queued' || event.stage === 'error' || event.stage === 'complete') {
      return;
    }
    const last = this.lastDbWrite.get(jobId);
    const now = Date.now();
    if (last && now - last.at < 1500 && event.progress < last.progress + 1) {
      return;
    }
    this.lastDbWrite.set(jobId, { at: now, progress: event.progress });
    this.updateTaskProgress(jobId, event).catch(err => {
      console.warn(`⚠️ Failed to update task progress in DB:`, err);
    });
  }

  /**
   * Update task progress in database
   */
  private async updateTaskProgress(jobId: string, event: ProgressEvent) {
    // Skip events that shouldn't trigger status updates:
    // - 'starting': just SSE connection
    // - 'queued': task is waiting for worker, don't change status
    // - 'error': handled by failTask()
    // - 'complete': handled by completeTask()
    if (event.stage === 'starting' || event.stage === 'queued' || event.stage === 'error' || event.stage === 'complete') {
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

    this.lastDbWrite.delete(jobId);
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

    this.lastDbWrite.delete(jobId);
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
