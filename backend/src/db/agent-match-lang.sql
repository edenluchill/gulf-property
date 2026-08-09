-- 记住买家用的是哪种语言(owner 2026-08-09)
--
-- 起因:一个经纪收到派单通知后,自己给买家写了一封**无主题、一句话、默认中文**的
-- 邮件。买家如果是英语/俄语/阿语的,那封信基本等于没发。
--
-- 所以要:① 知道买家用什么语言 ② 按那个语言给经纪准备好一份可直接发的模板。
--
-- 语言规则(owner 定的):**默认英文,买家界面明确是中文才用中文**。
-- 这里存原始的 i18n 语言码(zh-CN / en / fr / ru / ar),怎么回落由代码判 ——
-- 存 'zh'/'en' 这种归一化过的值会把 fr/ru/ar 提前丢掉,而那是我们支持的语言。

ALTER TABLE agent_match_assignments
  ADD COLUMN IF NOT EXISTS buyer_lang TEXT;

COMMENT ON COLUMN agent_match_assignments.buyer_lang IS
  '买家提交需求时的界面语言码(zh-CN/en/fr/ru/ar)。给经纪生成联系模板用;空则按英文。';
