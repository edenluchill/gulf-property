/**
 * 每日成交速报 API —— `GET /api/market/daily-brief`
 *
 * 公开、无需登录：它的作用是给**还没注册的人**一个每天回来的理由
 * （30 天 1017 个活跃访客，注册只有 79 —— 门槛越低越好）。
 *
 * 见 `services/daily-brief.ts` 顶部：为什么做、口径是什么。
 */
import { Router } from 'express'
import { getDailyBrief } from '../services/daily-brief'

const router = Router()

router.get('/daily-brief', async (_req, res) => {
  try {
    const brief = await getDailyBrief()
    // 一天变一次的数据，让 CDN/浏览器也缓存一会儿，别每次都回源
    res.set('Cache-Control', 'public, max-age=900')
    res.json({ success: true, data: brief })
  } catch (e) {
    console.error('[DailyBrief] failed:', e)
    res.status(500).json({ success: false, error: 'brief unavailable' })
  }
})

export default router
