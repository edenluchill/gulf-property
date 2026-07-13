/**
 * 登录回归测试 —— 改任何 auth 相关代码之后必跑。
 *
 * 用法:
 *   npx vite --port 5199 --strictPort &          # 或指向任意环境
 *   node scripts/auth-check.mjs
 *   SHOT_URL=https://www.pinzos.com/ node scripts/auth-check.mjs   # 打生产
 *
 * 覆盖四个曾经真实炸过的场景(每一条都对应线上埋点里的真实故障):
 *
 *   1. 锁争用 —— navigator.locks 是 origin 级共享锁,被冻结的后台 tab 占死时,
 *      gotrue 等 10s 后 abort() → "signal is aborted without reason" → 登录失败。
 *      线上 14 条 auth_failure 全是这一条。
 *   2. 多 tab 同步 —— auth-js 不监听 storage 事件,A tab 退出后 B tab 还显示登录着。
 *   3. 微信 WebView —— 微信拦外部 OAuth 跳转,Google 按钮在微信里点了必然失败。
 *   4. 对照组 —— 普通浏览器里 Google 按钮必须还在(别把好人也误伤了)。
 *
 * 多设备共用一个账号(scope:'local' 不连坐)在后端测:
 *   cd backend && npx ts-node scripts/auth-multidevice-check.ts
 */
import { chromium } from 'playwright'

const BASE = process.env.SHOT_URL || 'http://localhost:5174/'
const LOCK_NAME = 'lock:pinzos-auth' // 派生自 supabase.ts 的 storageKey
const AUTH_KEY = 'pinzos-auth'
const WECHAT_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49(0x18003128) NetType/WIFI Language/zh_CN'

/** 一个没过期的假 session。getSession() 只读本地存储 + 比对 exp,不发网络请求,
 *  所以假 token 足够验证"登录态认不认得出来"。 */
function fakeSession() {
  const exp = Math.floor(Date.now() / 1000) + 3600
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const id = '00000000-0000-0000-0000-000000000001'
  return {
    access_token: [
      b64({ alg: 'ES256', typ: 'JWT' }),
      b64({ sub: id, email: 'authcheck@pinzos.test', exp, role: 'authenticated' }),
      'sig',
    ].join('.'),
    refresh_token: 'fake-refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: exp,
    user: {
      id,
      aud: 'authenticated',
      role: 'authenticated',
      email: 'authcheck@pinzos.test',
      app_metadata: {},
      user_metadata: {},
      created_at: new Date(0).toISOString(),
    },
  }
}

/** app 认为自己登录着吗?—— 看还有没有指向 /login 的入口,比抠文案稳。 */
const loggedIn = (page) =>
  page.evaluate(() => !document.querySelector('a[href="/login"], a[href^="/login?"]'))

async function settle(page, want, tries = 30) {
  for (let i = 0; i < tries; i++) {
    if ((await loggedIn(page)) === want) return true
    await page.waitForTimeout(500)
  }
  return false
}

const results = []
const record = (name, pass, detail) => results.push({ name, pass, detail })

const browser = await chromium.launch()

// ── 1. 锁被冻结的后台 tab 占死时,登录态照样要认得出来 ──────────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e)))

  await page.addInitScript(
    ([session, key, lockName]) => {
      localStorage.setItem(key, JSON.stringify(session))
      // 模拟被浏览器冻结的后台 tab:抢到锁之后永远不释放
      navigator.locks.request(lockName, { mode: 'exclusive' }, () => new Promise(() => {}))
    },
    [fakeSession(), AUTH_KEY, LOCK_NAME]
  )

  const t0 = Date.now()
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 })
  const ok = await settle(page, true)
  const ms = Date.now() - t0
  const aborts = pageErrors.filter((e) => /abort/i.test(e))

  record(
    '锁争用:后台 tab 占死 navigator.locks 时,仍认得出登录态',
    ok && aborts.length === 0,
    `认出登录态=${ok} (${ms}ms), abort 报错=${aborts.length} 条` +
      (aborts.length ? ` — ${aborts[0].slice(0, 80)}` : '')
  )
  await ctx.close()
}

// ── 2. 多 tab 同步:A 退出,B 必须跟着登出 ──────────────────────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  await ctx.addInitScript(
    ([session, key]) => localStorage.setItem(key, JSON.stringify(session)),
    [fakeSession(), AUTH_KEY]
  )
  const tabA = await ctx.newPage()
  const tabB = await ctx.newPage()
  await tabA.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await tabB.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 })

  const bothIn = (await settle(tabA, true)) && (await settle(tabB, true))
  await tabA.evaluate((key) => localStorage.removeItem(key), AUTH_KEY) // A 退出
  const bFollowed = await settle(tabB, false)

  record(
    '多 tab 同步:A tab 退出后 B tab 跟着登出',
    bothIn && bFollowed,
    `两个 tab 都认出登录=${bothIn}; A 退出后 B 跟着登出=${bFollowed}`
  )
  await ctx.close()
}

// ── 3 & 4. 微信 WebView 降级 / 普通浏览器对照组 ────────────────────────────
for (const [label, ua, wantGoogle] of [
  ['微信 WebView', WECHAT_UA, false],
  ['普通浏览器(对照组)', null, true],
]) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    ...(ua ? { userAgent: ua } : {}),
  })
  const page = await ctx.newPage()
  await page.goto(new URL('login', BASE).href, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(3000)

  // 必须找真正可点的 <button> —— 光看文案会被提示语里的「无法使用 Google 登录」骗到
  const hasGoogleBtn = await page.evaluate(() =>
    [...document.querySelectorAll('button')].some((b) =>
      /Continue with Google|使用 Google 登录/i.test(b.innerText || '')
    )
  )
  const text = await page.evaluate(() => document.body.innerText)
  const hasHint = /微信内无法使用|doesn.t work inside WeChat/i.test(text)
  const hasEmail = (await page.locator('input[type="email"]').count()) > 0

  record(
    `${label}:Google 按钮${wantGoogle ? '在' : '不在'},邮箱登录可用`,
    hasGoogleBtn === wantGoogle && hasEmail && (wantGoogle || hasHint),
    `Google按钮=${hasGoogleBtn} 微信提示=${hasHint} 邮箱输入框=${hasEmail}`
  )
  await ctx.close()
}

await browser.close()

console.log('\n' + '─'.repeat(72))
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
  console.log(`      ${r.detail}`)
}
console.log('─'.repeat(72))
const allPass = results.every((r) => r.pass)
console.log(allPass ? `全部通过 (${results.length}/${results.length})` : '有失败项')
process.exit(allPass ? 0 : 1)
