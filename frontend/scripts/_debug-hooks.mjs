/** 抓 hooks 报错的组件栈(临时诊断) */
import { chromium } from 'playwright'

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: '11111111-1111-1111-1111-111111111111', email: 't@p.com', exp: 9999999999, aud: 'authenticated' })}.f`
const session = {
  access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: 9999999999, refresh_token: 'f',
  user: { id: '11111111-1111-1111-1111-111111111111', aud: 'authenticated', role: 'authenticated', email: 't@p.com', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } })
const page = await ctx.newPage()
const logs = []
page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()) })
page.on('pageerror', (e) => logs.push('PAGEERROR: ' + String(e).slice(0, 500)))

await page.addInitScript(([s]) => {
  localStorage.setItem('pinzos-lang', 'zh-CN')
  localStorage.setItem('pinzos-auth', JSON.stringify(s))
}, [session])
await page.route('**/api/me/profile', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ role: 'agent' }) }))
await page.route('**/api/billing/me', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, approved: true, plan: { id: 'agent', name: 'Pro', limits: {} }, status: 'active', current_period_end: null, credits: { month: 2500, used: 0, balance: 2500 } }) }))

await page.goto('http://localhost:5173/project/7b323ec3-4db9-47e0-919e-bc774ff47888?tab=payment', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(8000)
console.log('== errors during load ==')
console.log(logs.join('\n---\n').slice(0, 4000) || '(none)')
logs.length = 0

await page.locator('button:has-text("Sales Offer")').first().click()
await page.waitForTimeout(1500)
console.log('== errors after dialog open ==')
console.log(logs.join('\n---\n').slice(0, 4000) || '(none)')
logs.length = 0

await page.locator('text=TOWER B 1 BEDROOM A2').first().click()
await page.locator('button:has-text("调整")').first().click()
await page.waitForTimeout(800)
console.log('== errors after edit plan ==')
console.log(logs.join('\n---\n').slice(0, 4000) || '(none)')
logs.length = 0

await page.route('**/api/luna/public/payplan', (r) =>
  r.request().method() === 'POST'
    ? r.fulfill({ contentType: 'application/json', body: '{"code":"sotest"}' })
    : r.continue()
)
await page.locator('button:has-text("生成报价单")').click()
await page.waitForTimeout(2500)
console.log('== errors after generate+navigate ==', page.url())
console.log(logs.join('\n===\n').slice(0, 6000) || '(none)')

await browser.close()
