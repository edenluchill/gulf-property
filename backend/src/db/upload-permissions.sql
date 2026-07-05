-- ===========================================================================
-- 楼书上传权限(uploader role):单独授权某个 email 使用「上传楼书 / 任务审核 /
-- 项目管理」,但不给 telemetry/分析后台(那些仍是 ADMIN_EMAILS/owner)。
-- 管理入口:dashboard 经纪审批 tab;端点在 routes/agents.ts。
-- ===========================================================================
CREATE TABLE IF NOT EXISTS upload_permissions (
  email      text PRIMARY KEY,
  granted_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
