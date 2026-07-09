-- Pro(专业版 = agent 档)降价:$99/月 → $49/月(≈199 AED,合伙人当地报价口径;
-- 取 9 结尾"看点价",略低于 199 AED 客户只觉更便宜)。年付相应 $990 → $490(送 2 个月)。
-- setup-stripe-prices.ts 会据此新建 Stripe 月/年 price 并回填(旧价 archive,不影响老订阅)。
UPDATE lt_subscription_plans SET price_usd_month = 49, price_usd_year = 490 WHERE id = 'agent';

SELECT id, price_usd_month, price_usd_year FROM lt_subscription_plans ORDER BY COALESCE(price_usd_month,0);
