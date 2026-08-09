-- 买家找经纪 —— 匹配记录 + 接单开关(owner 2026-08-09)
--
-- 买家在项目详情页/地图上点「找经纪帮我」→ 从**付费或试用中、且留了联系方式**的经纪里
-- 派一个给他。派单要均衡:已经被派过的排后面。
--
-- 🔴 两条设计约束,改这块之前先读:
--
-- 1. **联系方式不随匹配结果一起返回。** 匹配接口只给"这个人是谁"(名字/头像/品牌),
--    电话和 WhatsApp 要买家再点一次「联系」才发(reveal)。两个理由:
--      · 公开页面直接吐手机号 = 送给爬虫,而这些号是经纪本人的私人号;
--      · reveal 才是真正的转化事件 —— 光"看到一张卡"说明不了买家想不想联系。
--    所以 revealed_at 是这张表里最有价值的一列,别把它和 created_at 混着用。
--
-- 2. **一个访客对同一个项目只派一次,之后一直是同一个人**(sticky)。
--    每次刷新换一个经纪的话,买家会觉得这平台不靠谱,而且经纪跟进时对不上人。
--    唯一索引 (visitor_id, project_id) 就是干这个的 —— 地图入口没有 project_id,
--    用 '00000000-...' 全零 UUID 占位,让同一个访客在地图上也只派一次。

CREATE TABLE IF NOT EXISTS agent_match_assignments (
  id           BIGSERIAL PRIMARY KEY,
  visitor_id   TEXT        NOT NULL,
  agent_id     UUID        NOT NULL REFERENCES lt_agents(id) ON DELETE CASCADE,
  -- 全零 UUID = 不是从某个具体项目来的(地图/区域入口)
  project_id   UUID        NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  source       TEXT        NOT NULL DEFAULT 'project',   -- 'project' | 'map'
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 买家点了「联系」才写。**真正的转化在这一列**,不在 created_at。
  revealed_at  TIMESTAMPTZ,
  -- 买家自愿留的(可为空 —— 不强制留联系方式,强制会把大部分人挡在门外)
  buyer_contact TEXT,
  buyer_note    TEXT,
  -- 经纪自己标记「已跟进」,给经纪台和 admin 看闭环
  agent_ack_at  TIMESTAMPTZ
);

-- sticky:同一访客 + 同一项目只派一次
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_match_visitor_project
  ON agent_match_assignments (visitor_id, project_id);

-- 排班查询:算每个经纪最近 30 天被派了几次
CREATE INDEX IF NOT EXISTS idx_agent_match_agent_created
  ON agent_match_assignments (agent_id, created_at DESC);

-- 经纪台按时间倒序拉自己的
CREATE INDEX IF NOT EXISTS idx_agent_match_created
  ON agent_match_assignments (created_at DESC);

-- ── 接单开关 ────────────────────────────────────────────────────────────────
-- 默认是**开**(NULL = 在池子里)。经纪要的就是客户,默认关掉等于这个功能永远不转;
-- 但休假/手上满了要能自己按停,不然只能来找我们改库。
ALTER TABLE lt_agents
  ADD COLUMN IF NOT EXISTS match_paused_at TIMESTAMPTZ;

COMMENT ON TABLE agent_match_assignments IS
  '买家↔经纪派单记录。revealed_at 才是转化(买家真的要了联系方式);created_at 只是看到了卡片。';
COMMENT ON COLUMN lt_agents.match_paused_at IS
  '非 NULL = 经纪暂停接单,不进派单池。默认 NULL(在池子里)。';
