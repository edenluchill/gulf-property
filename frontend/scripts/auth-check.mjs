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

// ── 3. 乐观渲染必须能被纠正 ────────────────────────────────────────────────
// AuthContext 同步读 localStorage 先把登录态画出来(首屏零等待)。代价是:如果那份
// session 其实已经失效,界面会先"骗人"说你登录着。校验链路必须把它纠正回未登录 ——
// 否则用户会看到一个假的登录态,点什么都 401。
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  const dead = fakeSession()
  dead.expires_at = Math.floor(Date.now() / 1000) - 60 // 已过期 → SDK 必然去刷新
  dead.refresh_token = 'definitely-invalid-refresh-token' // → 刷新必然失败
  await ctx.addInitScript(
    ([s, key]) => localStorage.setItem(key, JSON.stringify(s)),
    [dead, AUTH_KEY]
  )
  const page = await ctx.newPage()
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 })

  const corrected = await settle(page, false) // 必须最终变回「未登录」
  record(
    '乐观渲染:本地 session 已失效时,界面必须被纠正回未登录',
    corrected,
    `最终显示未登录=${corrected}(false 说明界面在骗人:显示登录着,实际 token 是死的)`
  )
  await ctx.close()
}

// ── 4. 已登录用户首屏不得闪过「登录」入口(桌面 + 手机/平板底栏) ─────────────
// 事后查 DOM 是看不出闪烁的 —— 从页面加载起就用 MutationObserver 盯着,只要「登录」
// 入口出现过一帧就算失败。登录态未定时应当显示骨架,而不是断言"你没登录"。
for (const [label, viewport] of [
  ['桌面 Header', { width: 1400, height: 900 }],
  ['手机底栏 MobileNav', { width: 390, height: 844 }],
  ['iPad 底栏 MobileNav', { width: 1024, height: 1366 }],
]) {
  const ctx = await browser.newContext({ viewport })
  await ctx.addInitScript(
    ([session, key]) => {
      localStorage.setItem(key, JSON.stringify(session))
      window.__sawLogin = false
      const check = () => {
        if (document.querySelector('a[href="/login"], a[href^="/login?"]')) window.__sawLogin = true
      }
      new MutationObserver(check).observe(document.documentElement, { childList: true, subtree: true })
      const t = setInterval(check, 16) // MutationObserver 之外再高频轮询,别漏掉任何一帧
      setTimeout(() => clearInterval(t), 8000)
    },
    [fakeSession(), AUTH_KEY]
  )
  const page = await ctx.newPage()
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await settle(page, true)
  await page.waitForTimeout(1500)

  const flashed = await page.evaluate(() => window.__sawLogin)
  record(
    `${label}:已登录时首屏不闪「登录」`,
    !flashed,
    flashed ? '闪过「登录」入口 —— 用户会看到自己被显示成未登录' : '全程没出现过「登录」入口'
  )
  await ctx.close()
}

// ── 5. 匿名用户必须立刻能点「登录」,不能卡在骨架上 ──────────────────────────
// 反向的坑:为了不闪而让所有人陪着等 —— 匿名用户盯着骨架干等(锁被占死时最长 5 秒),
// 连登录按钮都点不了。那比闪一下更糟。
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  await ctx.addInitScript((lockName) => {
    // 连锁都被占死的最坏情况下,匿名用户也必须马上看到登录入口
    navigator.locks.request(lockName, { mode: 'exclusive' }, () => new Promise(() => {}))
  }, LOCK_NAME)
  const page = await ctx.newPage()
  const t0 = Date.now()
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 })
  const appeared = await settle(page, false) // 未登录 = 有 /login 入口
  const ms = Date.now() - t0
  record(
    '匿名用户(且锁被占死):立刻能看到并点到「登录」',
    appeared && ms < 3000,
    `登录入口出现耗时 ${ms}ms(超过 3 秒就是把匿名用户卡在骨架上了)`
  )
  await ctx.close()
}

// ── 6. OAuth 回调进行中,不得显示「登录」──────────────────────────────────
// 这是唯一真正「还不知道你是谁」的时刻:token 正在被换成 session。这里显示「登录」
// 等于在用户正登录的当口断言他没登录。
// (曾经真的挂在这:auth-js 初始化会先发一个 session=null 的 INITIAL_SESSION,
//  onAuthStateChange 照单全收 setLoading(false) → 回调页顶栏/底栏直接画成「登录」。)
for (const [label, viewport] of [
  ['桌面', { width: 1400, height: 900 }],
  ['手机', { width: 390, height: 844 }],
]) {
  const ctx = await browser.newContext({ viewport })
  const page = await ctx.newPage()
  // 让 Supabase auth 端点永不返回 → 稳定停在"正在换 session"这一帧
  await page.route('**/auth/v1/**', () => {})

  const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const jwt = [b64u({ alg: 'HS256', typ: 'JWT' }), b64u({ sub: 'x', exp: 9999999999 }), 'sig'].join('.')
  await page.goto(
    `${BASE}auth/callback#access_token=${jwt}&refresh_token=r&expires_in=3600&token_type=bearer`,
    { waitUntil: 'domcontentloaded', timeout: 60000 }
  )
  await page.waitForTimeout(2500)

  const showsLogin = await page.evaluate(
    () => !!document.querySelector('a[href="/login"], a[href^="/login?"]')
  )
  record(
    `${label}:OAuth 回调进行中不显示「登录」`,
    !showsLogin,
    showsLogin ? '正在换 session 却显示「登录」—— 在用户正登录时说他没登录' : '显示 loading 骨架,没有断言未登录'
  )
  await ctx.close()
}

// ── 7 & 8. 微信 WebView 降级 / 普通浏览器对照组 ────────────────────────────
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
