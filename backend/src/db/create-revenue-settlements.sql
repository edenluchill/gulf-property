-- 分成对账:某月已线下转账结算的快照(真相源=Stripe,这里只锁结算时点数字)。
-- FINDHOMEGO 25% / 运营方 75%(合伙协议 2026-06-30)。
CREATE TABLE IF NOT EXISTS revenue_settlements (
  id bigserial PRIMARY KEY,
  month text NOT NULL,                          -- 'YYYY-MM'(迪拜时区)
  currency text NOT NULL DEFAULT 'usd',
  net_cents bigint NOT NULL,                    -- 结算时点的实收净额(扣退款+手续费)
  share_findhomego_cents bigint NOT NULL,
  share_operator_cents bigint NOT NULL,
  share_rate numeric NOT NULL DEFAULT 0.25,
  settled_at timestamptz NOT NULL DEFAULT now(),
  settled_by text,                              -- 操作人邮箱
  note text,                                    -- 转账参考号等备注
  UNIQUE (month, currency)
);
