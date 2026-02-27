/**
 * Task Store
 *
 * Zustand store for managing PDF processing tasks with persistence.
 * Provides real-time task tracking, pause/resume, and cancellation.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { API_BASE_URL } from '../lib/config';

// Task status types
export type TaskStatus = 'pending' | 'uploading' | 'queued' | 'processing' | 'paused' | 'completed' | 'failed' | 'cancelled';

// Task interface matching backend
export interface Task {
  id: string;
  job_id: string;
  user_id: string;
  user_email: string | null;
  task_name: string | null;
  pdf_count: number;
  pdf_names: string[];
  total_pages: number | null;
  status: TaskStatus;
  progress: number;
  current_stage: string | null;
  paused_at: string | null;
  total_chunks: number | null;
  processed_chunks: number;
  result_data: any | null;
  errors: string[];
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

// Store state interface
interface TaskState {
  tasks: Task[];
  activeTaskId: string | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  addTask: (task: Task) => void;
  updateTask: (jobId: string, updates: Partial<Task>) => void;
  removeTask: (jobId: string) => void;
  setActiveTask: (jobId: string | null) => void;
  setError: (error: string | null) => void;

  // API actions
  fetchUserTasks: () => Promise<void>;
  pauseTask: (jobId: string) => Promise<void>;
  resumeTask: (jobId: string) => Promise<void>;
  cancelTask: (jobId: string) => Promise<void>;

  // Getters
  getTask: (jobId: string) => Task | undefined;
  getActiveTasks: () => Task[];
  getCompletedTasks: () => Task[];
}

// Get user headers for API calls
function getUserHeaders(): HeadersInit {
  // In production, this would get the actual user ID from auth
  const userId = localStorage.getItem('userId') || 'anonymous';
  const userEmail = localStorage.getItem('userEmail') || '';

  return {
    'Content-Type': 'application/json',
    'x-user-id': userId,
    'x-user-email': userEmail,
  };
}

export const useTaskStore = create<TaskState>()(
  persist(
    (set, get) => ({
      tasks: [],
      activeTaskId: null,
      isLoading: false,
      error: null,

      // Add a new task
      addTask: (task) => {
        set((state) => ({
          tasks: [task, ...state.tasks.filter(t => t.job_id !== task.job_id)],
        }));
      },

      // Update an existing task
      updateTask: (jobId, updates) => {
        set((state) => ({
          tasks: state.tasks.map((task) =>
            task.job_id === jobId ? { ...task, ...updates } : task
          ),
        }));
      },

      // Remove a task
      removeTask: (jobId) => {
        set((state) => ({
          tasks: state.tasks.filter((task) => task.job_id !== jobId),
          activeTaskId: state.activeTaskId === jobId ? null : state.activeTaskId,
        }));
      },

      // Set active task
      setActiveTask: (jobId) => {
        set({ activeTaskId: jobId });
      },

      // Set error
      setError: (error) => {
        set({ error });
      },

      // Fetch user's tasks from API
      fetchUserTasks: async () => {
        set({ isLoading: true, error: null });

        try {
          const response = await fetch(`${API_BASE_URL}/api/tasks`, {
            headers: getUserHeaders(),
          });

          if (!response.ok) {
            throw new Error('Failed to fetch tasks');
          }

          const data = await response.json();

          if (data.success) {
            set({ tasks: data.tasks, isLoading: false });
          } else {
            throw new Error(data.error || 'Failed to fetch tasks');
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          set({ error: message, isLoading: false });
        }
      },

      // Pause a running task
      pauseTask: async (jobId) => {
        try {
          const response = await fetch(`${API_BASE_URL}/api/tasks/${jobId}/pause`, {
            method: 'POST',
            headers: getUserHeaders(),
          });

          if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Failed to pause task');
          }

          // Update local state optimistically
          get().updateTask(jobId, { status: 'paused' });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          set({ error: message });
          throw error;
        }
      },

      // Resume a paused task
      resumeTask: async (jobId) => {
        try {
          const response = await fetch(`${API_BASE_URL}/api/tasks/${jobId}/resume`, {
            method: 'POST',
            headers: getUserHeaders(),
          });

          if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Failed to resume task');
          }

          // Update local state optimistically
          get().updateTask(jobId, { status: 'processing' });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          set({ error: message });
          throw error;
        }
      },

      // Cancel a task
      cancelTask: async (jobId) => {
        try {
          const response = await fetch(`${API_BASE_URL}/api/tasks/${jobId}/cancel`, {
            method: 'POST',
            headers: getUserHeaders(),
          });

          if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Failed to cancel task');
          }

          // Update local state optimistically
          get().updateTask(jobId, { status: 'cancelled' });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          set({ error: message });
          throw error;
        }
      },

      // Get a specific task
      getTask: (jobId) => {
        return get().tasks.find((task) => task.job_id === jobId);
      },

      // Get active (running/paused) tasks
      getActiveTasks: () => {
        return get().tasks.filter((task) =>
          ['pending', 'uploading', 'processing', 'paused'].includes(task.status)
        );
      },

      // Get completed tasks
      getCompletedTasks: () => {
        return get().tasks.filter((task) =>
          ['completed', 'failed', 'cancelled'].includes(task.status)
        );
      },
    }),
    {
      name: 'gulf-property-tasks',
      partialize: (state) => ({
        // Only persist tasks, not loading/error state
        tasks: state.tasks,
        activeTaskId: state.activeTaskId,
      }),
    }
  )
);

// Selector hooks for common patterns
export const useActiveTasks = () => useTaskStore((state) => state.getActiveTasks());
export const useCompletedTasks = () => useTaskStore((state) => state.getCompletedTasks());
export const useActiveTask = () => {
  const activeTaskId = useTaskStore((state) => state.activeTaskId);
  const getTask = useTaskStore((state) => state.getTask);
  return activeTaskId ? getTask(activeTaskId) : undefined;
};
