/**
 * 用户角色(type)—— 登录后一次性选择:买家(免费)或经纪(付费)。
 * 设计稿: docs/map-metering-and-tiered-pricing-plan-2026-07-03.md
 *
 *   GET  /api/me/profile → { role: 'buyer'|'agent'|null, roleChosenAt }  [requireAuth]
 *   POST /api/me/profile { role } → 写入/更新角色                        [requireAuth]
 *
 * 买家→经纪 promote 就是再 POST 一次 role='agent'(历史收藏/行为保留);
 * 经纪付费与审批仍走 billing/agents 既有流程,这里只记 type。
 */
import { Router, Request, Response } from 'express'
import pool from '../db/pool'
import { requireAuth } from '../middleware/auth'
import { clearAgentGate } from '../middleware/mapMeter'

const router = Router()

function currentUser(req: Request): { id: string; email: string | null } | null {
  const id = req.user?.id || req.ctx?.userId
  if (!id) return null
  return { id, email: (req.user?.email || req.ctx?.email || '').toLowerCase() || null }
}

router.get('/profile', requireAuth, async (req: Request, res: Response) => {
  const u = currentUser(req)
  if (!u) return res.status(401).json({ success: false, error: 'Auth required' })
  try {
    const { rows } = await pool.query<{ role: string | null; role_chosen_at: Date | null }>(
      `SELECT role, role_chosen_at FROM user_profiles WHERE user_id = $1`,
      [u.id]
    )
    res.json({ success: true, role: rows[0]?.role || null, roleChosenAt: rows[0]?.role_chosen_at || null })
  } catch (err) {
    console.error('[profile] GET failed:', err)
    res.status(500).json({ success: false })
  }
})

router.post('/profile', requireAuth, async (req: Request, res: Response) => {
  const u = currentUser(req)
  if (!u) return res.status(401).json({ success: false, error: 'Auth required' })
  const role = String(req.body?.role || '')
  // 四角色(2026-07-05):买家免费;agent/agency/developer 必须订阅(mapMeter 硬门禁)
  if (!['buyer', 'agent', 'agency', 'developer'].includes(role)) {
    return res.status(400).json({ success: false, error: 'invalid role' })
  }
  try {
    await pool.query(
      `INSERT INTO user_profiles (user_id, email, role, role_chosen_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (user_id) DO UPDATE
         SET role = EXCLUDED.role,
             email = COALESCE(EXCLUDED.email, user_profiles.email),
             role_chosen_at = now(),
             updated_at = now()`,
      [u.id, u.email, role]
    )
    clearAgentGate(u.id) // 角色变了 → 地图计量门立即按新角色判定
    res.json({ success: true, role })
  } catch (err) {
    console.error('[profile] POST failed:', err)
    res.status(500).json({ success: false })
  }
})

export default router
