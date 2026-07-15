/**
 * 推荐计划 HTTP 接口 (2026-07-14) — docs/referral-program-spec.md
 *
 *   POST /api/referral/attach        → 登录后把自己钉到推荐人身上(幂等)      [requireAuth]
 *   GET  /api/referral/me            → 推广面板数据(链接/漏斗/进度/明细/奖励) [requireAuth]
 *   POST /api/referral/share-claim   → 首次分享 +7 天(一辈子一次)            [requireAuth]
 *
 * attach 走前端回传而非注册 hook:本仓库没有 Supabase auth hook / DB trigger
 * (见 spec §4)。前端在 /i/:code 落地时把 code 存 localStorage(60 天,last-click
 * 可覆盖),登录成功那一刻 POST 上来 —— 服务端只信 verified token 里的身份。
 */
import { Router, Request, Response } from 'express'
import { requireAuth } from '../middleware/auth'
import { ensureAgent } from '../luna-tour/session-builder'
import * as referral from '../services/referral'

const router = Router()
const APP_URL = process.env.APP_URL || 'https://www.pinzos.com'

/** verified token → 该用户的 lt_agents.id(没有就按 email 懒建,同 billing.currentAgent)。 */
async function currentAgentId(req: Request): Promise<{ id: string; email: string } | null> {
  const email = (req.user?.email || '').toLowerCase().trim()
  if (!email) return null
  const name = (req.user?.user_metadata?.name as string) || email.split('@')[0]
  const id = await ensureAgent({
    email,
    displayName: name,
    authUserId: req.user?.id,
    brand: { title: '置业顾问', accent: '#00E0B8' },
  })
  return { id, email }
}

/** 客户端真实 IP(风控用;经过 Cloudflare + LB,取第一跳)。 */
function clientIp(req: Request): string | null {
  const xff = (req.headers['x-forwarded-for'] as string) || ''
  const first = xff.split(',')[0].trim()
  return first || req.socket.remoteAddress || null
}

// ── POST /attach ────────────────────────────────────────────────────────
router.post('/attach', requireAuth, async (req: Request, res: Response) => {
  const agent = await currentAgentId(req)
  if (!agent) return res.status(401).json({ success: false, error: 'Auth required' })

  const code = String(req.body?.code || '').trim()
  if (!code) return res.status(400).json({ success: false, error: 'Missing code' })

  try {
    const r = await referral.attach({
      code,
      refereeAgentId: agent.id,
      refereeUserId: req.user?.id || null,
      refereeEmail: agent.email,
      ip: clientIp(req),
    })
    // 幂等语义:重复/已归因/自荐都回 200,前端据 code 决定要不要清掉 localStorage。
    // 只有 bad_code 之外的「已处理」情况都算"这条 referral 已尘埃落定,别再重试"。
    res.json({ success: r.ok, code: r.code || null })
  } catch (err) {
    console.error('[referral] attach failed:', err)
    res.status(500).json({ success: false, error: 'attach failed' })
  }
})

// ── GET /me ─────────────────────────────────────────────────────────────
router.get('/me', requireAuth, async (req: Request, res: Response) => {
  const agent = await currentAgentId(req)
  if (!agent) return res.status(401).json({ success: false, error: 'Auth required' })
  try {
    const stats = await referral.getStats(agent.id, APP_URL)
    const shareClaimed = await referral.shareRewardClaimed(agent.id)
    res.json({
      success: true, ...stats,
      shareRewardClaimed: shareClaimed,
      shareRewardDays: referral.SHARE_REWARD_DAYS,
      shareRewardCredits: referral.SHARE_REWARD_CREDITS,
    })
  } catch (err) {
    console.error('[referral] /me failed:', err)
    res.status(500).json({ success: false, error: 'stats failed' })
  }
})

// ── POST /share-claim ───────────────────────────────────────────────────
router.post('/share-claim', requireAuth, async (req: Request, res: Response) => {
  const agent = await currentAgentId(req)
  if (!agent) return res.status(401).json({ success: false, error: 'Auth required' })
  try {
    const r = await referral.claimShareReward(agent.id)
    res.json({ success: r.ok, days: r.days ?? 0, credits: r.credits ?? 0, code: r.code || null, extendedTo: r.extendedTo || null })
  } catch (err) {
    console.error('[referral] share-claim failed:', err)
    res.status(500).json({ success: false, error: 'claim failed' })
  }
})

export default router
