-- Luna Tour —— 楼盘公开导览里贴的**真实素材**（海景/环境视频、实拍照片）。
--
-- owner:「导览要能贴上附近视频和环境视频比如海景视频，然后项目照片或者自己上传视频。」
--
-- 为什么单独一张表(而不是复用 residential_projects.project_images):
--   • project_images 是**楼书里抠出来的渲染图**,按页码排序,里面混着户型图、封面、
--     logo 页 —— 直接往导览上贴会贴出一张 logo。导览要的是**挑过的**素材。
--   • 视频压根没有存的地方。
--   • 导览素材有自己的语义:贴在哪一拍(落地/周边/户型)、配什么说明文字。
--
-- 🔴 **模型永远看不到这里的 URL。** 素材由代码按 `slot` 贴到对应的拍上
--    (见 tour-generator 的 attachMedia)。让模型自己填 url 它就会编一个出来 ——
--    而编出来的 URL 在客户面前就是一个加载失败的黑框。
CREATE TABLE IF NOT EXISTS lt_project_tour_media (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES residential_projects(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('video', 'image')),
  url         text NOT NULL,
  caption     text,
  -- 贴在哪一拍:arrival(落地/环境) | nearby(周边) | homes(户型) | outro
  -- 一个 slot 里有多条就按 sort_order 取第一条 —— 一拍上叠两个视频是噪音。
  slot        text NOT NULL DEFAULT 'arrival'
                CHECK (slot IN ('arrival', 'nearby', 'homes', 'outro')),
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lt_project_tour_media_project
  ON lt_project_tour_media (project_id, slot, sort_order);
