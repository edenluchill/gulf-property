-- 买家留的联系方式是**哪一种**(owner 2026-08-11)
--
-- 起因:「客户输入联系方式应该选然后要验证,不能随便现在什么垃圾都可以,
-- 比如 phone、email 和 whatsapp」。
--
-- 之前 buyer_contact 是一个自由文本框:写「asdf」也照收,经纪拿到一条打不通的
-- lead 比没有 lead 更伤 —— 他会认定这个来源是垃圾,下次连邮件都不点开。
--
-- 现在买家先选类型再填,前后端用**同一套规则**校验
-- (frontend/src/lib/contactValidation.ts ⇄ backend/src/lib/contactValidation.ts):
--   whatsapp / phone → 归一化成 E.164(+区号,去掉空格横杠),8–15 位,
--                      且不同数字 ≥3 种(挡掉 +11111111 这种乱敲)
--   email            → 常规邮箱格式,存小写
--
-- 类型单独存一列而**不是**拼进 buyer_contact 字符串:经纪台那边有
-- `buyer_contact.includes('@') → mailto:` 这样的判断,一旦在值里加前缀,
-- 生成出来的就是 `mailto:邮箱 a@b.com` 这种打不开的链接。
--
-- 老数据这一列是 NULL —— 展示层要按「未知类型」兜底,别假设非空。

ALTER TABLE agent_match_assignments
  ADD COLUMN IF NOT EXISTS buyer_contact_type TEXT;

COMMENT ON COLUMN agent_match_assignments.buyer_contact_type IS
  '买家自己选的联系方式类型:whatsapp / phone / email。NULL = 这个字段上线前的老记录。';
