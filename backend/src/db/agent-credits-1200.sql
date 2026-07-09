-- Pro(专业版 = agent 档)降价 $49 后,月积分 2500 → 1200(性价比仍高:
-- 12 次 Luna 导览 / 60 份意向报告 / 20 场实时带看)。credits_month 在 limits jsonb。
UPDATE lt_subscription_plans
   SET limits = jsonb_set(limits, '{credits_month}', '1200')
 WHERE id = 'agent';

SELECT id, limits->>'credits_month' AS credits_month, price_usd_month FROM lt_subscription_plans ORDER BY COALESCE(price_usd_month,0);
