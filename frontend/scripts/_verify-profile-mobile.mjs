/** 手机端个人中心改版验证:紧凑 hero + 汉堡菜单 Sheet + 退出登录 */
import { chromium } from 'playwright'

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: '11111111-1111-1111-1111-111111111111', email: 'lzp6529@gmail.com', exp: 9999999999, aud: 'authenticated' })}.f`
const session = {
  access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: 9999999999, refresh_token: 'f',
  user: {
    id: '11111111-1111-1111-1111-111111111111', aud: 'authenticated', role: 'authenticated',
    email: 'lzp6529@gmail.com', app_metadata: { provider: 'google' },
    user_metadata: { full_name: 'Eden Lu' }, created_at: '2026-02-01T00:00:00Z',
  },
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true })
const page = await ctx.newPage()
await page.addInitScript(([s]) => {
  localStorage.setItem('pinzos-lang', 'zh-CN')
  localStorage.setItem('pinzos-auth', JSON.stringify(s))
}, [session])
await page.route('**/api/me/profile', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ role: 'agent' }) }))
await page.route('**/api/billing/me', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, approved: true, plan: { id: 'agent', name: 'Pro', limits: {} }, status: 'active', current_period_end: '2026-08-01T00:00:00Z', credits: { month: 2500, used: 340, balance: 2160 } }) }))
await page.route('**/api/luna/agent/profile', (r) =>
  r.request().method() === 'GET'
    ? r.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, agent: { display_name: 'Eden Lu', phone: '+17783221822', whatsapp: null, public_email: null, photo_url: null } }) })
    : r.continue()
)

await page.goto('http://localhost:5173/profile', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(4000)
await page.screenshot({ path: 'shots-compass/profile-mobile-home.png' })

// 打开汉堡菜单
await page.locator('button:has-text("菜单")').first().click()
await page.waitForTimeout(700)
await page.screenshot({ path: 'shots-compass/profile-mobile-menu.png' })

await browser.close()
console.log('ok')
