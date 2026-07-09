/**
 * Sales Offer 弹窗验证截图(伪造登录态:localStorage 假 session + 拦截
 * /billing/me 与 /me/profile)。桌面/pad/手机三档,含周期编辑态。
 * 用法: node scripts/_shot-offer-dialog.mjs
 */
import { chromium } from 'playwright'

const PROJECT = '7b323ec3-4db9-47e0-919e-bc774ff47888' // Creek Bay(户型有标价+户型图)

const fakeJwt = (() => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: '11111111-1111-1111-1111-111111111111', email: 'test@pinzos.com', exp: 9999999999, aud: 'authenticated' })}.fake`
})()
const fakeSession = {
  access_token: fakeJwt,
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: 9999999999,
  refresh_token: 'fake-refresh',
  user: {
    id: '11111111-1111-1111-1111-111111111111',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'test@pinzos.com',
    app_metadata: {},
    user_metadata: {},
    created_at: '2026-01-01T00:00:00Z',
  },
}

const VIEWPORTS = [
  { tag: 'desktop', width: 1400, height: 1000, mobile: false },
  { tag: 'pad', width: 834, height: 1112, mobile: true },
  { tag: 'mobile', width: 414, height: 800, mobile: true },
]

const browser = await chromium.launch()
for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1.5,
    isMobile: vp.mobile,
    hasTouch: vp.mobile,
  })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log(`[pageerror:${vp.tag}]`, String(e).slice(0, 200)))

  await page.addInitScript(([session]) => {
    localStorage.setItem('pinzos-lang', 'zh-CN')
    localStorage.setItem('pinzos-auth', JSON.stringify(session))
  }, [fakeSession])
  await page.route('**/api/me/profile', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ role: 'agent' }) })
  )
  // LOCKED=1 模拟未订阅经纪(explore 档)→ 入口按钮应显示锁 + 会员标识
  const locked = process.env.LOCKED === '1'
  await page.route('**/api/billing/me', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        success: true, approved: false,
        plan: locked ? { id: 'explore', name: 'Explore', limits: {} } : { id: 'agent', name: 'Pro', limits: {} },
        status: locked ? 'none' : 'active',
        current_period_end: null,
        credits: locked ? { month: 0, used: 0, balance: 0 } : { month: 2500, used: 0, balance: 2500 },
      }),
    })
  )

  await page.goto(`http://localhost:5173/project/${PROJECT}?tab=payment`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(9000)

  const entry = page.locator('button:has-text("Sales Offer")').first()
  await entry.scrollIntoViewIfNeeded().catch(() => {})
  await page.waitForTimeout(400)
  await page.screenshot({ path: `shots-compass/offer-entry-${vp.tag}${locked ? '-locked' : ''}.png` })
  if (locked) {
    // 未订阅:点击应开弹窗内升级引导(绝不 redirect)
    await entry.click()
    await page.waitForTimeout(800)
    const stillHere = page.url().includes('/project/')
    console.log(`${vp.tag} locked no-redirect: ${stillHere ? 'PASS' : 'FAIL url=' + page.url()}`)
    await page.screenshot({ path: `shots-compass/offer-upgrade-${vp.tag}.png` })
    await ctx.close(); console.log(`${vp.tag} locked ok`); continue
  }

  await entry.click()
  await page.waitForTimeout(1200)
  // 选个户型 + 展开周期编辑
  await page.locator('text=TOWER B 1 BEDROOM A2').first().click().catch(() => {})
  await page.locator('button:has-text("调整")').first().click()
  await page.waitForTimeout(600)
  await page.screenshot({ path: `shots-compass/offer-dialog-${vp.tag}.png` })

  // 周期编辑行(小屏确认一行放得下)
  await page.locator('button:has-text("添加一期")').scrollIntoViewIfNeeded().catch(() => {})
  await page.waitForTimeout(400)
  await page.screenshot({ path: `shots-compass/offer-dialog-${vp.tag}-plan.png` })

  // 生成成功 → 应直接跳到报价单页(POST 用 mock 返回 sotest)
  await page.route('**/api/luna/public/payplan', (r) =>
    r.request().method() === 'POST'
      ? r.fulfill({ contentType: 'application/json', body: '{"code":"sotest"}' })
      : r.continue()
  )
  await page.locator('button:has-text("生成报价单")').click()
  await page.waitForTimeout(1500)
  const navOk = page.url().includes('/pp/sotest')
  console.log(`${vp.tag} generate-redirect: ${navOk ? 'PASS' : 'FAIL url=' + page.url()}`)
  if (vp.tag === 'desktop') {
    await page.waitForTimeout(4000)
    await page.screenshot({ path: 'shots-compass/offer-page-share.png' })
  }

  await ctx.close()
  console.log(`${vp.tag} ok`)
}
await browser.close()
console.log('done')
