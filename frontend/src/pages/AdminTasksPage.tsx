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
import { API_ENDPOINTS, API_BASE_URL } from '../lib/config';
import { TaskStatus } from '../stores/taskStore';
import { CheckCircle, XCircle, Eye, Send, Home, Image, CreditCard, Trees, Edit } from 'lucide-react';

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
  const [reviewingTask, setReviewingTask] = useState<AdminTask | null>(null);
  const [submitting, setSubmitting] = useState(false);

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

  // Submit task result as a new project
  const submitTask = async (task: AdminTask) => {
    if (!task.result_data?.buildingData) {
      setError('No result data to submit');
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/tasks/${task.job_id}/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': 'admin',
          'x-admin': 'true',
        },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to submit task');
      }

      const data = await response.json();
      alert(`Project submitted successfully! ID: ${data.projectId}`);
      setReviewingTask(null);
      fetchTasks();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit task');
    } finally {
      setSubmitting(false);
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
                          className="cursor-pointer"
                          onClick={() => setExpandedTask(expandedTask === task.job_id ? null : task.job_id)}
                        >
                          <div className="font-medium text-gray-900 truncate max-w-xs">
                            {task.task_name || task.job_id}
                          </div>
                          <div className="text-xs text-gray-500">
                            {task.pdf_count} PDF(s) | {task.total_pages ?? '?'} pages
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
                                <div>{task.processed_chunks} / {task.total_chunks ?? '?'}</div>
                              </div>
                              <div>
                                <div className="text-gray-500">PDF Files</div>
                                <div className="text-xs truncate max-w-xs">
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

                                  {/* Action Buttons */}
                                  <div className="flex gap-2 mt-4">
                                    <button
                                      onClick={() => setReviewingTask(task)}
                                      className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 text-sm"
                                    >
                                      <Eye className="h-4 w-4" />
                                      Quick Preview
                                    </button>
                                    <button
                                      onClick={() => navigate(`/admin/tasks/${task.job_id}/review`)}
                                      className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
                                    >
                                      <Edit className="h-4 w-4" />
                                      Edit & Review
                                    </button>
                                    <button
                                      onClick={() => submitTask(task)}
                                      disabled={submitting}
                                      className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm disabled:opacity-50"
                                    >
                                      <Send className="h-4 w-4" />
                                      {submitting ? 'Submitting...' : 'Submit as Project'}
                                    </button>
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

        {/* Review Modal */}
        {reviewingTask && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
              {/* Modal Header */}
              <div className="px-6 py-4 border-b flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold">Review Task Results</h2>
                  <p className="text-sm text-gray-500">{reviewingTask.task_name || reviewingTask.job_id}</p>
                </div>
                <button
                  onClick={() => setReviewingTask(null)}
                  className="p-2 hover:bg-gray-100 rounded-lg"
                >
                  <XCircle className="h-5 w-5" />
                </button>
              </div>

              {/* Modal Body */}
              <div className="flex-1 overflow-y-auto p-6">
                {reviewingTask.result_data?.buildingData && (
                  <div className="space-y-6">
                    {/* Project Info */}
                    {reviewingTask.result_data.buildingData.name && (
                      <div className="bg-gray-50 rounded-lg p-4">
                        <h3 className="font-medium mb-2">Project Information</h3>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <span className="text-gray-500">Name:</span> {reviewingTask.result_data.buildingData.name}
                          </div>
                          <div>
                            <span className="text-gray-500">Developer:</span> {reviewingTask.result_data.buildingData.developer || '-'}
                          </div>
                          <div className="col-span-2">
                            <span className="text-gray-500">Location:</span> {reviewingTask.result_data.buildingData.area || '-'}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Units */}
                    {reviewingTask.result_data.buildingData.units?.length > 0 && (
                      <div>
                        <h3 className="font-medium mb-2">Unit Types ({reviewingTask.result_data.buildingData.units.length})</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {reviewingTask.result_data.buildingData.units.map((unit: any, idx: number) => (
                            <div key={idx} className="border rounded-lg p-3 bg-white">
                              <div className="font-medium">{unit.typeName || unit.name || `Unit ${idx + 1}`}</div>
                              <div className="text-sm text-gray-500 mt-1">
                                {unit.bedrooms && <span>{unit.bedrooms} BR</span>}
                                {unit.size && <span> | {unit.size} sqft</span>}
                                {unit.price && <span> | AED {unit.price.toLocaleString()}</span>}
                              </div>
                              {unit.images?.length > 0 && (
                                <div className="mt-2 flex gap-1 overflow-x-auto">
                                  {unit.images.slice(0, 3).map((img: string, imgIdx: number) => (
                                    <img
                                      key={imgIdx}
                                      src={img}
                                      alt={`Unit ${idx + 1} - ${imgIdx + 1}`}
                                      className="h-16 w-24 object-cover rounded"
                                    />
                                  ))}
                                  {unit.images.length > 3 && (
                                    <div className="h-16 w-24 bg-gray-100 rounded flex items-center justify-center text-sm text-gray-500">
                                      +{unit.images.length - 3}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Project Images */}
                    {reviewingTask.result_data.buildingData.images?.projectImages?.length > 0 && (
                      <div>
                        <h3 className="font-medium mb-2">Project Images ({reviewingTask.result_data.buildingData.images.projectImages.length})</h3>
                        <div className="flex gap-2 overflow-x-auto pb-2">
                          {reviewingTask.result_data.buildingData.images.projectImages.slice(0, 8).map((img: string, idx: number) => (
                            <img
                              key={idx}
                              src={img}
                              alt={`Project ${idx + 1}`}
                              className="h-24 w-36 object-cover rounded-lg flex-shrink-0"
                            />
                          ))}
                          {reviewingTask.result_data.buildingData.images.projectImages.length > 8 && (
                            <div className="h-24 w-36 bg-gray-100 rounded-lg flex items-center justify-center text-sm text-gray-500 flex-shrink-0">
                              +{reviewingTask.result_data.buildingData.images.projectImages.length - 8} more
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Amenities */}
                    {reviewingTask.result_data.buildingData.amenities?.length > 0 && (
                      <div>
                        <h3 className="font-medium mb-2">Amenities ({reviewingTask.result_data.buildingData.amenities.length})</h3>
                        <div className="flex flex-wrap gap-2">
                          {reviewingTask.result_data.buildingData.amenities.map((amenity: string, idx: number) => (
                            <span key={idx} className="px-2 py-1 bg-teal-100 text-teal-800 rounded text-sm">
                              {amenity}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Payment Plans */}
                    {reviewingTask.result_data.buildingData.paymentPlans?.length > 0 && (
                      <div>
                        <h3 className="font-medium mb-2">Payment Plans ({reviewingTask.result_data.buildingData.paymentPlans.length})</h3>
                        <div className="space-y-2">
                          {reviewingTask.result_data.buildingData.paymentPlans.map((plan: any, idx: number) => (
                            <div key={idx} className="border rounded-lg p-3 text-sm">
                              <div className="font-medium">{plan.name || `Plan ${idx + 1}`}</div>
                              {plan.milestones && (
                                <div className="mt-1 text-gray-600">
                                  {plan.milestones.map((m: any, mIdx: number) => (
                                    <span key={mIdx}>
                                      {m.percentage}% {m.description}
                                      {mIdx < plan.milestones.length - 1 && ' → '}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Errors/Warnings */}
                    {(reviewingTask.result_data.errors?.length > 0 || reviewingTask.result_data.warnings?.length > 0) && (
                      <div>
                        <h3 className="font-medium mb-2">Issues</h3>
                        {reviewingTask.result_data.errors?.length > 0 && (
                          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-2">
                            <div className="text-red-800 font-medium text-sm mb-1">Errors</div>
                            <ul className="text-red-700 text-sm list-disc list-inside">
                              {reviewingTask.result_data.errors.map((err: string, idx: number) => (
                                <li key={idx}>{err}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {reviewingTask.result_data.warnings?.length > 0 && (
                          <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
                            <div className="text-orange-800 font-medium text-sm mb-1">Warnings</div>
                            <ul className="text-orange-700 text-sm list-disc list-inside">
                              {reviewingTask.result_data.warnings.map((warn: string, idx: number) => (
                                <li key={idx}>{warn}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div className="px-6 py-4 border-t flex items-center justify-end gap-3">
                <button
                  onClick={() => setReviewingTask(null)}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg"
                >
                  Close
                </button>
                <button
                  onClick={() => submitTask(reviewingTask)}
                  disabled={submitting}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                >
                  <CheckCircle className="h-4 w-4" />
                  {submitting ? 'Submitting...' : 'Approve & Submit'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
