/** 头像下拉菜单验证:mock 金牌经纪登录态,打开 UserMenu 截图。 */
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

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
await page.addInitScript((session) => {
  localStorage.setItem('pinzos-auth', JSON.stringify(session))
  localStorage.setItem('pinzos-lang', 'zh-CN')
  sessionStorage.setItem('pinzos-role', 'agent')
}, mockSession)
await page.route('**/api/**', (route) => route.fulfill({ json: { success: true, items: [] } }))
await page.route('**/api/billing/me', (route) => route.fulfill({ json: {
  success: true, approved: true, plan: { id: 'agent', name: '金牌经纪 PRO', limits: {} },
  status: 'active', current_period_end: null, teamMember: false,
  credits: { month: 600, used: 12, balance: 588 },
} }))
await page.route('**/api/agents/me', (route) => route.fulfill({ json: { status: 'approved' } }))

await page.goto(BASE + '/profile', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3000)
await page.screenshot({ path: 'shot-usermenu-before.png' })
// 打开头像菜单(header 最右侧的头像按钮)
const btns = await page.locator('header button').count()
console.log('header buttons:', btns)
await page.locator('header button').last().click()
await page.waitForTimeout(800)
await page.screenshot({ path: 'shot-usermenu.png' })
console.log('saved: shot-usermenu.png')
// 点击勋章牌 → 应进入 /profile(不再弹分享图)
await page.locator('header a[href="/profile"]').first().click()
await page.waitForTimeout(1500)
console.log('after badge-area click, url =', page.url())
await browser.close()
