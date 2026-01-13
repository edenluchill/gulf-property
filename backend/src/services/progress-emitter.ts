/**
 * Progress Emitter Service
 * 
 * Manages real-time progress updates for PDF processing workflow
 * using Server-Sent Events (SSE)
 */

import { Response } from 'express';

export interface ProgressEvent {
  stage: 'starting' | 'ingestion' | 'mapping' | 'reducing' | 'insight' | 'complete' | 'error';
  message: string;
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
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable Nginx buffering

    this.clients.set(jobId, res);

    // Send initial connection message
    this.emit(jobId, {
      stage: 'starting',
      message: 'Connected to processing stream',
      progress: 0,
      timestamp: Date.now(),
    });

    // Clean up on disconnect
    res.on('close', () => {
      this.clients.delete(jobId);
    });
  }

  /**
   * Emit progress event to a specific client
   */
  emit(jobId: string, event: ProgressEvent) {
    const client = this.clients.get(jobId);
    if (!client) return;

    try {
      // Format as SSE
      const data = JSON.stringify(event);
      client.write(`data: ${data}\n\n`);
    } catch (error) {
      console.error('Error emitting progress:', error);
      this.clients.delete(jobId);
    }
  }

  /**
   * Close connection for a job
   */
  complete(jobId: string, finalData?: any) {
    this.emit(jobId, {
      stage: 'complete',
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
