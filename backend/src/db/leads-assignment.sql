-- ===========================================================================
-- Lead 认领(共享线索池)—— 2026-07-10
--
-- 决策(用户定):现阶段单一经纪公司运营 + lead 量极小 → 不做自动分发/轮询/独占。
-- 做「共享线索池 + 认领」:所有付费经纪看到未认领的线索池,点「认领」归自己,
-- 再「转为客户」进 CRM(lt_clients)。以后要按区域/轮询/优先分发,再在此基础加规则。
-- ===========================================================================

ALTER TABLE leads ADD COLUMN IF NOT EXISTS assigned_agent_id   uuid;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS assigned_at         timestamptz;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS converted_client_id uuid;

CREATE INDEX IF NOT EXISTS idx_leads_assigned ON leads (assigned_agent_id);
