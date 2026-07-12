/**
 * 提醒「还没领免费试用」的老用户 (2026-07-11)。
 *
 * 产品内已经有三个入口(个人中心订阅卡 / 经纪台顶部 / 地图被锁时的引导),
 * 但那要等他们自己回来。这个脚本主动捞人 + 发邮件。
 *
 *   列名单(默认,不发信): npx ts-node --transpile-only scripts/notify-trial-eligible.ts
 *   真发信:              npx ts-node --transpile-only scripts/notify-trial-eligible.ts --send
 *
 * 资格 = 从业者角色(agent/agency/developer)+ 无生效订阅 + 没用过试用。
 * 与 /billing/me 的 trial.eligible 同一口径。
 */
import pool from '../src/db/pool'
import { sendAlertEmail, isEmailConfigured } from '../src/services/notify'

const APP_URL = process.env.APP_URL || 'https://www.pinzos.com'
const SEND = process.argv.includes('--send')

interface Row { email: string; role: string; display_name: string | null }

function body(name: string): { subject: string; text: string; html: string } {
  const subject = 'Pinzos:你还有 7 天免费试用没领(无需信用卡)'
  const text = `${name},

你的 Pinzos 账号还有 7 天免费试用没有领取 —— 不需要信用卡,到期自动停止,不会扣任何费用。

领了就能用:
· 客户 CRM(档案 / 热度评分 / 跟进管道)
· 实时海外带看 —— 和客户同屏看房,你动他也动
· Luna AI 智能导览 —— 自动飞盘讲盘,链接发客户自己看
· 品牌报告页 + Sales Offer 报价单
· 地图与 260+ 区域官方 DLD 成交/租金数据,不限时

一键领取:${APP_URL}/profile

—— Pinzos`
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;line-height:1.65;color:#0f172a">
  <p>${name},</p>
  <p>你的 Pinzos 账号还有 <b>7 天免费试用</b>没有领取 —— <b>不需要信用卡</b>,到期自动停止,不会扣任何费用。</p>
  <p>领了就能用:</p>
  <ul style="padding-left:18px">
    <li>客户 CRM(档案 / 热度评分 / 跟进管道)</li>
    <li><b>实时海外带看</b> —— 和客户同屏看房,你动他也动</li>
    <li><b>Luna AI 智能导览</b> —— 自动飞盘讲盘,链接发客户自己看</li>
    <li>品牌报告页 + Sales Offer 报价单</li>
    <li>地图与 260+ 区域官方 DLD 成交/租金数据,不限时</li>
  </ul>
  <p style="margin:24px 0">
    <a href="${APP_URL}/profile" style="background:#059669;color:#fff;padding:11px 20px;border-radius:10px;text-decoration:none;font-weight:600;display:inline-block">一键领取 7 天免费试用 →</a>
  </p>
  <p style="color:#64748b;font-size:13px">—— Pinzos</p>
</div>`
  return { subject, text, html }
}

async function main() {
  const { rows } = await pool.query<Row>(
    `SELECT up.email, up.role, a.display_name
       FROM user_profiles up
       JOIN lt_agents a ON lower(a.email) = lower(up.email)
      WHERE up.role IN ('agent','agency','developer')
        AND a.free_trial_started_at IS NULL           -- 没用过试用
        AND NOT EXISTS (                              -- 没有任何生效订阅
          SELECT 1 FROM lt_subscriptions s
           WHERE s.agent_id = COALESCE(a.billing_agent_id, a.id)
             AND s.status IN ('active','trialing')
             AND (s.source <> 'free_trial' OR s.current_period_end > now())
        )
      ORDER BY up.email`
  )

  if (!rows.length) {
    console.log('没有符合条件的用户 —— 所有从业者要么已订阅,要么已用过试用。')
    return
  }

  console.log(`符合条件(还没领试用)的用户 ${rows.length} 人:`)
  for (const r of rows) console.log(`  · ${r.email}  [${r.role}]  ${r.display_name || ''}`)

  if (!SEND) {
    console.log('\n(演练模式,没有发信。加 --send 真发。)')
    return
  }
  if (!isEmailConfigured()) {
    console.error('\n❌ RESEND_API_KEY 未配置,发不了信。')
    process.exitCode = 1
    return
  }

  let ok = 0
  for (const r of rows) {
    const name = r.display_name || r.email.split('@')[0]
    const { subject, text, html } = body(name)
    const sent = await sendAlertEmail(subject, text, html, [r.email])
    if (sent) { ok++; console.log(`  ✓ 已发 ${r.email}`) }
    else console.error(`  ✗ 发送失败 ${r.email}`)
  }
  console.log(`\n发出 ${ok}/${rows.length} 封。`)
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => pool.end())
