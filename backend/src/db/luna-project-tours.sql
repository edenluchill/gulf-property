-- Luna Tour — 每个楼盘一条**公开**导览（不是经纪给某个客户生成的那种）。
--
-- 为什么要这张表:
--   经纪版 tour 两个月一共 15 场、外部客户播放 0 次;而同期有 211 个外部访客看了
--   442 次项目详情页。tour 这个资产是好的,只是**摆在没人经过的地方**。
--   这张表把「楼盘 → 一条常驻导览」钉在一起,让买家在他本来就在的那一页点开。
--
-- 设计取舍:
--   • **复用 lt_demo_sessions**(以及它的 script / audio / 公开 watch 端点),
--     不另起一套播放链路 —— 那会立刻分叉成两套引擎、两套 bug。
--     这张表只是「楼盘 ↔ 会话」的注册表 + 目录页需要的策展字段。
--   • project_id 是主键:一个楼盘同时只有一条现行导览。重生成 = 换 session_id。
--   • `status` 由我们控:generating / ready / hidden。**目录和入口只认 ready** ——
--     半成品绝不能出现在公开目录里。
CREATE TABLE IF NOT EXISTS lt_project_tours (
  project_id   uuid PRIMARY KEY REFERENCES residential_projects(id) ON DELETE CASCADE,
  session_id   uuid NOT NULL REFERENCES lt_demo_sessions(id) ON DELETE CASCADE,
  share_code   text NOT NULL,
  status       text NOT NULL DEFAULT 'ready',
  -- 目录排序用:上线时间(不是 created_at —— 重生成不该把它顶到最前面)
  published_at timestamptz,
  -- 生成时用的剧本时长,目录卡上显示「约 X 秒」,不用去 join script 表
  duration_ms  integer,
  -- 人工策展:置顶权重(大的在前)。默认 0,不参与就是按 published_at 排。
  featured     integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- 目录页按 status 过滤 + 按 featured/published_at 排序
CREATE INDEX IF NOT EXISTS idx_lt_project_tours_ready
  ON lt_project_tours (status, featured DESC, published_at DESC NULLS LAST);
-- share_code → project 的反查(遥测把播放数归回楼盘时用)
CREATE INDEX IF NOT EXISTS idx_lt_project_tours_share_code ON lt_project_tours (share_code);
