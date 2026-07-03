/**
 * mapMeter — 匿名地图每日限时(默认 10 分钟/天),服务端强制,前端 UI 只是体验层。
 * 设计稿: docs/map-metering-and-tiered-pricing-plan-2026-07-03.md
 *
 * 计量模型:「活跃分钟桶」。对匿名请求把"今天(迪拜时区)第 N 分钟活跃过"写进
 * anon_map_usage,visitor_id 与真实 IP 各记一份,主键去重 → 心跳与数据请求双路
 * 写入天然不重复计。用量 = max(visitor 分钟数, IP 分钟数受 3x 宽容),额度用尽后
 * 核心地图数据端点直接 429 —— 改前端计时器/屏蔽心跳/开 devtools 都拿不到数据。
 *
 * 绕过面与对应防线:
 *  - 刷新页面           → visitor_id 不变,计数继续
 *  - 清 localStorage    → IP 桶仍在(3 倍宽容防办公室 NAT 误伤)
 *  - 删 X-Visitor-Id 头 → 退化为纯 IP 计量,上限 3x 后照样拦
 *  - 伪造 Bearer token  → 仅在额度耗尽时才远程验签一次(带缓存),假 token 不放行
 *  - 伪造分享码头        → X-Share-Code 必须真实存在于分享码表(带缓存校验)
 *
 * 永不因为计量本身搞坏地图:任何 DB/内部错误 → 放行(fail-open)。
 */
import { Request, Response, NextFunction } from 'express'
import { createHash } from 'crypto'
import pool from '../db/pool'
import { clientIp } from './rateLimit'
import { supabaseAdmin, isSupabaseConfigured } from '../lib/supabase'
import { isAdminEmail } from '../lib/adminEmails'
import { isOwnerEmail } from './requireOwner'
import { internalVisitorIds } from '../services/analyticsQueries'

const LIMIT_MIN = Number(process.env.ANON_MAP_MINUTES_PER_DAY) || 10
const IP_MULTIPLIER = 3 // 共享 IP(办公室/移动网络)宽容倍数

// ── 迪拜时区的"今天/第几分钟"(UAE 无夏令时,固定 UTC+4)────────────
function dubaiNow(): { day: string; minute: number } {
  const t = new Date(Date.now() + 4 * 3600_000)
  return { day: t.toISOString().slice(0, 10), minute: t.getUTCHours() * 60 + t.getUTCMinutes() }
}

function ipKey(req: Request): string {
  const ip = clientIp(req)
  return 'ip:' + createHash('sha256').update(ip).digest('hex').slice(0, 16)
}

// ── 轻量进程内缓存(单实例部署;计量精度要求本来就是分钟级)──────────
/** 每个 identity 最近一次写库的分钟,避免同一分钟内每个请求都打 INSERT。 */
const lastRecorded = new Map<string, number>() // key → day*10000+minute
/** 用量读缓存:15s 内同一 visitor 不重复 COUNT。 */
const usageCache = new Map<string, { used: number; ipUsed: number; at: number }>()
/** 分享码校验缓存(5min)。 */
const shareCodeCache = new Map<string, { ok: boolean; at: number }>()
/** 远程 token → 用户 解析缓存(成功 5min / 失败 60s,存 hash 不存原 token)。 */
const tokenCache = new Map<string, { user: { userId: string; email: string | null } | null; at: number }>()
/** 「经纪未订阅需付费」判定缓存(60s,按 userId)。 */
const agentGateCache = new Map<string, { gated: boolean; at: number }>()

function sweep(map: Map<string, { at: number }>, ttl: number, cap = 2000): void {
  if (map.size < cap) return
  const now = Date.now()
  for (const [k, v] of map) if (now - v.at > ttl) map.delete(k)
  if (map.size >= cap) map.clear() // 极端情况下直接重置,宁可多查几次库
}

// 惰性过期清理:额度按天算,老行没用;每个进程每 24h 顺手清一次 7 天前的数据。
let lastCleanupAt = 0
function cleanupOldRows(): void {
  if (Date.now() - lastCleanupAt < 24 * 3600_000) return
  lastCleanupAt = Date.now()
  pool.query(`DELETE FROM anon_map_usage WHERE day < current_date - 7`)
    .then((r) => { if (r.rowCount) console.log(`[mapMeter] cleaned ${r.rowCount} old rows`) })
    .catch((e) => console.error('[mapMeter] cleanup failed:', e))
}

