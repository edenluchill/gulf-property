/**
 * 多设备共用一个账号 —— 真 Supabase 端到端验证。
 *
 * 回答一个具体问题:**在设备 A 上退出,设备 B 的 session 会不会跟着死?**
 *
 * 这曾经是"每天都要重登"的真凶:`signOut()` 默认 `scope:'global'`,会吊销该账号在
 * **所有设备**上的 refresh token。埋点实测 20 次自动登出里 14 次是这么来的。
 * 前端已改成 `scope:'local'`,这个脚本用真 Supabase 把它钉死,防止将来有人改回去。
 *
 * 跑法: cd backend && npx ts-node scripts/auth-multidevice-check.ts
 * 退出码 0 = 多设备共存正常;1 = 有设备被误杀
 */
import 'dotenv/config'
import dotenv from 'dotenv'
import path from 'path'
import { createClient } from '@supabase/supabase-js'

// anon key 只配在前端(VITE_SUPABASE_ANON_KEY)。要模拟"真实用户在两台设备上登录",
// 必须用 anon key —— service key 拿到的不是用户 session,测不出连坐。
dotenv.config({ path: path.resolve(__dirname, '../../frontend/.env') })

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('缺 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY(backend/.env)')
  process.exit(1)
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

/** 一台"设备" = 一个独立的 auth client(不共享存储,就像两台真机)。 */
function device(name: string) {
  const key = ANON_KEY || SERVICE_KEY!
  const client = createClient(SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return { name, client }
}

const EMAIL = `multidevice-check@pinzos.test`
const PASSWORD = `Md-${Math.abs(hashCode(EMAIL))}-checK!`

function hashCode(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return h
}

async function main() {
  if (!ANON_KEY) {
    console.error('缺 SUPABASE_ANON_KEY —— 用 service key 登录拿不到真实的用户 session,测不了。')
    console.error('把 anon key 加进 backend/.env 的 SUPABASE_ANON_KEY 再跑。')
    process.exit(1)
  }

  console.log('─'.repeat(66))

  // 1. 准备一个干净的测试账号(每次重建,不污染真实数据)
  const { data: existing } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  const old = existing?.users?.find((u) => u.email === EMAIL)
  if (old) await admin.auth.admin.deleteUser(old.id)

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
  })
  if (createErr || !created.user) throw new Error(`建测试账号失败: ${createErr?.message}`)
  console.log(`测试账号: ${EMAIL}`)

  // 2. 同一个账号在两台"设备"上分别登录 → 两个独立 session
  const a = device('设备A (电脑)')
  const b = device('设备B (手机)')

  const signIn = async (d: ReturnType<typeof device>) => {
    const { data, error } = await d.client.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
    if (error || !data.session) throw new Error(`${d.name} 登录失败: ${error?.message}`)
    return data.session
  }

  const sessionA = await signIn(a)
  const sessionB = await signIn(b)
  console.log(`${a.name} 登录 ✓`)
  console.log(`${b.name} 登录 ✓`)
  if (sessionA.refresh_token === sessionB.refresh_token) {
    throw new Error('两台设备拿到了同一个 refresh token —— 这测不出东西,检查 client 是否共享了存储')
  }

  // 3. 设备 A 退出 —— 用前端真正在用的那个 scope
  await a.client.auth.signOut({ scope: 'local' })
  console.log(`${a.name} 退出 (scope: 'local')`)

  // 4. 关键判定:设备 B 的 refresh token 还能不能换到新 session?
  const probe = device('probe')
  const { data: refreshed, error: refreshErr } = await probe.client.auth.refreshSession({
    refresh_token: sessionB.refresh_token,
  })

  const bAlive = !!refreshed?.session && !refreshErr
  console.log('─'.repeat(66))
  console.log(`${a.name} 退出后,${b.name} 是否还活着: ${bAlive ? '是 ✓' : `否 ✗ (${refreshErr?.message})`}`)

  // 5. 对照组:证明这个测试能抓到 bug —— 用 global scope 退出,B 必须被杀掉
  const c = device('设备C')
  const sessionC = await signIn(c)
  await c.client.auth.signOut({ scope: 'global' })
  const probe2 = device('probe2')
  const { data: r2, error: e2 } = await probe2.client.auth.refreshSession({
    refresh_token: refreshed?.session?.refresh_token || sessionB.refresh_token,
  })
  const bKilledByGlobal = !r2?.session || !!e2
  console.log(
    `对照组: 有人用 scope:'global' 退出后,${b.name} 是否被杀: ` +
      `${bKilledByGlobal ? '是 ✓ (证明测试有效,也证明 global 确实会连坐)' : '否 —— 测试无效!'}`
  )
  void sessionC

  // 收尾
  await admin.auth.admin.deleteUser(created.user.id)

  console.log('─'.repeat(66))
  const pass = bAlive && bKilledByGlobal
  console.log(
    pass
      ? "PASS —— 多设备共用一个账号正常:local 退出只杀本机,global 才会连坐(所以绝不能用 global)"
      : 'FAIL —— 多设备共存有问题'
  )
  process.exit(pass ? 0 : 1)
}

main().catch((e) => {
  console.error('测试炸了:', e.message)
  process.exit(1)
})
