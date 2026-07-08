/**
 * 个人中心改版视觉验证(2026-07-08):
 * 注入 mock Supabase session(storageKey pinzos-auth)+ 拦截 billing/agents API,
 * 模拟「金牌经纪人 PRO」登录态,截 /profile 与 /agent 桌面 + 手机布局。
 * 用法: node scripts/_verify-profile.mjs   (需 5174 有 dev server)
 */
import { chromium } from 'playwright'

const BASE = process.env.SHOT_URL || 'http://localhost:5174'
const now = Math.floor(Date.now() / 1000)

const mockSession = {
  access_token: 'mock-access-token',
  refresh_token: 'mock-refresh-token',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: now + 3600,
  user: {
    id: '00000000-0000-4000-8000-000000000001',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'eden@example.com',
    email_confirmed_at: new Date().toISOString(),
    app_metadata: { provider: 'google', providers: ['google'] },
    user_metadata: { full_name: 'Eden Lu', name: 'Eden Lu' },
    created_at: '2026-05-01T00:00:00.000Z',
    updated_at: new Date().toISOString(),
  },
}

async function setupPage(ctx) {
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)))

  await page.addInitScript((session) => {
    localStorage.setItem('pinzos-auth', JSON.stringify(session))
    localStorage.setItem('pinzos-lang', 'zh-CN')
    sessionStorage.setItem('pinzos-role', 'agent')
  }, mockSession)

  // 注意:playwright 后注册的 route 优先 —— 先注册兜底,再注册专用 mock。
  // 兜底:其余 API 返回空,避免 dev 无后端时报连接错卡 loading
  await page.route('**/api/**', (route) =>
    route.fulfill({ json: { success: true, items: [], tours: [], clients: [], reports: [], events: [] } }))
  // 关键 API:金牌经纪 + 审批通过
  await page.route('**/api/billing/me', (route) =>
    route.fulfill({ json: {
      success: true, approved: true,
      plan: { id: 'agent', name: '金牌经纪 PRO', limits: {} },
      status: 'active', current_period_end: null, teamMember: false,
      credits: { month: 600, used: 12, balance: 588 },
    } }))
  await page.route('**/api/agents/me', (route) =>
    route.fulfill({ json: { status: 'approved' } }))
  return page
}

const browser = await chromium.launch()

// 桌面
const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
let page = await setupPage(desktop)
for (const [path, out] of [
  ['/profile', 'shot-profile-desktop.png'],
  ['/agent', 'shot-agent-desktop.png'],
  ['/agent/billing', 'shot-agent-billing-desktop.png'],
]) {
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3500)
  await page.screenshot({ path: out })
  console.log('saved:', out)
}
await desktop.close()

// 手机 (iPhone 14 Pro 尺寸)
const mobile = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
page = await setupPage(mobile)
for (const [path, out] of [
  ['/profile', 'shot-profile-mobile.png'],
  ['/agent', 'shot-agent-mobile.png'],
]) {
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3500)
  await page.screenshot({ path: out })
  console.log('saved:', out)
}
await mobile.close()

await browser.close()
