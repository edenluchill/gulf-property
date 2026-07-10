/** 复现 UserMenu → My badge 路径的证书对话框(用户实际点的路径)。 */
import { chromium } from 'playwright'
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: '1', email: 'lzp6529@gmail.com', exp: 9999999999, aud: 'authenticated' })}.f`
const session = { access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: 9999999999, refresh_token: 'f',
  user: { id: '1', aud: 'authenticated', role: 'authenticated', email: 'lzp6529@gmail.com', app_metadata: { provider: 'google' }, user_metadata: { full_name: 'Eden Lu' }, created_at: '2026-02-01T00:00:00Z' } }
const J = (d) => ({ contentType: 'application/json', body: JSON.stringify(d) })
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.25 })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))
await page.addInitScript(([s]) => { localStorage.setItem('pinzos-lang', 'en'); localStorage.setItem('pinzos-auth', JSON.stringify(s)) }, [session])
await page.route('**/api/me/profile', (r) => r.fulfill(J({ role: 'agent' })))
await page.route('**/api/billing/me', (r) => r.fulfill(J({ success: true, approved: true, plan: { id: 'agent', name: 'Agent', limits: {} }, status: 'active', current_period_end: '2126-06-27T00:00:00Z', credits: { month: 1200, used: 40, balance: 1160 } })))
await page.route('**/api/luna/agent/profile', (r) => r.request().method() === 'GET' ? r.fulfill(J({ success: true, agent: { display_name: 'Eden Lu', photo_url: null } })) : r.continue())

await page.goto('http://localhost:5173/profile', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(4000)
// 打开右上角 UserMenu:坐标精确点头像(避开页面里其它 chevron)
await page.mouse.click(1372, 40)
await page.waitForTimeout(700)
await page.screenshot({ path: 'shots-compass/cert2-menu.png' })
// 点 My badge
const badgeBtn = page.getByRole('button', { name: /badge|share it/i }).first()
if (await badgeBtn.count()) { await badgeBtn.click() } else { console.log('NO My-badge button') }
await page.waitForTimeout(3000)
await page.screenshot({ path: 'shots-compass/cert2-dialog.png' })
console.log('ERRORS:', errors.length ? errors.join('\n') : '(none)')
await browser.close()
