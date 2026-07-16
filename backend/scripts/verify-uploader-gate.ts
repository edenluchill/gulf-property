/**
 * requireUploader 回归验证 —— 把**每一个真实用户**在「旧逻辑」和「新 canManageProjects」
 * 下的结果逐个对照,证明这次收紧鉴权**没有锁死任何人**。
 *
 * 为什么要有它:admin-tasks 的鉴权从可伪造的 `x-admin: true` 头换成真 Supabase bearer +
 * requireUploader,这是必要的安全修复(旧版任何人加个 header 就能删改任务)。但收紧鉴权
 * 最容易顺手把合法用户一起关在门外 —— 实测 role='developer' 有 16 人、**全部**不在
 * upload_permissions(白名单只有 1 人),判据少一条就是 16 个试用中的开发商当场瘫痪。
 *
 * 读代码看不出这个,只有跑真实数据才看得见。
 *
 * 用法: cd backend && npx ts-node -T scripts/verify-uploader-gate.ts
 */
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(__dirname, '../.env') })
import pool from '../src/db/pool'
import { canManageProjects } from '../src/middleware/requireUploader'
import { isAdminEmail } from '../src/lib/adminEmails'
import { isOwnerEmail } from '../src/middleware/requireOwner'

/** 收紧之前的判据(从 git 历史里的 canUpload 抄来),作为对照组。 */
async function legacyCanUpload(email: string): Promise<boolean> {
  const e = (email || '').toLowerCase().trim()
  if (!e) return false
  if (isAdminEmail(e) || isOwnerEmail(e)) return true
  const { rows } = await pool.query(`SELECT 1 FROM upload_permissions WHERE lower(email) = $1`, [e])
  if (rows.length > 0) return true
  const dev = await pool.query(
    `SELECT 1
       FROM user_profiles up
       JOIN lt_agents la ON lower(la.email) = $1
       JOIN lt_subscriptions s
         ON s.agent_id = COALESCE(la.billing_agent_id, la.id)
        AND s.status IN ('active','trialing')
        AND (s.source <> 'free_trial' OR s.current_period_end > now())
      WHERE lower(up.email) = $1 AND up.role = 'developer'
      LIMIT 1`,
    [e]
  )
  return dev.rows.length > 0
}

async function main() {
  const { rows } = await pool.query<{ email: string; role: string }>(
    `SELECT DISTINCT lower(email) AS email, role FROM user_profiles WHERE email IS NOT NULL
     UNION
     SELECT DISTINCT lower(email) AS email, 'lt_agent' AS role FROM lt_agents WHERE email IS NOT NULL`
  )
  console.log(`对照 ${rows.length} 个真实账号 —— 旧逻辑 vs 新 canManageProjects\n`)

  const lockedOut: string[] = []   // 旧能、新不能 = 被锁死(绝不允许)
  const newlyOpened: string[] = [] // 旧不能、新能 = 越权放行(同样不允许)
  let allowed = 0

  for (const r of rows) {
    const [oldV, newV] = await Promise.all([legacyCanUpload(r.email), canManageProjects(r.email)])
    if (oldV) allowed++
    if (oldV && !newV) lockedOut.push(`${r.email} (${r.role})`)
    if (!oldV && newV) newlyOpened.push(`${r.email} (${r.role})`)
  }

  console.log(`  旧逻辑放行: ${allowed} 人`)
  console.log(`  🔴 被锁死  : ${lockedOut.length} 人`)
  lockedOut.forEach((e) => console.log(`       ${e}`))
  console.log(`  🔴 越权放行: ${newlyOpened.length} 人`)
  newlyOpened.forEach((e) => console.log(`       ${e}`))

  const ok = lockedOut.length === 0 && newlyOpened.length === 0
  console.log(ok
    ? '\n✅ 权限集合完全一致 —— 只换了「怎么证明你是你」(伪造头 → 真 bearer),没换「谁可以」。'
    : '\n❌ 权限集合变了。收紧鉴权不该顺带改变谁有权限 —— 先修上面这些人。')
  await pool.end()
  process.exit(ok ? 0 : 1)
}
main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1) })
