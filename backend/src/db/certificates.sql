-- ===========================================================================
-- 认证凭证登记(可验证证书)—— 2026-07-10
--
-- 证书上印二维码 + 「Verify at pinzos.com/verify」链接才可信(现代数字凭证做法)。
-- 打开证书弹窗时前端登记一行(幂等),公开 /verify/:credential_id 页据此展示
-- 「✓ 有效凭证 · 持有人 · 称号 · 颁发日期」。credential_id 由 姓名|档位 派生(与前端
-- roleBadge.certNumber 同算法)。
-- ===========================================================================

CREATE TABLE IF NOT EXISTS lt_certificates (
  credential_id text PRIMARY KEY,          -- PZ-YYYY-NNNNNN
  agent_id      uuid NOT NULL,
  holder_name   text NOT NULL,
  plan_id       text NOT NULL,
  cert_title    text NOT NULL,             -- 逐档专业头衔(Senior Certified Advisor 等)
  issued_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cert_agent ON lt_certificates (agent_id);
