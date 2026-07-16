/**
 * 经纪准入审批 API。
 *  - GET  /api/agents/me            (requireAuth) 登录经纪查自己的状态;首次访问自动建 pending。
 *  - GET  /api/agents               (requireOwner) 所有者列出全部经纪(pending 置顶)。
 *  - POST /api/agents/:email/approve|reject (requireOwner) 一键批准/拒绝。
 *
 * OWNER_EMAILS 永远视为 approved(不会把所有者锁在外面)。服务端硬 enforce。
 */
import { Router, Request, Response } from 'express'
import pool from '../db/pool'
import { requireAuth, optionalAuth } from '../middleware/auth'
import { requireOwner, isOwnerEmail } from '../middleware/requireOwner'
import { canManageProjects } from '../middleware/requireUploader'
import { ensureAgent } from '../luna-tour/session-builder'
import { grantOneTimeTrial, revokeGrant } from '../services/adminGrant'

const router = Router()

// 登录经纪查自己状态;首次自动登记为 pending
router.get('/me', requireAuth, async (req: Request, res: Response) => {
  const email = (req.user?.email || '').toLowerCase().trim()
  if (!email) return res.json({ status: 'none' })
  if (isOwnerEmail(email)) return res.json({ status: 'approved', owner: true })
  try {
    const { rows } = await pool.query(
      `INSERT INTO agents (email, user_id, name, status)
       VALUES ($1, $2, $3, 'pending')
       ON CONFLICT (email) DO UPDATE SET user_id = COALESCE(agents.user_id, EXCLUDED.user_id)
       RETURNING status`,
      [email, req.user?.id ?? null, (req.user?.user_metadata?.name as string) ?? null]
    )
    let status = rows[0]?.status ?? 'pending'
    // 付费即准入,团队成员同理:本人或所在团队有生效订阅 → 自动 approve。
    // (原来被邀请的成员会卡在"审核中"门外——订阅在团队上,webhook 只 approve 付款人)
    if (status !== 'approved') {
      const sub = await pool.query(
        `SELECT 1 FROM lt_agents la
           JOIN lt_subscriptions s
             ON s.agent_id = COALESCE(la.billing_agent_id, la.id)
            AND s.status IN ('active','trialing')
          WHERE lower(la.email) = $1 LIMIT 1`,
        [email]
      )
      if (sub.rows.length > 0) {
        await pool.query(
          `UPDATE agents SET status = 'approved', decided_at = now(), decided_by = 'auto:subscription' WHERE email = $1`,
          [email]
        )
        status = 'approved'
      }
    }
    res.json({ status })
  } catch (err) {
    console.error('[agents] /me failed:', err)
    res.status(500).json({ status: 'error' })
  }
})

// ── 所有者:列表 + 批准/拒绝 ──────────────────────────
router.get('/', optionalAuth, requireOwner, async (_req: Request, res: Response) => {
  try {
    // 关联 lt_agents(按 email)+ 当前生效订阅 + 本月用量,给后台展示套餐/用量。
    const { rows } = await pool.query(
      `SELECT a.id, a.email, a.name, a.status, a.requested_at, a.decided_at,
              COALESCE(s.plan_id, 'explore')      AS plan_id,
              COALESCE(s.status, 'none')          AS sub_status,
              (s.stripe_subscription_id IS NOT NULL) AS paid,
              s.current_period_end,
              COALESCE((p.limits->>'credits_month')::int, 0) AS credits_month,
              COALESCE(u.credits_used, 0)         AS credits_used
         FROM agents a
         LEFT JOIN lt_agents la ON la.email = a.email
         LEFT JOIN LATERAL (
           SELECT plan_id, status, stripe_subscription_id, current_period_end
             FROM lt_subscriptions
            WHERE agent_id = la.id AND status IN ('active','trialing')
            ORDER BY created_at DESC LIMIT 1
         ) s ON true
         LEFT JOIN lt_subscription_plans p ON p.id = COALESCE(s.plan_id, 'explore')
         LEFT JOIN lt_usage_counters u
           ON u.agent_id = la.id AND u.period_month = date_trunc('month', now())::date
        ORDER BY (a.status = 'pending') DESC, a.requested_at DESC`
    )
    res.json({ success: true, agents: rows })
  } catch (err) {
    console.error('[agents] list failed:', err)
    res.status(500).json({ success: false })
  }
})

/**
 * 所有者手动授予/撤销。body { action: 'grant_trial' | 'revoke' }
 *
 * ⚠️ 2026-07-13 改造:**不再能授予永久套餐**。
 * 旧行为是插一条 100 年期的 comp 行,而 100 年 comp **没有任何过期清理**
 * (freeTrialSweep 和 credits/mapMeter 的即时过期谓词都只认 source='free_trial')
 * → 发出去就是永久免费,而且同一个人能反复发,操作人只存在 reason 字符串里。
 *
 * 新行为:每人**只能授予一次**、固定 30 天、走 free_trial 行 → 到期由 sweep 自动
 * 翻 canceled。谁发的/什么时候发的落到 lt_agents.trial_granted_at/by 列上。
 * 存量永久 comp 行(自己人)不动 —— 他们有生效订阅,这里会直接拒绝重复授予。
 */
