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
import { isAdminEmail } from '../lib/adminEmails'
import { ensureAgent } from '../luna-tour/session-builder'

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
    res.json({ status: rows[0]?.status ?? 'pending' })
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

// 所有者手动授予/撤销套餐(comp,不走 Stripe)。body { plan: 'explore'|'agent'|'founder'|'revoke' }
router.post('/:email/plan', optionalAuth, requireOwner, async (req: Request, res: Response) => {
  const email = decodeURIComponent(req.params.email || '').toLowerCase().trim()
  const plan = String(req.body?.plan || '')
  if (!email) return res.status(400).json({ success: false, error: 'email required' })
  if (!['explore', 'rookie', 'agent', 'founder', 'revoke'].includes(plan)) {
    return res.status(400).json({ success: false, error: 'invalid plan' })
  }
  try {
    // 确保有 lt_agents 行(comp 挂在 lt_agents.id 上)
    const nameRow = await pool.query<{ name: string | null }>(`SELECT name FROM agents WHERE email = $1`, [email])
    const agentId = await ensureAgent({
      email,
      displayName: nameRow.rows[0]?.name || email.split('@')[0],
    })
    // 撤销/explore:取消所有"手动 comp"行(不动真实 Stripe 订阅)
    await pool.query(
      `UPDATE lt_subscriptions SET status = 'canceled', updated_at = now()
         WHERE agent_id = $1 AND stripe_subscription_id IS NULL AND status <> 'canceled'`,
      [agentId]
    )
    if (plan !== 'revoke' && plan !== 'explore') {
      // 授予:新建一条 active 的 comp 订阅(planFor 取最新生效的 → 即刻生效)
      await pool.query(
        `INSERT INTO lt_subscriptions (agent_id, plan_id, status, current_period_end)
           VALUES ($1, $2, 'active', now() + interval '100 years')`,
        [agentId, plan]
      )
    }
    // 手动 comp 也进变更审计(和 Stripe webhook 同一张表,一处看全)
    await pool.query(
      `INSERT INTO plan_change_log (agent_id, agent_email, action, to_plan, reason)
         VALUES ($1, $2, $3, $4, $5)`,
      [
        agentId, email,
        plan === 'revoke' || plan === 'explore' ? 'comp_revoked' : 'comp_granted',
        plan === 'revoke' ? 'explore' : plan,
        `manual by ${(req.user?.email as string) || 'owner'}`,
      ]
    ).catch((e) => console.error('[agents] comp audit failed:', e))
    res.json({ success: true })
  } catch (err) {
    console.error('[agents] set plan failed:', err)
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

/** 登录用户查自己有没有上传权限(前端 AuthContext 用)。 */
router.get('/can-upload', requireAuth, async (req: Request, res: Response) => {
  const email = (req.user?.email || req.ctx?.email || '').toLowerCase().trim()
  if (!email) return res.json({ canUpload: false })
  if (isAdminEmail(email) || isOwnerEmail(email)) return res.json({ canUpload: true })
  try {
    const { rows } = await pool.query(`SELECT 1 FROM upload_permissions WHERE email = $1`, [email])
    res.json({ canUpload: rows.length > 0 })
  } catch (err) {
    console.error('[agents] can-upload failed:', err)
    res.json({ canUpload: false })
  }
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