async function recordMinute(keys: string[], day: string, minute: number): Promise<void> {
  cleanupOldRows()
  const stamp = Number(day.replace(/-/g, '')) * 10_000 + minute
  const fresh = keys.filter((k) => lastRecorded.get(k) !== stamp)
  if (!fresh.length) return
  fresh.forEach((k) => lastRecorded.set(k, stamp))
  if (lastRecorded.size > 20_000) lastRecorded.clear()
  const values = fresh.map((_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`).join(',')
  await pool.query(
    `INSERT INTO anon_map_usage (identity_key, day, minute_bucket) VALUES ${values}
     ON CONFLICT DO NOTHING`,
    fresh.flatMap((k) => [k, day, minute])
  )
}

async function usedMinutes(vKey: string | null, ipK: string, day: string): Promise<{ used: number; ipUsed: number }> {
  const cacheKey = `${vKey || ipK}|${day}`
  const hit = usageCache.get(cacheKey)
  if (hit && Date.now() - hit.at < 15_000) return hit
  const keys = vKey ? [vKey, ipK] : [ipK]
  const { rows } = await pool.query<{ identity_key: string; n: string }>(
    `SELECT identity_key, count(*) AS n FROM anon_map_usage
      WHERE day = $1 AND identity_key = ANY($2::text[]) GROUP BY identity_key`,
    [day, keys]
  )
  const byKey = new Map(rows.map((r) => [r.identity_key, Number(r.n)]))
  const out = { used: vKey ? byKey.get(vKey) || 0 : byKey.get(ipK) || 0, ipUsed: byKey.get(ipK) || 0, at: Date.now() }
  usageCache.set(cacheKey, out)
  sweep(usageCache, 15_000)
  return out
}

/** X-Share-Code 真实性:必须存在于任一分享码表(报告/导览/客户报告)。 */
async function isValidShareCode(code: string): Promise<boolean> {
  if (!/^[\w-]{1,64}$/.test(code)) return false
  const hit = shareCodeCache.get(code)
  if (hit && Date.now() - hit.at < 300_000) return hit.ok
  const { rows } = await pool.query(
    `SELECT 1 FROM lt_demo_sessions WHERE share_code = $1
     UNION ALL SELECT 1 FROM lt_project_reports WHERE share_code = $1
     UNION ALL SELECT 1 FROM lt_client_reports WHERE share_code = $1
     LIMIT 1`,
    [code]
  )
  const ok = rows.length > 0
  shareCodeCache.set(code, { ok, at: Date.now() })
  sweep(shareCodeCache, 300_000)
  return ok
}

/**
 * Bearer token → 用户(远程验签,带缓存)。没配 JWT secret 时登录用户在公共端点
 * 看起来是匿名 —— 这里是唯一能认出他们的路径。伪造 token 解析为 null,不放行。
 */
async function resolveTokenUser(token: string): Promise<{ userId: string; email: string | null } | null> {
  if (!isSupabaseConfigured) return null
  const h = createHash('sha256').update(token).digest('hex').slice(0, 32)
  const hit = tokenCache.get(h)
  if (hit && Date.now() - hit.at < (hit.user ? 300_000 : 60_000)) return hit.user
  let user: { userId: string; email: string | null } | null = null
  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token)
    if (!error && data?.user) user = { userId: data.user.id, email: (data.user.email || '').toLowerCase() || null }
  } catch { /* 网络抖动 → 按匿名处理,60s 后重试 */ }
  tokenCache.set(h, { user, at: Date.now() })
  sweep(tokenCache, 300_000)
  return user
}

/**
 * 登录用户是否要被计量:role=agent 且没有任何生效订阅(自己的/团队席位的/comp)
 * → true(经纪必须选付费档才能不限时用地图)。买家/未选角色/owner/admin → false。
 */
async function agentNeedsPlan(userId: string, email: string | null): Promise<boolean> {
  if (isOwnerEmail(email) || isAdminEmail(email)) return false
  const hit = agentGateCache.get(userId)
  if (hit && Date.now() - hit.at < 60_000) return hit.gated
  let gated = false
  const r = await pool.query<{ role: string | null }>(
    `SELECT role FROM user_profiles WHERE user_id = $1`,
    [userId]
  )
  if (r.rows[0]?.role === 'agent' && email) {
    const a = await pool.query<{ id: string; billing_agent_id: string | null }>(
      `SELECT id, billing_agent_id FROM lt_agents WHERE lower(email) = $1`,
      [email]
    )
    const billingId = a.rows[0]?.billing_agent_id || a.rows[0]?.id
    if (!billingId) {
      gated = true // 选了经纪但还没走到任何订阅流程
    } else {
      const s = await pool.query(
        `SELECT 1 FROM lt_subscriptions
          WHERE agent_id = $1 AND status IN ('active','trialing') LIMIT 1`,
        [billingId]
      )
      gated = !s.rows.length
    }
  } else if (r.rows[0]?.role === 'agent' && !email) {
    gated = true
  }
  agentGateCache.set(userId, { gated, at: Date.now() })
  sweep(agentGateCache, 60_000)
  return gated
}

/** 角色/订阅变化后立刻生效(profile.ts 改角色、billing webhook 订阅生效时调)。 */
export function clearAgentGate(userId?: string | null): void {
  if (userId) agentGateCache.delete(userId)
  else agentGateCache.clear()
}

interface MeterVerdict {
  metered: boolean          // false = 豁免(买家/订阅经纪/内部/分享码)
  exhausted: boolean
  remaining: number
  requiresPlan: boolean     // true = 登录的经纪但没订阅 → 前端引导去选套餐而非登录
}

const EXEMPT: MeterVerdict = { metered: false, exhausted: false, remaining: -1, requiresPlan: false }

/**
 * 计一分钟 + 判定额度。中间件与心跳端点共用。
 *
 * 判定顺序(有意为之):
 *   分享码 → 登录身份(买家豁免 / 未订阅经纪【立即锁】)→ 内部号 → 匿名分钟额度
 * 未订阅经纪不给每日宽限 —— 选了经纪就必须选套餐(7天试用零费用),这是产品规则;
 * 且该判定在内部号豁免之前,内部浏览器上测试也能看到锁(owner/admin 按邮箱豁免)。
 */
async function meter(req: Request, opts: { record: boolean }): Promise<MeterVerdict> {
  // 0) 有效分享码(经纪拉新回路 /r /t /v /cr,访客视角)→ 豁免
  const shareCode = typeof req.headers['x-share-code'] === 'string' ? (req.headers['x-share-code'] as string) : ''
  if (shareCode && (await isValidShareCode(shareCode))) return EXEMPT

  // 1) 登录身份:本地验签的 ctx,或 Bearer 远程验签(缓存 5min,常态成本≈0)
  let userId = req.ctx?.userId || null
  let email = req.ctx?.email || null
  if (!userId && req._deferredToken) {
    const u = await resolveTokenUser(req._deferredToken)
    if (u) { userId = u.userId; email = u.email }
  }
  if (userId) {
    if (req.ctx?.isAdmin || isAdminEmail(email) || isOwnerEmail(email)) return EXEMPT
    if (!(await agentNeedsPlan(userId, email))) return EXEMPT // 买家/未选角色/已订阅经纪
    // 经纪未订阅:立即锁(不给每日额度),前端引导去 /agent/plans
    return { metered: true, exhausted: true, remaining: 0, requiresPlan: true }
  }

  const visitorId = req.ctx?.visitorId || null
  // 2) 内部测试号(匿名浏览)→ 豁免(别把自己拦在地图外)
  if (visitorId) {
    const internal = await internalVisitorIds()
    if (internal.includes(visitorId)) return EXEMPT
  }

  const { day, minute } = dubaiNow()
  const vKey = visitorId ? 'v:' + visitorId.slice(0, 100) : null
  const ipK = ipKey(req)

  if (opts.record) await recordMinute(vKey ? [vKey, ipK] : [ipK], day, minute)

  const { used, ipUsed } = await usedMinutes(vKey, ipK, day)
  const exhausted = used >= LIMIT_MIN || ipUsed >= LIMIT_MIN * IP_MULTIPLIER
  return { metered: true, exhausted, remaining: Math.max(0, LIMIT_MIN - used), requiresPlan: false }
}

/**
 * 中间件:挂在核心地图数据路由前。额度内 → 顺手记一分钟并放行;
 * 用尽 → 429 { code: 'map_quota_exhausted' },前端据此弹温和引导。
 */
export async function mapMeter(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (req.method === 'OPTIONS') return next()
  try {
    const v = await meter(req, { record: true })
    if (!v.metered || !v.exhausted) return next()
    res.status(429).json({
      success: false,
      code: 'map_quota_exhausted',
      error: v.requiresPlan
        ? '选择套餐后即可不限时使用地图(7 天免费试用)'
        : '今天的免费探索时长已用完,登录后即可免费继续使用地图',
      requiresPlan: v.requiresPlan,
      remainingMinutes: 0,
      limitMinutes: LIMIT_MIN,
    })
  } catch (err) {
    console.error('[mapMeter] fail-open:', err)
    next() // 计量出错绝不拖垮地图
  }
}

/**
 * POST /api/usage/map-heartbeat — 前端地图可见时每 30s 打一次。
 * 返回剩余分钟数,驱动 8 分钟软提示与 10 分钟 overlay。
 */
export async function mapHeartbeat(req: Request, res: Response): Promise<void> {
  try {
    const v = await meter(req, { record: true })
    if (!v.metered) {
      res.json({ success: true, unlimited: true })
      return
    }
    res.json({
      success: true,
      unlimited: false,
      remainingMinutes: v.remaining,
      limitMinutes: LIMIT_MIN,
      exhausted: v.exhausted,
      requiresPlan: v.requiresPlan,
    })
  } catch (err) {
    console.error('[mapHeartbeat] fail-open:', err)
    res.json({ success: true, unlimited: false, remainingMinutes: LIMIT_MIN, limitMinutes: LIMIT_MIN, exhausted: false, requiresPlan: false })
  }
}
