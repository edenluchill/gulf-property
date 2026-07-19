/**
 * 路网测距 —— 自建 OSRM 代理。
 *
 * 为什么自建：参考站点直接打 `router.project-osrm.org`(OSRM 官方 demo 服务器)，
 * 而那台机器的 ToS **明确禁止生产/批量使用**。自建零边际成本、无限流、无 ToS 风险。
 * 数据：Geofabrik gcc-states 裁剪到迪拜周边 bbox(54.5,24.5,56.2,25.9)，
 * MLD 算法，容器跑在 API 机上、只监听 docker 内网(不对公网暴露)。
 *
 * 口径：
 *   · duration ×1.15 —— OSRM 给的是自由流时间，迪拜实际路况普遍更慢。
 *     前端还会另外提示「高峰期再加 30-50%」。
 *   · OSRM 挂了/超时 → 回落**直线 ×1.35 绕行系数 + 50km/h**，并如实标 `mode:'estimate'`。
 *     绝不假装是实测路线 —— 前端据此把线画成虚线、文案标「估算」。
 *
 * 缓存：路网不会变，同一对坐标永久缓存(进程内)。测距点是用户手点的任意坐标，
 * 所以按 4 位小数(≈11m)归一化做 key，提高命中率。
 */
import { Router, Request, Response } from 'express'
import { clientIp } from '../middleware/rateLimit'

const router = Router()

const OSRM_URL = process.env.OSRM_URL || 'http://osrm:5000'
const TIMEOUT_MS = 3500
const DETOUR_FACTOR = 1.35   // 直线 → 估算路程
const FALLBACK_KMH = 50
const TRAFFIC_FACTOR = 1.15  // OSRM 自由流 → 常态路况

type Mode = 'road' | 'estimate'
interface RouteResult {
  mode: Mode
  distanceKm: number
  durationMin: number
  geometry: { type: 'LineString'; coordinates: [number, number][] } | null
}

function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b[1] - a[1])
  const dLng = toRad(b[0] - a[0])
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

function estimate(a: [number, number], b: [number, number]): RouteResult {
  const km = haversineKm(a, b) * DETOUR_FACTOR
  return {
    mode: 'estimate',
    distanceKm: Number(km.toFixed(2)),
    durationMin: Number(((km / FALLBACK_KMH) * 60).toFixed(1)),
    geometry: null,   // null = 前端画虚直线,视觉上就和实测路线区分开
  }
}

// 永久缓存(路网不变)。加个上限防内存无界增长 —— key 由用户点击坐标决定,
// 不设上限就是个由访客控制 key 的泄漏。
const cache = new Map<string, RouteResult>()
const CACHE_MAX = 5000
const q4 = (n: number) => Math.round(n * 1e4) / 1e4

function parsePoint(raw: unknown): [number, number] | null {
  if (typeof raw !== 'string') return null
  const parts = raw.split(',')
  if (parts.length !== 2) return null
  const lat = Number(parts[0]), lng = Number(parts[1])
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  return [q4(lng), q4(lat)]   // OSRM 用 lng,lat
}

// 轻量 per-IP 限流:测距是手点的,正常人一分钟点不了几十次。
const hits = new Map<string, { n: number; until: number }>()
const LIMIT = 60, WINDOW_MS = 60_000
function overLimit(ip: string): boolean {
  const now = Date.now()
  const cur = hits.get(ip)
  if (!cur || now > cur.until) { hits.set(ip, { n: 1, until: now + WINDOW_MS }); return false }
  cur.n += 1
  return cur.n > LIMIT
}
setInterval(() => {
  const now = Date.now()
  for (const [k, v] of hits) if (now > v.until) hits.delete(k)
}, WINDOW_MS).unref()

/**
 * GET /api/routing/route?a=<lat,lng>&b=<lat,lng>
 * 恒返回 200 —— OSRM 不可用时给估算值并标 mode:'estimate'，测距工具永远有结果可显示。
 */
router.get('/route', async (req: Request, res: Response) => {
  const a = parsePoint(req.query.a)
  const b = parsePoint(req.query.b)
  if (!a || !b) return res.status(400).json({ error: 'bad coordinates' })

  if (overLimit(clientIp(req))) {
    res.set('Retry-After', '60')
    return res.status(429).json({ error: 'too many requests' })
  }

  const key = `${a[0]},${a[1]};${b[0]},${b[1]}`
  const hit = cache.get(key)
  if (hit) {
    res.set('Cache-Control', 'public, max-age=86400')
    return res.json({ ...hit, cached: true })
  }

  let result: RouteResult
  try {
    const url = `${OSRM_URL}/route/v1/driving/${a[0]},${a[1]};${b[0]},${b[1]}?overview=full&geometries=geojson`
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
    const r = await fetch(url, { signal: ctl.signal })
    clearTimeout(timer)
    const j: any = await r.json()
    const rt = j?.routes?.[0]
    // ⚠️ OSRM 对**图外坐标不会报错**,它会把点吸附到图里最近的节点然后照常算。
    // 实测利雅得→吉达(都在提取范围外)被双双吸到 bbox 边角的同一个节点上,
    // 返回 code:"Ok" + distance:0 —— 用户会看到「0 公里」这种胡话。
    // 所以必须自己判:①吸附距离过大 = 这个点根本不在图里;②路网距离短于直线
    // 距离 = 物理上不可能,只可能是吸附把点挪走了。任一条命中就老实降级成估算。
    const MAX_SNAP_M = 2000
    const snapOk = Array.isArray(j?.waypoints)
      && j.waypoints.every((w: any) => typeof w?.distance !== 'number' || w.distance <= MAX_SNAP_M)
    const straightKm = haversineKm(a, b)
    const sane = rt && rt.distance / 1000 >= straightKm * 0.8

    if (j?.code === 'Ok' && rt && snapOk && sane) {
      result = {
        mode: 'road',
        distanceKm: Number((rt.distance / 1000).toFixed(2)),
        durationMin: Number(((rt.duration / 60) * TRAFFIC_FACTOR).toFixed(1)),
        geometry: rt.geometry ?? null,
      }
    } else {
      result = estimate(a, b)   // NoRoute / 图外 / 吸附失真 —— 都走估算,并如实标注
    }
  } catch {
    result = estimate(a, b)     // 超时/容器没起来 —— 降级但不报错
  }

  if (result.mode === 'road') {
    if (cache.size >= CACHE_MAX) cache.clear()   // 简单粗暴,反正重算只要几毫秒
    cache.set(key, result)
  }
  res.set('Cache-Control', 'public, max-age=86400')
  res.json(result)
})

/** GET /api/routing/health — OSRM 容器是否活着(给部署脚本/巡检用)。 */
router.get('/health', async (_req: Request, res: Response) => {
  try {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), 2000)
    // 迪拜 Marina 附近的一小段,纯探活
    const r = await fetch(
      `${OSRM_URL}/route/v1/driving/55.1385,25.0805;55.2744,25.1972?overview=false`,
      { signal: ctl.signal }
    )
    clearTimeout(timer)
    const j: any = await r.json()
    if (j?.code === 'Ok') {
      return res.json({ ok: true, distanceKm: Number((j.routes[0].distance / 1000).toFixed(1)) })
    }
    res.status(503).json({ ok: false, code: j?.code })
  } catch (e) {
    res.status(503).json({ ok: false, error: String(e).slice(0, 120) })
  }
})

export default router
