/**
 * access token 到底多久过期?—— 直接从真 token 的 iat/exp 读出来,不猜。
 *
 * owner 报"过 20 分钟回来就要重登"。20 分钟这个数字很像被配短了的 JWT expiry
 * (Supabase 默认 3600s)。这个脚本给出确凿答案,顺便把 refresh 走一遍。
 *
 * 跑法: cd backend && npx ts-node scripts/auth-token-lifetime.ts
 */
import 'dotenv/config'
import dotenv from 'dotenv'
import path from 'path'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: path.resolve(__dirname, '../../frontend/.env') })

const URL = process.env.SUPABASE_URL!
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!
const ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY!

const decode = (jwt: string) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString())

async function main() {
  const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })
  const EMAIL = 'token-lifetime-check@pinzos.test'
  const PASSWORD = 'Tl-check-9f3k!'

  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  const old = list?.users?.find((u) => u.email === EMAIL)
  if (old) await admin.auth.admin.deleteUser(old.id)
  const { data: created } = await admin.auth.admin.createUser({
    email: EMAIL, password: PASSWORD, email_confirm: true,
  })

  const user = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await user.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
  if (error || !data.session) throw new Error(`登录失败: ${error?.message}`)

  const claims = decode(data.session.access_token)
  const lifetime = claims.exp - claims.iat

  console.log('─'.repeat(60))
  console.log(`access token 有效期: ${lifetime} 秒 = ${(lifetime / 60).toFixed(0)} 分钟`)
  console.log(`  (Supabase 默认 3600 秒 / 60 分钟)`)
  console.log(`session.expires_in 字段: ${data.session.expires_in}`)
  console.log('─'.repeat(60))

  // refresh token 还能不能用?(这决定"回来时能不能自动续上")
  const probe = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: r, error: rErr } = await probe.auth.refreshSession({
    refresh_token: data.session.refresh_token,
  })
  console.log(`refresh token 换新 session: ${r?.session ? '成功 ✓' : `失败 ✗ (${rErr?.message})`}`)

  if (created.user) await admin.auth.admin.deleteUser(created.user.id)

  console.log('─'.repeat(60))
  if (lifetime <= 1800) {
    console.log(`⚠️ token 有效期只有 ${(lifetime / 60).toFixed(0)} 分钟 —— 和 owner 报的"20分钟"对得上。`)
    console.log('   但这本身不该导致重登:refresh token 会自动续期。若还是被登出,问题在前端续期链路。')
  } else {
    console.log('token 有效期正常(≥30分钟),"20分钟重登"不是 JWT expiry 造成的。')
  }
}

main().catch((e) => { console.error('炸了:', e.message); process.exit(1) })
