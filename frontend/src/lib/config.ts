/**
 * Frontend configuration
 * 统一管理所有配置，从环境变量读取
 */

// API Base URL
// 注意：虽然域名是 api.pinzos.com，但后端路由都定义在 /api/* 下
//      所以生产环境仍然需要 /api 路径
export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// API Endpoints
export const API_ENDPOINTS = {
  // Properties
  properties: `${API_BASE_URL}/api/properties`,
  propertiesBatch: `${API_BASE_URL}/api/properties/batch`,
  propertiesClusters: `${API_BASE_URL}/api/properties/clusters`,
  propertiesMap: `${API_BASE_URL}/api/properties/map`,
  propertiesMeta: `${API_BASE_URL}/api/properties/meta`,

  // Developer submission (old)
  developerSubmit: `${API_BASE_URL}/api/developer/submit-property`,

  // Residential Projects (new schema)
  residentialProjectsSubmit: `${API_BASE_URL}/api/residential-projects/submit`,
  residentialProjects: `${API_BASE_URL}/api/residential-projects`,
  residentialProject: (id: string) => `${API_BASE_URL}/api/residential-projects/${id}`,
  residentialProjectUpdate: (id: string) => `${API_BASE_URL}/api/residential-projects/${id}`,

  // LangGraph
  langgraphProgressStart: `${API_BASE_URL}/api/langgraph-progress/start`,
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
