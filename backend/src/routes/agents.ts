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
    const { rows } = await pool.query(
      `SELECT id, email, name, status, requested_at, decided_at
         FROM agents
        ORDER BY (status = 'pending') DESC, requested_at DESC`
    )
    res.json({ success: true, agents: rows })
  } catch (err) {
    console.error('[agents] list failed:', err)
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

export default router
