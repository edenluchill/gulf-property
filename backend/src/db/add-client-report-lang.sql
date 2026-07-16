-- ===========================================================================
-- lt_client_reports.lang —— 报告的**文档语言**。
--
-- 为什么要存在列里,而不是跟浏览者 UI 语言走:
--   报告正文是 AI 生成后存进 report jsonb 的 —— 语言在**生成那一刻**就定死了。
--   只让前端 chrome 跟 UI 语言切,会得到「阿拉伯语标签 + 中文正文」,比全中文更糟。
--   所以语言必须在生成前决定、随行存下,前端用 getFixedT(lang) 锁定。
--   这与报价单(lt_offers.lang / share.lang)是同一个范式。
--
-- 默认 'zh':存量报告的正文**确实**是中文(prompt 是中文写的、没有语言指令),
-- 标 zh 是对历史数据的如实描述,不是猜测。
-- ===========================================================================
ALTER TABLE lt_client_reports
  ADD COLUMN IF NOT EXISTS lang text NOT NULL DEFAULT 'zh';

-- 只收 app 支持的 5 语言,挡住脏值(经纪端下拉之外的东西一律拒绝)。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lt_client_reports_lang_chk'
  ) THEN
    ALTER TABLE lt_client_reports
      ADD CONSTRAINT lt_client_reports_lang_chk
      CHECK (lang IN ('en', 'zh', 'ar', 'ru', 'fr'));
  END IF;
END $$;

COMMENT ON COLUMN lt_client_reports.lang IS
  '报告文档语言(经纪生成时选定)。AI 按此语言写正文;/cr/:code 用 getFixedT 锁定,不跟浏览者 UI 切。';
