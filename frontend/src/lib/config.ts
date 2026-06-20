/**
 * Frontend configuration
 * 统一管理所有配置，从环境变量读取
 */

// API Base URL
// 注意：虽然域名是 api.pinzos.com，但后端路由都定义在 /api/* 下
//      所以生产环境仍然需要 /api 路径
// `import.meta.env` is injected by Vite at build time; guard it so the module
// can also be imported under plain node/tsx (unit tests) where it's undefined.
const ENV = (import.meta as { env?: Record<string, string | boolean | undefined> }).env ?? {};

export const API_BASE_URL = (ENV.VITE_API_URL as string) || 'http://localhost:3000';

// Upload API URL - bypasses Cloudflare for large file uploads (>100MB)
// Set VITE_UPLOAD_API_URL to a direct server URL (not proxied by Cloudflare)
export const UPLOAD_API_URL = (ENV.VITE_UPLOAD_API_URL as string) || API_BASE_URL;

// Direct-to-R2 chunked upload — browser PUTs parts straight to the nearest R2
// edge with per-part retry, fixing dropped large uploads from far regions (Dubai).
// Defaults ON in production; set VITE_DIRECT_UPLOAD=false to force the legacy
// single-request path (e.g. local dev without a worker running).
export const USE_DIRECT_UPLOAD =
  ENV.VITE_DIRECT_UPLOAD != null
    ? ENV.VITE_DIRECT_UPLOAD === 'true'
    : !!ENV.PROD;

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

// Analytics dashboard owner allow-list (frontend gate is UX only — the server
// enforces the same list on /api/admin/analytics/*). Override with
// VITE_OWNER_EMAILS (comma-separated) to match the backend OWNER_EMAILS.
export const OWNER_EMAILS = ((ENV.VITE_OWNER_EMAILS as string) || 'lzp6529@gmail.com')
  .split(',')
  .map((s: string) => s.trim().toLowerCase())
  .filter(Boolean);

export function isOwnerEmail(email?: string | null): boolean {
  return !!email && OWNER_EMAILS.includes(email.toLowerCase());
}

// Environment info
export const IS_PRODUCTION = !!ENV.PROD;
export const IS_DEVELOPMENT = !!ENV.DEV;

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
