-- 质量样本(2026-07-13)——「聚合」和「能优化」的分界线。
--
-- telemetry 的 counter/histogram 能告诉你「tour 生成了 50 次、p95 8 秒」,
-- 但**无法回答「哪一次生成得烂、烂在哪」**。要优化质量,必须能回溯到原件。
--
-- ref_id 就是那把钥匙:share_code(tour)/ job_id(楼书)/ session_id(对话)
-- → 拿着它可以直接去看原剧本、原抽取结果、原对话记录。

CREATE TABLE IF NOT EXISTS quality_samples (
  id         bigserial PRIMARY KEY,
  feature    text        NOT NULL,          -- luna_tour | pdf_extract | luna_session
  ref_id     text        NOT NULL,          -- **可回溯到原件**
  score      int         NOT NULL,          -- 0-100(按严重度加权)
  passed     int         NOT NULL DEFAULT 0,
  failed     int         NOT NULL DEFAULT 0,
  issues     jsonb       NOT NULL DEFAULT '[]',  -- [{rule, severity, detail}]
  meta       jsonb       NOT NULL DEFAULT '{}',  -- 上下文(项目数/页数/时长…)
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 主查询:某个 feature 最近的 / 最差的样本
CREATE INDEX IF NOT EXISTS idx_quality_feature_time  ON quality_samples (feature, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quality_feature_score ON quality_samples (feature, score);
-- 回溯:拿 ref_id 找它的历次质检
CREATE INDEX IF NOT EXISTS idx_quality_ref           ON quality_samples (ref_id);
