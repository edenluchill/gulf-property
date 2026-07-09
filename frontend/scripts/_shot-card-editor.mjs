/** 弹窗内「编辑名片」入口 + 名片编辑器(含邮箱字段)验证截图 */
import { chromium } from 'playwright'

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: '11111111-1111-1111-1111-111111111111', email: 't@p.com', exp: 9999999999, aud: 'authenticated' })}.f`
const session = {
  access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: 9999999999, refresh_token: 'f',
  user: { id: '11111111-1111-1111-1111-111111111111', aud: 'authenticated', role: 'authenticated', email: 't@p.com', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1.5 })
const page = await ctx.newPage()
await page.addInitScript(([s]) => {
  localStorage.setItem('pinzos-lang', 'zh-CN')
  localStorage.setItem('pinzos-auth', JSON.stringify(s))
}, [session])
await page.route('**/api/me/profile', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ role: 'agent' }) }))
await page.route('**/api/billing/me', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, approved: true, plan: { id: 'agent', name: 'Pro', limits: {} }, status: 'active', current_period_end: null, credits: { month: 2500, used: 0, balance: 2500 } }) }))
await page.route('**/api/luna/agent/profile', (r) =>
  r.request().method() === 'GET'
    ? r.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, agent: { display_name: 'Eden Lu', phone: '+971 50 123 4567', whatsapp: '971501234567', public_email: 'eden@pinzos.com', photo_url: null } }) })
    : r.continue()
)

await page.goto('http://localhost:5173/project/7b323ec3-4db9-47e0-919e-bc774ff47888?tab=payment', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(8000)
await page.locator('button:has-text("Sales Offer")').first().click()
await page.waitForTimeout(1200)
await page.locator('button:has-text("编辑名片")').scrollIntoViewIfNeeded()
await page.waitForTimeout(400)
await page.screenshot({ path: 'shots-compass/dialog-card-row.png' })
await page.locator('button:has-text("编辑名片")').click()
await page.waitForTimeout(1000)
await page.screenshot({ path: 'shots-compass/card-editor.png' })
await browser.close()
console.log('ok')
