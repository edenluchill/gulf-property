/**
 * 试用相关 UI 验证 (2026-07-11)。
 * 三种状态各截一次 /profile 与 /agent/billing:
 *   eligible  经纪、未订阅、没领过 → 应出现「你还有 7 天免费试用没领」
 *   trialing  试用中             → 试用条 + 积分表「还能做 N 次」
 *   buyer     买家、未订阅        → 「你是经纪?切换身份」引导,且不显示「剩 0/0」
 *
 * 用法: node scripts/_verify-trial-ui.mjs   (需要 5174 有 dev server)
 */
import { chromium } from 'playwright'

const BASE = process.env.SHOT_URL || 'http://localhost:5174'
const now = Math.floor(Date.now() / 1000)

const mockSession = {
  access_token: 'mock-access-token', refresh_token: 'mock-refresh-token',
  token_type: 'bearer', expires_in: 3600, expires_at: now + 3600,
  user: {
    id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated',
    email: 'eden@example.com', email_confirmed_at: new Date().toISOString(),
    app_metadata: { provider: 'google', providers: ['google'] },
    user_metadata: { full_name: 'Eden Lu', name: 'Eden Lu' },
    created_at: '2026-05-01T00:00:00.000Z', updated_at: new Date().toISOString(),
  },
}

const FEATURES = {
  success: true,
  features: [
    { key: 'reports', label: '买家意向报告', labelEn: 'Buyer proposal', credits: 20, minPlan: 'rookie' },
    { key: 'brochures', label: 'AI 楼书解析', labelEn: 'AI brochure parsing', credits: 40, minPlan: 'rookie' },
    { key: 'live_tours', label: '实时带看', labelEn: 'Live tour', credits: 60, minPlan: 'agent' },
    { key: 'luna_tours', label: 'Luna 智能导览', labelEn: 'Luna AI tour', credits: 100, minPlan: 'agent' },
    { key: 'payplan', label: 'Sales Offer 报价单', labelEn: 'Sales offer', credits: 5, minPlan: 'rookie' },
  ],
  plans: [{ id: 'agent', creditsMonth: 1200, multiplier: 1 }],
}

// 三种状态的 /billing/me 与 /me/profile
const CASES = {
  eligible: {
    role: 'agent',
    me: {
      success: true, approved: true, plan: { id: 'explore', name: 'Explore', limits: {} },
      status: 'none', current_period_end: null, role: 'agent',
      trial: { active: false, used: false, eligible: true, endsAt: null, daysLeft: null },
      credits: { month: 0, used: 0, balance: 0 },
    },
  },
  trialing: {
    role: 'agent',
    me: {
      success: true, approved: true, plan: { id: 'agent', name: 'Agent', limits: {} },
      status: 'trialing', current_period_end: new Date(Date.now() + 5 * 864e5).toISOString(), role: 'agent',
      trial: { active: true, used: true, eligible: false, endsAt: new Date(Date.now() + 5 * 864e5).toISOString(), daysLeft: 5 },
      credits: { month: 200, used: 45, balance: 155 },
    },
  },
  buyer: {
    role: 'buyer',
    me: {
      success: true, approved: false, plan: { id: 'explore', name: 'Explore', limits: {} },
      status: 'none', current_period_end: null, role: 'buyer',
      trial: { active: false, used: false, eligible: false, endsAt: null, daysLeft: null },
      credits: { month: 0, used: 0, balance: 0 },
    },
  },
}

async function setupPage(ctx, c) {
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)))

  await page.addInitScript((s) => {
    localStorage.setItem('pinzos-auth', JSON.stringify(s))
    localStorage.setItem('pinzos-lang', 'zh-CN')
    // 故意不写 sessionStorage.pinzos-role —— 验证 useMyRole 以服务端为准
  }, mockSession)

  // 后注册的 route 优先:先兜底,再专用
  await page.route('**/api/**', (r) => r.fulfill({ json: { success: true, items: [], clients: [], entries: [], tours: [], sessions: [] } }))
  await page.route('**/api/billing/me', (r) => r.fulfill({ json: c.me }))
  await page.route('**/api/me/profile', (r) => r.fulfill({ json: { success: true, role: c.role, roleChosenAt: null } }))
  await page.route('**/api/agents/me', (r) => r.fulfill({ json: { status: 'approved' } }))
  await page.route('**/api/billing/features', (r) => r.fulfill({ json: FEATURES }))
  await page.route('**/api/luna/agent/profile', (r) => r.fulfill({ json: { success: true, agent: { display_name: 'Eden Lu' } } }))
  return page
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2 })

for (const [name, c] of Object.entries(CASES)) {
  const page = await setupPage(ctx, c)
  for (const path of ['/profile', '/agent/billing']) {
    await page.goto(BASE + path, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1200)
    const file = `_shot-trial-${name}-${path.split('/').pop()}.png`
    await page.screenshot({ path: `scripts/${file}` })
    console.log('✓', file)
  }
  await page.close()
}

await browser.close()
