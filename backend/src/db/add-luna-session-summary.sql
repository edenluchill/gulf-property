-- ===========================================================================
-- Luna 会话 AI 中文摘要列(admin 分析可读性 Phase 1)
--
-- transcript 里的人类语音转录质量差(Gemini Live inputAudioTranscription 中英
-- 混识别),几乎不可读。摘要靠 services/lunaSummary.ts 结合工具调用 + Luna 回复
-- 推断出「客户意图 / Luna 做了什么 / 有没有帮上」,让会话「可分析」。
--
--   summary     — 2–4 句中文摘要(为空 = 尚未生成)
--   summary_at  — 生成时间(用于判断是否需要重算)
--
-- 生成时机:写入(events.ts fire-and-forget)、detail 首次打开(懒生成)、
-- owner 手动回填(POST /admin/analytics/sessions/backfill-summaries)。
-- ===========================================================================

ALTER TABLE luna_sessions
  ADD COLUMN IF NOT EXISTS summary     TEXT,
  ADD COLUMN IF NOT EXISTS summary_at  TIMESTAMPTZ;
