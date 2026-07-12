/**
 * /agent/plans 选完角色后的落地页验证 (2026-07-11)。
 *   canTrial   没领过试用 → 顶部应是「先免费用 7 天」主卡,套餐卡退到「试用结束后再选」
 *   usedTrial  已领过     → 没有主卡,套餐卡 CTA = 立即订阅
 * 用法: node scripts/_verify-plans-trial.mjs  (需 5174 dev server)
 */
import { chromium } from 'playwright'

const BASE = process.env.SHOT_URL || 'http://localhost:5174'
const now = Math.floor(Date.now() / 1000)

const mockSession = {
  access_token: 'mock', refresh_token: 'mock', token_type: 'bearer',
  expires_in: 3600, expires_at: now + 3600,
  user: {
    id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated',
    email: 'eden@example.com', email_confirmed_at: new Date().toISOString(),
    app_metadata: { provider: 'google', providers: ['google'] },
    user_metadata: { full_name: 'Eden Lu' },
    created_at: '2026-05-01T00:00:00.000Z', updated_at: new Date().toISOString(),
  },
}

const PLANS = {
  success: true,
  plans: [
    { id: 'rookie', name: 'Starter', price_usd_month: '25', price_usd_year: '249', limits: { credits_month: 200 } },
    { id: 'agent', name: 'Agent', price_usd_month: '49', price_usd_year: '490', limits: { credits_month: 1200 } },
    { id: 'founder', name: 'Agency', price_usd_month: '699', price_usd_year: '6990', limits: { credits_month: 15000 } },
    { id: 'developer', name: 'Developer', price_usd_month: '999', price_usd_year: '9990', limits: { credits_month: 20000 } },
  ],
}
const FEATURES = {
  success: true,
  features: [
    { key: 'reports', label: '买家意向报告', credits: 20, minPlan: 'rookie' },
    { key: 'live_tours', label: '实时带看', credits: 60, minPlan: 'agent' },
    { key: 'luna_tours', label: 'Luna 智能导览', credits: 100, minPlan: 'agent' },
  ],
  plans: [{ id: 'rookie', creditsMonth: 200, multiplier: 1 }, { id: 'agent', creditsMonth: 1200, multiplier: 1 }],
}

const meFor = (used) => ({
  success: true, approved: false, plan: { id: 'explore', name: 'Explore', limits: {} },
  status: 'none', role: 'agent', current_period_end: null,
  trial: { active: false, used, eligible: !used, endsAt: null, daysLeft: null },
  credits: { month: 0, used: 0, balance: 0 },
})

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 }, deviceScaleFactor: 2 })

for (const [name, used] of [['canTrial', false], ['usedTrial', true]]) {
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)))
  await page.addInitScript((s) => {
    localStorage.setItem('pinzos-auth', JSON.stringify(s))
    localStorage.setItem('pinzos-lang', 'zh-CN')
  }, mockSession)
  await page.route('**/api/**', (r) => r.fulfill({ json: { success: true } }))
  await page.route('**/api/billing/plans', (r) => r.fulfill({ json: PLANS }))
  await page.route('**/api/billing/features', (r) => r.fulfill({ json: FEATURES }))
  await page.route('**/api/billing/promo', (r) => r.fulfill({ json: { active: false } }))
  await page.route('**/api/billing/me', (r) => r.fulfill({ json: meFor(used) }))
  await page.route('**/api/me/profile', (r) => r.fulfill({ json: { success: true, role: 'agent' } }))

  await page.goto(BASE + '/agent/plans', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1400)
  await page.screenshot({ path: `scripts/_shot-plans-${name}.png` })
  console.log('✓', `_shot-plans-${name}.png`)
  await page.close()
}
await browser.close()
