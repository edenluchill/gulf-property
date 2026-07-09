/** MoneyInput 交互自测:删空 / 中间插入 / 失焦格式化(2026-07-07 输入框事故后加) */
import { chromium } from 'playwright'

const PROJECT = '7b323ec3-4db9-47e0-919e-bc774ff47888'
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: '11111111-1111-1111-1111-111111111111', email: 't@p.com', exp: 9999999999, aud: 'authenticated' })}.f`
const session = {
  access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: 9999999999, refresh_token: 'f',
  user: { id: '11111111-1111-1111-1111-111111111111', aud: 'authenticated', role: 'authenticated', email: 't@p.com', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } })
const page = await ctx.newPage()
await page.addInitScript(([s]) => {
  localStorage.setItem('pinzos-lang', 'zh-CN')
  localStorage.setItem('pinzos-auth', JSON.stringify(s))
}, [session])
await page.route('**/api/me/profile', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ role: 'agent' }) }))
await page.route('**/api/billing/me', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, approved: true, plan: { id: 'agent', name: 'Pro', limits: {} }, status: 'active', current_period_end: null, credits: { month: 2500, used: 0, balance: 2500 } }) }))

await page.goto(`http://localhost:5173/project/${PROJECT}?tab=payment`, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(9000)
await page.locator('button:has-text("Sales Offer")').first().click()
await page.waitForTimeout(1000)

const input = page.locator('div.fixed input[inputmode="numeric"]').first()
const val = () => input.inputValue()
const assert = async (name, expected) => {
  const v = await val()
  console.log(`${v === expected ? 'PASS' : 'FAIL'} ${name}: "${v}" (expect "${expected}")`)
}

// 1. 选户型 → 预填标价;失焦态显示千分位
await page.locator('text=TOWER B 1 BEDROOM A2').first().click()
await page.waitForTimeout(300)
await assert('选户型预填(失焦格式化)', '1,790,000')

// 2. 聚焦 → 纯数字
await input.click()
await assert('聚焦显示纯数字', '1790000')

// 3. 全选删除 → 真的空,不弹回
await page.keyboard.press('Control+a')
await page.keyboard.press('Backspace')
await assert('删空后保持空', '')

// 4. 输入 12345,左移2位插入 9 → 123945(光标不跳)
await page.keyboard.type('12345')
await page.keyboard.press('ArrowLeft')
await page.keyboard.press('ArrowLeft')
await page.keyboard.type('9')
await assert('中间插入光标稳定', '123945')

// 5. 失焦 → 格式化
await page.keyboard.press('Tab')
await page.waitForTimeout(200)
await assert('失焦千分位', '123,945')

await browser.close()
