/** 复现「我的认证证书」对话框 layout,并抓 console 错误。 */
import { chromium } from 'playwright'

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: '2', email: 'realtorgptapp@gmail.com', exp: 9999999999, aud: 'authenticated' })}.f`
const session = {
  access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: 9999999999, refresh_token: 'f',
  user: { id: '2', aud: 'authenticated', role: 'authenticated', email: 'realtorgptapp@gmail.com', app_metadata: { provider: 'google' }, user_metadata: { full_name: 'realtorgpt app' }, created_at: '2026-06-01T00:00:00Z' },
}
const J = (d) => ({ contentType: 'application/json', body: JSON.stringify(d) })

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.25 })
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))

await page.addInitScript(([s]) => { localStorage.setItem('pinzos-lang', 'en'); localStorage.setItem('pinzos-auth', JSON.stringify(s)) }, [session])
await page.route('**/api/me/profile', (r) => r.fulfill(J({ role: 'agent' })))
await page.route('**/api/billing/me', (r) => r.fulfill(J({ success: true, approved: true, plan: { id: 'rookie', name: 'Starter', limits: {} }, status: 'trialing', current_period_end: '2026-07-17T00:00:00Z', credits: { month: 200, used: 5, balance: 195 } })))
await page.route('**/api/luna/agent/profile', (r) => r.request().method() === 'GET'
  ? r.fulfill(J({ success: true, agent: { display_name: 'realtorgpt app', phone: null, whatsapp: null, public_email: null, photo_url: null } }))
  : r.continue())

await page.goto('http://localhost:5173/profile', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(4000)
// 点 hero 里的 "Certified Agent · Share" / badge 按钮
const btn = page.locator('button:has-text("Share"), button:has-text("Certified")').first()
if (await btn.count()) { await btn.click() } else { console.log('NO badge button found') }
await page.waitForTimeout(3000)
await page.screenshot({ path: 'shots-compass/cert-dialog.png' })
console.log('=== CONSOLE ERRORS ===')
console.log(errors.length ? errors.join('\n') : '(none)')
await browser.close()
