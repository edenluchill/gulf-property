-- 年付价改为显式列(此前是前端/脚本 month×10 = $250 隐式计算)。
-- rookie 年付定为 $249(中国人忌 250);其余保持 month×10(送 2 个月)。
-- setup-stripe-prices.ts 会据此列建/对齐 Stripe 年付 price 并回填 stripe_price_id_year。
ALTER TABLE lt_subscription_plans ADD COLUMN IF NOT EXISTS price_usd_year numeric;

UPDATE lt_subscription_plans
   SET price_usd_year = COALESCE(price_usd_month, 0) * 10
 WHERE price_usd_year IS NULL;

UPDATE lt_subscription_plans SET price_usd_year = 249 WHERE id = 'rookie';

SELECT id, price_usd_month, price_usd_year FROM lt_subscription_plans ORDER BY COALESCE(price_usd_month,0);