router.post('/:email/plan', optionalAuth, requireOwner, async (req: Request, res: Response) => {
  const email = decodeURIComponent(req.params.email || '').toLowerCase().trim()
  // 兼容旧前端:老版本传 { plan: 'agent' } 之类 —— 一律当作 grant_trial 处理,
  // 绝不再按 plan 发永久套餐。
  const action = String(req.body?.action || (req.body?.plan === 'revoke' ? 'revoke' : 'grant_trial'))
  const actor = (req.user?.email as string) || 'owner'
  if (!email) return res.status(400).json({ success: false, error: 'email required' })
  if (!['grant_trial', 'revoke'].includes(action)) {
    return res.status(400).json({ success: false, error: 'invalid action' })
  }

  try {
    const nameRow = await pool.query<{ name: string | null }>(`SELECT name FROM agents WHERE email = $1`, [email])
    const agentId = await ensureAgent({
      email,
      displayName: nameRow.rows[0]?.name || email.split('@')[0],
    })

    if (action === 'revoke') {
      await revokeGrant(agentId, email, actor)
      return res.json({ success: true })
    }

    const r = await grantOneTimeTrial(agentId, email, actor)
    if (!r.ok) {
      return res.status(409).json({
        success: false, error: r.code, grantedAt: r.grantedAt, grantedBy: r.grantedBy,
      })
    }
    res.json({ success: true, days: r.days, credits: r.credits })
  } catch (err) {
    console.error('[agents] grant/revoke failed:', err)
    res.status(500).json({ success: false })
  }
})

async function decide(req: Request, res: Response, status: 'approved' | 'rejected') {
  const email = decodeURIComponent(req.params.email || '').toLowerCase().trim()
  if (!email) return res.status(400).json({ success: false })
  try {
    await pool.query(
      `UPDATE agents SET status = $2, decided_at = now(), decided_by = $3 WHERE email = $1`,
      [email, status, (req.user?.email as string) ?? 'owner']
    )
    res.json({ success: true })
  } catch (err) {
    console.error('[agents] decide failed:', err)
    res.status(500).json({ success: false })
  }
}

router.post('/:email/approve', optionalAuth, requireOwner, (req, res) => decide(req, res, 'approved'))
router.post('/:email/reject', optionalAuth, requireOwner, (req, res) => decide(req, res, 'rejected'))

// ── 楼书上传权限(uploader)────────────────────────────────────────────────
// 单独授权某个 email 能用「上传楼书 / 任务审核 / 项目管理」,但看不到
// telemetry/分析后台(那些仍是 admin/owner)。admin 隐含拥有上传权限。

/** 登录用户查自己有没有上传权限(前端 AuthContext / ProtectedRoute requireUploader 用)。
 *  与服务端强制门 requireUploader **同一真相源**(都走 canManageProjects):
 *  admin/owner | upload_permissions 白名单 | role=developer + 生效订阅。
 *  这两侧的判据必须永远一致 —— 不一致 = 前端放行、后端 403,用户点了按钮就报错。 */
router.get('/can-upload', requireAuth, async (req: Request, res: Response) => {
  const email = (req.user?.email || req.ctx?.email || '').toLowerCase().trim()
  res.json({ canUpload: await canManageProjects(email) })
})

router.get('/upload-permissions', optionalAuth, requireOwner, async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT email, granted_by, created_at FROM upload_permissions ORDER BY created_at DESC`
    )
    res.json({ success: true, permissions: rows })
  } catch (err) {
    console.error('[agents] list upload-permissions failed:', err)
    res.status(500).json({ success: false })
  }
})

router.post('/upload-permissions', optionalAuth, requireOwner, async (req: Request, res: Response) => {
  const email = String(req.body?.email || '').toLowerCase().trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ success: false, error: 'invalid email' })
  }
  try {
    await pool.query(
      `INSERT INTO upload_permissions (email, granted_by) VALUES ($1, $2)
       ON CONFLICT (email) DO NOTHING`,
      [email, (req.user?.email as string) || 'owner']
    )
    res.json({ success: true })
  } catch (err) {
    console.error('[agents] grant upload failed:', err)
    res.status(500).json({ success: false })
  }
})

router.delete('/upload-permissions/:email', optionalAuth, requireOwner, async (req: Request, res: Response) => {
  const email = decodeURIComponent(req.params.email || '').toLowerCase().trim()
  if (!email) return res.status(400).json({ success: false })
  try {
    await pool.query(`DELETE FROM upload_permissions WHERE email = $1`, [email])
    res.json({ success: true })
  } catch (err) {
    console.error('[agents] revoke upload failed:', err)
    res.status(500).json({ success: false })
  }
})

export default router
