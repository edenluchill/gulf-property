-- 功能建议按受众分流：买家只看买家侧的建议，经纪看全部。
--
-- 为什么默认从提议人的角色推：经纪提的建议九成在讲经纪侧的东西（带看、报价单、
-- 楼书），让买家去读只会觉得这版块跟自己无关。推错的时候 owner 能在后台 PATCH
-- 改回来 —— 所以这里存的是**可覆盖的默认值**，不是从 role 实时算出来的派生列。
-- （做成派生列的话，后台就永远改不动它。）
ALTER TABLE feature_requests
  ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'all';

-- 存量回填：经纪/经纪公司/开发商提的 → 经纪侧；买家和没选角色的 → 所有人可见。
UPDATE feature_requests
   SET audience = 'agent'
 WHERE audience = 'all'
   AND role IN ('agent', 'agency', 'developer');

CREATE INDEX IF NOT EXISTS idx_feature_requests_audience
  ON feature_requests (audience);
