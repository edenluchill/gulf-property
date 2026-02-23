/**
 * Admin Tasks Page
 *
 * Admin interface for managing all PDF processing tasks.
 * Features:
 * - Task list with pagination
 * - Status filtering
 * - Real-time progress updates
 * - Batch operations (cancel/delete)
 * - Task detail expansion
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { API_ENDPOINTS } from '../lib/config';
import { TaskStatus } from '../stores/taskStore';
import { XCircle, Home, Image, CreditCard, Trees, FileText, X } from 'lucide-react';

// Task interface for admin view
interface AdminTask {
  id: string;
  job_id: string;
  user_id: string;
  user_email: string | null;
  task_name: string | null;
  pdf_count: number;
  pdf_names: string[];
  total_pages: number | null;
  total_size_bytes: number | null;
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

// Stats interface
interface TaskStats {
  total: number;
  byStatus: Record<TaskStatus, number>;
  activeCount: number;
  completedToday: number;
  failedToday: number;
}

// Log entry interface
interface LogEntry {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  stage: string;
  message: string;
  data?: any;
}

// Log level colors
const logLevelColors: Record<string, string> = {
  debug: 'text-gray-500 bg-gray-50',
  info: 'text-blue-700 bg-blue-50',
  warn: 'text-yellow-700 bg-yellow-50',
  error: 'text-red-700 bg-red-50',
};

// Status badge colors
const statusColors: Record<TaskStatus, string> = {
  pending: 'bg-gray-100 text-gray-800',
  uploading: 'bg-blue-100 text-blue-800',
  processing: 'bg-yellow-100 text-yellow-800',
  paused: 'bg-orange-100 text-orange-800',
  completed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  cancelled: 'bg-gray-100 text-gray-600',
};

export default function AdminTasksPage() {
  useTranslation(); // Available for future i18n
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<AdminTask[]>([]);
  const [stats, setStats] = useState<TaskStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<TaskStatus | 'all'>('all');
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [pagination, setPagination] = useState({
    offset: 0,
    limit: 20,
    total: 0,
    hasMore: false,
  });

  // Log viewer state
  const [viewingLogs, setViewingLogs] = useState<string | null>(null); // jobId
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  // Fetch logs for a task
  const fetchLogs = async (jobId: string) => {
    setLogsLoading(true);
    setViewingLogs(jobId);
    try {
      const response = await fetch(API_ENDPOINTS.adminTaskLogs(jobId), {
        headers: {
          'x-user-id': 'admin',
          'x-admin': 'true',
        },
      });
      if (!response.ok) throw new Error('Failed to fetch logs');
      const data = await response.json();
      setLogs(data.logs || []);
    } catch (err) {
      console.error('Failed to fetch logs:', err);
      setLogs([]);
    } finally {
      setLogsLoading(false);
    }
  };

  // Fetch tasks
  const fetchTasks = useCallback(async () => {
    try {
      setLoading(true);
      const url = new URL(API_ENDPOINTS.adminTasks);
      url.searchParams.set('limit', pagination.limit.toString());
      url.searchParams.set('offset', pagination.offset.toString());
      if (statusFilter !== 'all') {
        url.searchParams.set('status', statusFilter);
      }

      const response = await fetch(url.toString(), {
        headers: {
          'x-user-id': 'admin',
          'x-admin': 'true',
        },
      });

      if (!response.ok) throw new Error('Failed to fetch tasks');

      const data = await response.json();
      setTasks(data.tasks);
      setPagination(prev => ({
        ...prev,
        total: data.pagination.total,
        hasMore: data.pagination.hasMore,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [pagination.offset, pagination.limit, statusFilter]);

  // Fetch stats
  const fetchStats = useCallback(async () => {
    try {
      const response = await fetch(API_ENDPOINTS.adminTaskStats, {
        headers: {
          'x-user-id': 'admin',
          'x-admin': 'true',
        },
      });

      if (!response.ok) throw new Error('Failed to fetch stats');

      const data = await response.json();
      setStats(data.stats);
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
    fetchStats();

    // Refresh every 10 seconds
    const interval = setInterval(() => {
      fetchTasks();
      fetchStats();
    }, 10000);

    return () => clearInterval(interval);
  }, [fetchTasks, fetchStats]);

  // Handle task selection
  const toggleTaskSelection = (jobId: string) => {
    setSelectedTasks(prev => {
      const next = new Set(prev);
      if (next.has(jobId)) {
        next.delete(jobId);
      } else {
        next.add(jobId);
      }
      return next;
    });
  };

  // Select all tasks
  const selectAllTasks = () => {
    if (selectedTasks.size === tasks.length) {
      setSelectedTasks(new Set());
    } else {
      setSelectedTasks(new Set(tasks.map(t => t.job_id)));
    }
  };

  // Cancel selected tasks
  const cancelSelectedTasks = async () => {
    if (selectedTasks.size === 0) return;
    if (!confirm(`Cancel ${selectedTasks.size} task(s)?`)) return;

    try {
      const response = await fetch(API_ENDPOINTS.adminTasksBatchCancel, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': 'admin',
          'x-admin': 'true',
        },
        body: JSON.stringify({ jobIds: Array.from(selectedTasks) }),
      });

      if (!response.ok) throw new Error('Failed to cancel tasks');

      setSelectedTasks(new Set());
      fetchTasks();
      fetchStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel tasks');
    }
  };

  // Delete selected tasks
  const deleteSelectedTasks = async () => {
    if (selectedTasks.size === 0) return;
    if (!confirm(`Delete ${selectedTasks.size} task(s)? This cannot be undone.`)) return;

    try {
      const response = await fetch(API_ENDPOINTS.adminTasksBatchDelete, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': 'admin',
          'x-admin': 'true',
        },
        body: JSON.stringify({ jobIds: Array.from(selectedTasks) }),
      });

      if (!response.ok) throw new Error('Failed to delete tasks');

      setSelectedTasks(new Set());
      fetchTasks();
      fetchStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete tasks');
    }
  };

  // Pause a single task
  const pauseTask = async (jobId: string) => {
    try {
      const response = await fetch(API_ENDPOINTS.adminTaskPause(jobId), {
        method: 'POST',
        headers: {
          'x-user-id': 'admin',
          'x-admin': 'true',
        },
      });

      if (!response.ok) throw new Error('Failed to pause task');

      fetchTasks();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to pause task');
    }
  };

  // Cancel a single task
  const cancelTask = async (jobId: string) => {
    if (!confirm('Cancel this task?')) return;

    try {
      const response = await fetch(API_ENDPOINTS.adminTaskCancel(jobId), {
        method: 'POST',
        headers: {
          'x-user-id': 'admin',
          'x-admin': 'true',
        },
      });

      if (!response.ok) throw new Error('Failed to cancel task');

      fetchTasks();
      fetchStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel task');
    }
  };

  // Delete a single task
  const deleteTask = async (jobId: string) => {
    if (!confirm('Delete this task? This cannot be undone.')) return;

    try {
      const response = await fetch(API_ENDPOINTS.adminTask(jobId), {
        method: 'DELETE',
        headers: {
          'x-user-id': 'admin',
          'x-admin': 'true',
        },
      });

      if (!response.ok) throw new Error('Failed to delete task');

      fetchTasks();
      fetchStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete task');
    }
  };

  // Get result summary from task
  const getResultSummary = (task: AdminTask) => {
    const result = task.result_data;
    if (!result) return null;

    return {
      units: result.summary?.unitsCount ?? result.buildingData?.units?.length ?? 0,
      paymentPlans: result.summary?.paymentPlansCount ?? result.buildingData?.paymentPlans?.length ?? 0,
      amenities: result.summary?.amenitiesCount ?? result.buildingData?.amenities?.length ?? 0,
      projectImages: result.summary?.projectImagesCount ?? result.buildingData?.images?.projectImages?.length ?? 0,
      floorPlanImages: result.summary?.floorPlanImagesCount ?? result.buildingData?.images?.floorPlanImages?.length ?? 0,
      errors: result.errors?.length ?? 0,
      warnings: result.warnings?.length ?? 0,
    };
  };

  // Format date
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString();
  };

  // Format duration
  const formatDuration = (start: string | null, end: string | null) => {
    if (!start) return '-';
    const startTime = new Date(start).getTime();
    const endTime = end ? new Date(end).getTime() : Date.now();
    const seconds = Math.floor((endTime - startTime) / 1000);

    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  };

  // Format file size
  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return null;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  return (
    <div className="flex-1 bg-gray-50 p-6 overflow-auto">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Task Management</h1>
          <p className="text-gray-600">Manage PDF processing tasks</p>
        </div>

        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-sm text-gray-500">Total</div>
              <div className="text-2xl font-bold">{stats.total}</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-sm text-gray-500">Active</div>
              <div className="text-2xl font-bold text-yellow-600">{stats.activeCount}</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-sm text-gray-500">Processing</div>
              <div className="text-2xl font-bold text-blue-600">{stats.byStatus.processing}</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-sm text-gray-500">Completed Today</div>
              <div className="text-2xl font-bold text-green-600">{stats.completedToday}</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-sm text-gray-500">Failed Today</div>
              <div className="text-2xl font-bold text-red-600">{stats.failedToday}</div>
            </div>
          </div>
        )}

        {/* Filters and Actions */}
        <div className="bg-white rounded-lg shadow mb-6 p-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            {/* Status Filter */}
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600">Status:</label>
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value as TaskStatus | 'all');
                  setPagination(prev => ({ ...prev, offset: 0 }));
                }}
                className="border rounded px-3 py-1.5 text-sm"
              >
                <option value="all">All</option>
                <option value="processing">Processing</option>
                <option value="paused">Paused</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>

            {/* Batch Actions */}
            <div className="flex items-center gap-2">
              {selectedTasks.size > 0 && (
                <>
                  <span className="text-sm text-gray-600">
                    {selectedTasks.size} selected
                  </span>
                  <button
                    onClick={cancelSelectedTasks}
                    className="px-3 py-1.5 bg-orange-100 text-orange-700 rounded text-sm hover:bg-orange-200"
                  >
                    Cancel Selected
                  </button>
                  <button
                    onClick={deleteSelectedTasks}
                    className="px-3 py-1.5 bg-red-100 text-red-700 rounded text-sm hover:bg-red-200"
                  >
                    Delete Selected
                  </button>
                </>
              )}
              <button
                onClick={fetchTasks}
                className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded text-sm hover:bg-gray-200"
              >
                Refresh
              </button>
            </div>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-6">
            {error}
            <button
              onClick={() => setError(null)}
              className="float-right text-red-500 hover:text-red-700"
            >
              &times;
            </button>
          </div>
        )}

        {/* Task List */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left">
                  <input
                    type="checkbox"
                    checked={selectedTasks.size === tasks.length && tasks.length > 0}
                    onChange={selectAllTasks}
                    className="rounded"
                  />
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Task
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Progress
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  User
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Duration
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading && tasks.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                    Loading...
                  </td>
                </tr>
              ) : tasks.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                    No tasks found
                  </td>
                </tr>
              ) : (
                tasks.map((task) => (
                  <>
                    <tr
                      key={task.job_id}
                      className={`hover:bg-gray-50 ${expandedTask === task.job_id ? 'bg-gray-50' : ''}`}
                    >
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedTasks.has(task.job_id)}
                          onChange={() => toggleTaskSelection(task.job_id)}
                          className="rounded"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div
                          className="cursor-pointer hover:text-blue-600"
                          onClick={() => {
                            // Completed tasks go directly to review page
                            if (task.status === 'completed' && task.result_data) {
                              navigate(`/admin/tasks/${task.job_id}/review`);
                            } else {
                              setExpandedTask(expandedTask === task.job_id ? null : task.job_id);
                            }
                          }}
                        >
                          <div className="font-medium text-gray-900 truncate max-w-xs">
                            {task.task_name || task.job_id}
                          </div>
                          <div className="text-xs text-gray-500">
                            {task.pdf_count} PDF(s){task.total_size_bytes ? ` | ${formatFileSize(task.total_size_bytes)}` : ''}{task.total_pages ? ` | ${task.total_pages} pages` : ''}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${statusColors[task.status]}`}>
                          {task.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="w-24">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-gray-200 rounded-full h-2">
                              <div
                                className="bg-blue-600 h-2 rounded-full transition-all"
                                style={{ width: `${task.progress}%` }}
                              />
                            </div>
                            <span className="text-xs text-gray-600">{task.progress}%</span>
                          </div>
                          {task.current_stage && (
                            <div className="text-xs text-gray-500 truncate mt-1">
                              {task.current_stage}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm text-gray-900">{task.user_id}</div>
                        {task.user_email && (
                          <div className="text-xs text-gray-500">{task.user_email}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {formatDuration(task.started_at, task.completed_at)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          {task.status === 'processing' && (
                            <button
                              onClick={() => pauseTask(task.job_id)}
                              className="p-1 text-orange-600 hover:bg-orange-50 rounded"
                              title="Pause"
                            >
                              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                              </svg>
                            </button>
                          )}
                          {['processing', 'paused', 'pending', 'uploading'].includes(task.status) && (
                            <button
                              onClick={() => cancelTask(task.job_id)}
                              className="p-1 text-red-600 hover:bg-red-50 rounded"
                              title="Cancel"
                            >
                              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                              </svg>
                            </button>
                          )}
                          <button
                            onClick={() => deleteTask(task.job_id)}
                            className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                            title="Delete"
                          >
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                            </svg>
                          </button>
                          <button
                            onClick={() => fetchLogs(task.job_id)}
                            className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                            title="View Logs"
                          >
                            <FileText className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {/* Expanded Details */}
                    {expandedTask === task.job_id && (
                      <tr>
                        <td colSpan={7} className="px-4 py-4 bg-gray-50">
                          <div className="space-y-4">
                            {/* Basic Info */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                              <div>
                                <div className="text-gray-500">Job ID</div>
                                <div className="font-mono text-xs">{task.job_id}</div>
                              </div>
                              <div>
                                <div className="text-gray-500">User</div>
                                <div>{task.user_id}</div>
                                {task.user_email && <div className="text-xs text-gray-400">{task.user_email}</div>}
                              </div>
                              <div>
                                <div className="text-gray-500">File Size</div>
                                <div>{formatFileSize(task.total_size_bytes) || '-'}</div>
                              </div>
                              <div>
                                <div className="text-gray-500">Pages</div>
                                <div>{task.total_pages ?? '-'}</div>
                              </div>
                              <div>
                                <div className="text-gray-500">Created</div>
                                <div>{formatDate(task.created_at)}</div>
                              </div>
                              <div>
                                <div className="text-gray-500">Started</div>
                                <div>{formatDate(task.started_at)}</div>
                              </div>
                              <div>
                                <div className="text-gray-500">Completed</div>
                                <div>{formatDate(task.completed_at)}</div>
                              </div>
                              <div>
                                <div className="text-gray-500">Chunks</div>
                                <div>{task.processed_chunks} / {task.total_chunks ?? '-'}</div>
                              </div>
                              <div className="col-span-2">
                                <div className="text-gray-500">PDF Files</div>
                                <div className="text-xs truncate max-w-md">
                                  {task.pdf_names.join(', ')}
                                </div>
                              </div>
                            </div>

                            {/* Result Summary - Only for completed tasks */}
                            {task.status === 'completed' && task.result_data && (() => {
                              const summary = getResultSummary(task);
                              if (!summary) return null;
                              return (
                                <div className="border-t pt-4">
                                  <div className="text-sm font-medium text-gray-700 mb-3">Extraction Results</div>
                                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                                    <div className="flex items-center gap-2 bg-white rounded-lg p-3 border">
                                      <Home className="h-5 w-5 text-blue-500" />
                                      <div>
                                        <div className="text-lg font-bold">{summary.units}</div>
                                        <div className="text-xs text-gray-500">Unit Types</div>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2 bg-white rounded-lg p-3 border">
                                      <Image className="h-5 w-5 text-green-500" />
                                      <div>
                                        <div className="text-lg font-bold">{summary.projectImages}</div>
                                        <div className="text-xs text-gray-500">Project Images</div>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2 bg-white rounded-lg p-3 border">
                                      <Image className="h-5 w-5 text-purple-500" />
                                      <div>
                                        <div className="text-lg font-bold">{summary.floorPlanImages}</div>
                                        <div className="text-xs text-gray-500">Floor Plans</div>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2 bg-white rounded-lg p-3 border">
                                      <CreditCard className="h-5 w-5 text-orange-500" />
                                      <div>
                                        <div className="text-lg font-bold">{summary.paymentPlans}</div>
                                        <div className="text-xs text-gray-500">Payment Plans</div>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2 bg-white rounded-lg p-3 border">
                                      <Trees className="h-5 w-5 text-teal-500" />
                                      <div>
                                        <div className="text-lg font-bold">{summary.amenities}</div>
                                        <div className="text-xs text-gray-500">Amenities</div>
                                      </div>
                                    </div>
                                  </div>

                                  {/* Errors/Warnings */}
                                  {(summary.errors > 0 || summary.warnings > 0) && (
                                    <div className="flex gap-4 mt-3">
                                      {summary.errors > 0 && (
                                        <div className="flex items-center gap-1 text-red-600 text-sm">
                                          <XCircle className="h-4 w-4" />
                                          {summary.errors} error(s)
                                        </div>
                                      )}
                                      {summary.warnings > 0 && (
                                        <div className="flex items-center gap-1 text-orange-600 text-sm">
                                          <XCircle className="h-4 w-4" />
                                          {summary.warnings} warning(s)
                                        </div>
                                      )}
                                    </div>
                                  )}

                                  {/* Click hint */}
                                  <div className="mt-4 text-sm text-gray-500">
                                    Click task name to edit & review
                                  </div>
                                </div>
                              );
                            })()}

                            {/* Errors */}
                            {task.errors.length > 0 && (
                              <div className="border-t pt-4">
                                <div className="text-gray-500 text-sm">Errors</div>
                                <div className="text-red-600 text-xs mt-1">
                                  {task.errors.join('; ')}
                                </div>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))
              )}
            </tbody>
          </table>

          {/* Pagination */}
          {pagination.total > pagination.limit && (
            <div className="px-4 py-3 bg-gray-50 border-t flex items-center justify-between">
              <div className="text-sm text-gray-500">
                Showing {pagination.offset + 1} to {Math.min(pagination.offset + pagination.limit, pagination.total)} of {pagination.total}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setPagination(prev => ({ ...prev, offset: Math.max(0, prev.offset - prev.limit) }))}
                  disabled={pagination.offset === 0}
                  className="px-3 py-1 border rounded text-sm disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPagination(prev => ({ ...prev, offset: prev.offset + prev.limit }))}
                  disabled={!pagination.hasMore}
                  className="px-3 py-1 border rounded text-sm disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Log Viewer Modal */}
      {viewingLogs && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Processing Logs</h3>
                <p className="text-sm text-gray-500 font-mono">{viewingLogs}</p>
              </div>
              <button
                onClick={() => setViewingLogs(null)}
                className="p-2 hover:bg-gray-100 rounded-lg"
              >
                <X className="h-5 w-5 text-gray-500" />
              </button>
            </div>

            {/* Logs Content */}
            <div className="flex-1 overflow-auto p-4 bg-gray-50">
              {logsLoading ? (
                <div className="text-center py-8 text-gray-500">Loading logs...</div>
              ) : logs.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  No logs available for this task.
                  <br />
                  <span className="text-sm">Logs are recorded during processing.</span>
                </div>
              ) : (
                <div className="space-y-2 font-mono text-sm">
                  {logs.map((log, idx) => (
                    <div
                      key={idx}
                      className={`p-3 rounded-lg border ${logLevelColors[log.level] || 'bg-gray-50'}`}
                    >
                      <div className="flex items-start gap-3">
                        <span className="text-xs text-gray-400 whitespace-nowrap">
                          {new Date(log.timestamp).toLocaleString()}
                        </span>
                        <span className={`px-1.5 py-0.5 rounded text-xs font-semibold uppercase ${
                          log.level === 'error' ? 'bg-red-200 text-red-800' :
                          log.level === 'warn' ? 'bg-yellow-200 text-yellow-800' :
                          log.level === 'info' ? 'bg-blue-200 text-blue-800' :
                          'bg-gray-200 text-gray-700'
                        }`}>
                          {log.level}
                        </span>
                        <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-xs">
                          {log.stage}
                        </span>
                      </div>
                      <div className="mt-2 text-gray-800">{log.message}</div>
                      {log.data && (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-700">
                            View data
                          </summary>
                          <pre className="mt-2 p-2 bg-white rounded border text-xs overflow-x-auto">
                            {JSON.stringify(log.data, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t bg-white flex items-center justify-between">
              <span className="text-sm text-gray-500">
                {logs.length} log entries
              </span>
              <button
                onClick={() => setViewingLogs(null)}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
