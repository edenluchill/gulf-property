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
/** 额度耗尽时的远程 token 验证缓存(5min,存 hash 不存原 token)。 */
const tokenCache = new Map<string, { ok: boolean; at: number }>()

function sweep(map: Map<string, { at: number }>, ttl: number, cap = 2000): void {
  if (map.size < cap) return
  const now = Date.now()
  for (const [k, v] of map) if (now - v.at > ttl) map.delete(k)
  if (map.size >= cap) map.clear() // 极端情况下直接重置,宁可多查几次库
}

async function recordMinute(keys: string[], day: string, minute: number): Promise<void> {
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
 * 额度耗尽时的最后一道核对:请求带了本地验不了的 Bearer(没配 JWT secret 或
 * 非 HS256)→ 远程验一次并缓存。真登录用户放行;伪造 token 不放行。
 */
async function isRealUserToken(token: string): Promise<boolean> {
  if (!isSupabaseConfigured) return false
  const h = createHash('sha256').update(token).digest('hex').slice(0, 32)
  const hit = tokenCache.get(h)
  if (hit && Date.now() - hit.at < 300_000) return hit.ok
  let ok = false
  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token)
    ok = !error && !!data?.user
  } catch {
    ok = false
  }
  tokenCache.set(h, { ok, at: Date.now() })
  sweep(tokenCache, 300_000)
  return ok
}

interface MeterVerdict {
  metered: boolean          // false = 豁免(登录/内部/分享码)
  exhausted: boolean
  remaining: number
}

/** 计一分钟 + 判定额度。中间件与心跳端点共用。 */
async function meter(req: Request, opts: { record: boolean }): Promise<MeterVerdict> {
  // 1) 登录用户(本地验签成功)→ 豁免
  if (req.ctx?.userId) return { metered: false, exhausted: false, remaining: -1 }

  const visitorId = req.ctx?.visitorId || null
  // 2) 内部测试号 → 豁免(别把自己拦在地图外)
  if (visitorId) {
    const internal = await internalVisitorIds()
    if (internal.includes(visitorId)) return { metered: false, exhausted: false, remaining: -1 }
  }
  // 3) 有效分享码(经纪拉新回路 /r /t /v /cr)→ 豁免
  const shareCode = typeof req.headers['x-share-code'] === 'string' ? (req.headers['x-share-code'] as string) : ''
  if (shareCode && (await isValidShareCode(shareCode))) {
    return { metered: false, exhausted: false, remaining: -1 }
  }

  const { day, minute } = dubaiNow()
  const vKey = visitorId ? 'v:' + visitorId.slice(0, 100) : null
  const ipK = ipKey(req)

  if (opts.record) await recordMinute(vKey ? [vKey, ipK] : [ipK], day, minute)

  const { used, ipUsed } = await usedMinutes(vKey, ipK, day)
  const exhausted = used >= LIMIT_MIN || ipUsed >= LIMIT_MIN * IP_MULTIPLIER
  if (exhausted && req._deferredToken && (await isRealUserToken(req._deferredToken))) {
    // 真登录用户,只是 token 没法本地验签 → 豁免
    return { metered: false, exhausted: false, remaining: -1 }
  }
  return { metered: true, exhausted, remaining: Math.max(0, LIMIT_MIN - used) }
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
      error: '今天的免费探索时长已用完,登录后即可免费继续使用地图',
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
    })
  } catch (err) {
    console.error('[mapHeartbeat] fail-open:', err)
    res.json({ success: true, unlimited: false, remainingMinutes: LIMIT_MIN, limitMinutes: LIMIT_MIN, exhausted: false })
  }
}
