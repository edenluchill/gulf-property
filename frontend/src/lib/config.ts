/**
 * Frontend configuration
 * 统一管理所有配置，从环境变量读取
 */

// API Base URL
// 注意：虽然域名是 api.pinzos.com，但后端路由都定义在 /api/* 下
//      所以生产环境仍然需要 /api 路径
export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// Upload API URL - bypasses Cloudflare for large file uploads (>100MB)
// Set VITE_UPLOAD_API_URL to a direct server URL (not proxied by Cloudflare)
export const UPLOAD_API_URL = import.meta.env.VITE_UPLOAD_API_URL || API_BASE_URL;

// Direct-to-R2 chunked upload — browser PUTs parts straight to the nearest R2
// edge with per-part retry, fixing dropped large uploads from far regions (Dubai).
// Defaults ON in production; set VITE_DIRECT_UPLOAD=false to force the legacy
// single-request path (e.g. local dev without a worker running).
export const USE_DIRECT_UPLOAD =
  import.meta.env.VITE_DIRECT_UPLOAD != null
    ? import.meta.env.VITE_DIRECT_UPLOAD === 'true'
    : import.meta.env.PROD;

// API Endpoints
export const API_ENDPOINTS = {
  // Residential Projects
  residentialProjectsSubmit: `${API_BASE_URL}/api/residential-projects/submit`,
  residentialProjects: `${API_BASE_URL}/api/residential-projects`,
  residentialProject: (id: string) => `${API_BASE_URL}/api/residential-projects/${id}`,
  residentialProjectUpdate: (id: string) => `${API_BASE_URL}/api/residential-projects/${id}`,

  // LangGraph - Use UPLOAD_API_URL for file uploads to bypass Cloudflare 100MB limit
  langgraphProgressStart: `${UPLOAD_API_URL}/api/langgraph-progress/start`,
  langgraphProgressStream: (jobId: string) => `${API_BASE_URL}/api/langgraph-progress/stream/${jobId}`,
  langgraphProgressStatus: (jobId: string) => `${API_BASE_URL}/api/langgraph-progress/status/${jobId}`,

  // Tasks (PDF processing task management)
  tasksStart: `${API_BASE_URL}/api/tasks/start`,
  tasks: `${API_BASE_URL}/api/tasks`,
  task: (jobId: string) => `${API_BASE_URL}/api/tasks/${jobId}`,
  taskStream: (jobId: string) => `${API_BASE_URL}/api/tasks/${jobId}/stream`,
  taskPause: (jobId: string) => `${API_BASE_URL}/api/tasks/${jobId}/pause`,
  taskResume: (jobId: string) => `${API_BASE_URL}/api/tasks/${jobId}/resume`,
  taskCancel: (jobId: string) => `${API_BASE_URL}/api/tasks/${jobId}/cancel`,

  // Admin Tasks
  adminTasks: `${API_BASE_URL}/api/admin/tasks`,
  adminTaskStats: `${API_BASE_URL}/api/admin/tasks/stats`,
  adminTask: (jobId: string) => `${API_BASE_URL}/api/admin/tasks/${jobId}`,
  adminTaskLogs: (jobId: string) => `${API_BASE_URL}/api/admin/tasks/${jobId}/logs`,
  adminTaskPause: (jobId: string) => `${API_BASE_URL}/api/admin/tasks/${jobId}/pause`,
  adminTaskCancel: (jobId: string) => `${API_BASE_URL}/api/admin/tasks/${jobId}/cancel`,
  adminTasksBatchCancel: `${API_BASE_URL}/api/admin/tasks/batch/cancel`,
  adminTasksBatchDelete: `${API_BASE_URL}/api/admin/tasks/batch`,

  // Health check
  health: `${API_BASE_URL}/health`,
} as const;

// Environment info
export const IS_PRODUCTION = import.meta.env.PROD;
export const IS_DEVELOPMENT = import.meta.env.DEV;

// Feature flags (可以从环境变量读取)
export const FEATURES = {
  enableAnalytics: IS_PRODUCTION,
  enableDebug: IS_DEVELOPMENT,
} as const;

export default {
  API_BASE_URL,
  API_ENDPOINTS,
  IS_PRODUCTION,
  IS_DEVELOPMENT,
  FEATURES,
};
