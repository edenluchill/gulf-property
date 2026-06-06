-- ============================================================
-- Luna Tour — E2 编辑/改稿 数据层(评论 + 脚本版本)
-- 运行:cd backend && npx ts-node scripts/db-runner.ts src/db/luna-tour-edit.sql
-- 拆除:已加入 luna-tour-teardown.sql
-- ============================================================

-- 预览时的评论:锚定到某个 beat(可选 at_ms),供 AI 改稿引用。
CREATE TABLE IF NOT EXISTS lt_edit_comments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid NOT NULL REFERENCES lt_demo_sessions(id) ON DELETE CASCADE,
  beat_id     text NOT NULL,
  at_ms       integer,
  body        text NOT NULL,
  status      text NOT NULL DEFAULT 'open',   -- open | applied | dismissed
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lt_edit_comments_session ON lt_edit_comments(session_id, status);

-- 脚本版本快照:每次 AI 改稿/手动保存前存一份,供撤销回滚。
CREATE TABLE IF NOT EXISTS lt_tour_script_versions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  script_id   uuid NOT NULL REFERENCES lt_tour_scripts(id) ON DELETE CASCADE,
  session_id  uuid NOT NULL REFERENCES lt_demo_sessions(id) ON DELETE CASCADE,
  script      jsonb NOT NULL,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lt_tour_script_versions_session ON lt_tour_script_versions(session_id, created_at DESC);
