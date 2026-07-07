-- Sales Offer 升级(2026-07-06):付款计划分享 → 正式报价单
--   original_price: 户型原价(开发商价)。与 price(经纪实际报价)差 = 折扣,
--                    分享页据此渲染「原价划线 + 优惠 X%」行(样本:IMAN/MERAAS Sales Offer)。
--   unit_snapshot:  生成时选中户型的快照 jsonb(name/bedrooms/area/balconyArea/
--                    view/floorPlanImage...)。快照而非 join:户型价格与图随时会改,
--                    报价单发出后内容必须固定。
ALTER TABLE lt_payment_shares
  ADD COLUMN IF NOT EXISTS original_price numeric,
  ADD COLUMN IF NOT EXISTS unit_snapshot jsonb;
