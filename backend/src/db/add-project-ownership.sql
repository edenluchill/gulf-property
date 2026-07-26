-- 项目归属:谁提交的楼书,只有本人(和 owner/Shell)能改/删。
-- 2026-07-25。此前 residential_projects 无任何归属列 → 任何开发商能改任何人的项目。
--
-- 现存 51 行(迁移前上传的)submitted_by_email 一律 NULL:
--   • 无上传归属埋点,无法可靠回溯谁传的 → 安全默认 = 只有 owner/Shell 能编辑 NULL 归属行;
--   • 开发商碰不到 NULL 行(不是他的)。个别历史项目要认领,由 owner 手动 UPDATE 归属。
-- 服务端强制在 routes/residential-projects.ts(submit 记归属 / put·delete·list 校验)。
ALTER TABLE residential_projects ADD COLUMN IF NOT EXISTS submitted_by_email text;

-- 「我的项目」列表按归属过滤 + put/delete 校验都按 lower(email) 命中
CREATE INDEX IF NOT EXISTS idx_resproj_submitter
  ON residential_projects (lower(submitted_by_email));
