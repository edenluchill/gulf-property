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
  // 套餐目录(年付实收价:rookie=249)
  await page.route('**/api/billing/plans', (route) =>
    route.fulfill({ json: { success: true, plans: [
      { id: 'explore', name: 'Explore', price_usd_month: '0', price_usd_year: '0', limits: {} },
      { id: 'rookie', name: 'Starter', price_usd_month: '25', price_usd_year: '249', limits: { credits_month: 200 } },
      { id: 'agent', name: 'Agent', price_usd_month: '49', price_usd_year: '490', limits: { credits_month: 2500 } },
      { id: 'founder', name: 'Agency', price_usd_month: '699', price_usd_year: '6990', limits: { credits_month: 15000 } },
    ] } }))
  await page.route('**/api/billing/features', (route) =>
    route.fulfill({ json: { success: true, features: [], plans: [] } }))
  // 经纪名片(平铺展示用)
  await page.route('**/api/luna/agent/profile', (route) =>
    route.fulfill({ json: { success: true, agent: {
      display_name: 'Eden Lu', phone: '+971 50 123 4567',
      whatsapp: '971501234567', public_email: 'eden@pinzos.com', photo_url: null,
    } } }))
  // 现役指标(工作台"该追谁"用)
  await page.route('**/api/luna/agent/clients**', (route) =>
    route.fulfill({ json: { success: true, clients: [
      { id: 'c1', name: '陈先生', budget: '300万', heat: 82, pipeline_stage: 'viewing', last_activity_at: new Date(Date.now() - 3600e3).toISOString(), next_followup_at: new Date(Date.now() - 3600e3).toISOString() },
      { id: 'c2', name: '王女士', budget: '500万', heat: 45, pipeline_stage: 'engaged', last_activity_at: new Date(Date.now() - 8 * 3600e3).toISOString(), next_followup_at: null },
    ] } }))
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
// 里程碑庆祝框:付款成功回跳(?status=success)自动弹
await page.goto(BASE + '/agent/billing?status=success', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3500)
await page.screenshot({ path: 'shot-celebrate.png' })
console.log('saved: shot-celebrate.png')
await desktop.close()

// 手机 (iPhone 14 Pro 尺寸)
const mobile = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
page = await setupPage(mobile)
for (const [path, out] of [
  ['/profile', 'shot-profile-mobile.png'],
  ['/agent', 'shot-agent-mobile.png'],
  ['/agent/billing', 'shot-billing-mobile.png'],
]) {
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3500)
  await page.screenshot({ path: out })
  console.log('saved:', out)
}
await mobile.close()

// 买家视角:经纪工作台上锁 + 订阅 tab 仍可见
const buyer = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
page = await buyer.newPage()
await page.addInitScript((session) => {
  localStorage.setItem('pinzos-auth', JSON.stringify(session))
  localStorage.setItem('pinzos-lang', 'zh-CN')
  sessionStorage.setItem('pinzos-role', 'buyer')
}, mockSession)
await page.route('**/api/**', (route) =>
  route.fulfill({ json: { success: true, items: [], role: 'buyer' } }))
await page.route('**/api/billing/me', (route) =>
  route.fulfill({ json: {
    success: true, approved: false,
    plan: { id: 'explore', name: '探索', limits: {} },
    status: 'none', current_period_end: null, teamMember: false,
    credits: { month: 0, used: 0, balance: 0 },
  } }))
await page.route('**/api/agents/me', (route) => route.fulfill({ json: { status: 'none' } }))
await page.route('**/api/billing/plans', (route) =>
  route.fulfill({ json: { success: true, plans: [
    { id: 'explore', name: 'Explore', price_usd_month: '0', price_usd_year: '0', limits: {} },
    { id: 'rookie', name: 'Starter', price_usd_month: '25', price_usd_year: '249', limits: { credits_month: 200 } },
    { id: 'agent', name: 'Agent', price_usd_month: '49', price_usd_year: '490', limits: { credits_month: 2500 } },
    { id: 'founder', name: 'Agency', price_usd_month: '699', price_usd_year: '6990', limits: { credits_month: 15000 } },
  ] } }))
await page.route('**/api/billing/features', (route) => route.fulfill({ json: { success: true, features: [], plans: [] } }))
await page.goto(BASE + '/profile', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3500)
await page.screenshot({ path: 'shot-profile-buyer.png' })
console.log('saved: shot-profile-buyer.png')

// 买家看订阅页:月付视图(验证 Pro=$49/月),再切年付(rookie=$249、Pro=$490)
await page.goto(BASE + '/agent/billing', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3000)
await page.screenshot({ path: 'shot-billing-month.png' })
console.log('saved: shot-billing-month.png')
const yearBtn = page.locator('button', { hasText: '按年付' }).first()
if (await yearBtn.count()) { await yearBtn.click(); await page.waitForTimeout(600) }
await page.screenshot({ path: 'shot-billing-year.png' })
console.log('saved: shot-billing-year.png')
await buyer.close()

await browser.close()
