/**
 * Task SSE Manager
 *
 * Manages Server-Sent Events connections for real-time task progress updates.
 * Supports automatic reconnection and integrates with the task store.
 */

import { API_BASE_URL } from './config';
import { useTaskStore, TaskStatus } from '../stores/taskStore';

// SSE event types
export interface TaskProgressEvent {
  type: 'status' | 'progress' | 'complete' | 'error';
  status?: TaskStatus;
  progress?: number;
  stage?: string;
  code?: string;
  message?: string;
  data?: any;
  errors?: string[];
  timestamp?: number;
}

// Connection state
interface SSEConnection {
  eventSource: EventSource;
  jobId: string;
  reconnectAttempts: number;
  maxReconnectAttempts: number;
}

// Active connections map
const connections = new Map<string, SSEConnection>();

// Reconnect delay (exponential backoff)
const getReconnectDelay = (attempts: number): number => {
  return Math.min(1000 * Math.pow(2, attempts), 30000);
};

/**
 * Connect to task progress stream
 */
export function connectToTaskStream(
  jobId: string,
  callbacks?: {
    onProgress?: (event: TaskProgressEvent) => void;
    onComplete?: (data: any) => void;
    onError?: (error: string) => void;
  }
): () => void {
  // Close existing connection if any
  disconnectFromTaskStream(jobId);

  const url = `${API_BASE_URL}/api/tasks/${jobId}/stream`;

  const connect = (reconnectAttempts = 0): EventSource => {
    const eventSource = new EventSource(url);

    const connection: SSEConnection = {
      eventSource,
      jobId,
      reconnectAttempts,
      maxReconnectAttempts: 5,
    };

    connections.set(jobId, connection);

    eventSource.onmessage = (event) => {
      try {
        const data: TaskProgressEvent = JSON.parse(event.data);

        // Update task store
        const updateTask = useTaskStore.getState().updateTask;

        switch (data.type) {
          case 'status':
            updateTask(jobId, {
              status: data.status,
              progress: data.progress ?? 0,
              current_stage: data.stage ?? null,
            });
            callbacks?.onProgress?.(data);
            break;

          case 'progress':
            updateTask(jobId, {
              progress: data.progress ?? 0,
              current_stage: data.stage ?? data.message ?? null,
            });
            callbacks?.onProgress?.(data);
            break;

          case 'complete':
            updateTask(jobId, {
              status: 'completed',
              progress: 100,
              result_data: data.data,
              completed_at: new Date().toISOString(),
            });
            callbacks?.onComplete?.(data.data);
            // Close connection after completion
            disconnectFromTaskStream(jobId);
            break;

          case 'error':
            const errorMessage = data.errors?.join('; ') || data.message || 'Unknown error';
            updateTask(jobId, {
              status: 'failed',
              errors: data.errors || [errorMessage],
              completed_at: new Date().toISOString(),
            });
            callbacks?.onError?.(errorMessage);
            // Close connection after error
            disconnectFromTaskStream(jobId);
            break;
        }
      } catch (err) {
        console.error('Failed to parse SSE event:', err);
      }
    };

    eventSource.onerror = () => {
      const conn = connections.get(jobId);
      if (!conn) return;

      eventSource.close();

      // Check if we should reconnect
      if (conn.reconnectAttempts < conn.maxReconnectAttempts) {
        const delay = getReconnectDelay(conn.reconnectAttempts);
        console.log(`SSE connection lost for ${jobId}, reconnecting in ${delay}ms...`);

        setTimeout(() => {
          const currentConn = connections.get(jobId);
          if (currentConn) {
            connect(currentConn.reconnectAttempts + 1);
          }
        }, delay);
      } else {
        console.error(`Max reconnect attempts reached for ${jobId}`);
        callbacks?.onError?.('Connection lost');
        connections.delete(jobId);
      }
    };

    eventSource.onopen = () => {
      const conn = connections.get(jobId);
      if (conn) {
        conn.reconnectAttempts = 0;
      }
      console.log(`SSE connection established for ${jobId}`);
    };

    return eventSource;
  };

  connect();

  // Return cleanup function
  return () => disconnectFromTaskStream(jobId);
}

/**
 * Disconnect from task progress stream
 */
export function disconnectFromTaskStream(jobId: string): void {
  const connection = connections.get(jobId);
  if (connection) {
    connection.eventSource.close();
    connections.delete(jobId);
    console.log(`SSE connection closed for ${jobId}`);
  }
}

/**
 * Disconnect all task streams
 */
export function disconnectAllTaskStreams(): void {
  for (const [jobId, connection] of connections) {
    connection.eventSource.close();
    console.log(`SSE connection closed for ${jobId}`);
  }
  connections.clear();
}

/**
 * Check if connected to a task stream
 */
export function isConnectedToTaskStream(jobId: string): boolean {
  const connection = connections.get(jobId);
  return connection?.eventSource.readyState === EventSource.OPEN;
}

/**
 * Get active connection count
 */
export function getActiveConnectionCount(): number {
  return connections.size;
}

/**
 * Hook for managing task SSE connection
 */
import { useEffect, useRef } from 'react';

export function useTaskSSE(
  jobId: string | null,
  callbacks?: {
    onProgress?: (event: TaskProgressEvent) => void;
    onComplete?: (data: any) => void;
    onError?: (error: string) => void;
  }
): void {
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!jobId) {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
      return;
    }

    cleanupRef.current = connectToTaskStream(jobId, callbacks);

    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, [jobId, callbacks]);
}
