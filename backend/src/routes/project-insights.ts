/**
 * Project insights endpoint — investment + location intelligence for the detail
 * page. Isolated thin router (mounted alongside the residential-projects router);
 * delete this file + its mount line to remove. See projectInsights.ts.
 *
 *   GET /api/residential-projects/:id/insights
 */
import { Router, Request, Response } from 'express'
import pool from '../db/pool'
import { getProjectInsights, getProjectTransactions, getNearbyCompare, refreshProjectInsightsCache } from '../services/projectInsights'
import { beginMaintenance, endMaintenance, yieldToLiveTraffic } from '../services/perfSink'

const router = Router()

// 非法 id(前端传了 `undefined`)直接进 `WHERE id = $1` → Postgres uuid 转型报错
// → catch 成 500。2026-07-11 给 residential-projects 主路由加过同样的守卫,但
// **这个 router 是单独挂载的**(index.ts,且挂在主路由之前),漏了 —— 2026-08-09
// 事故 #704 就是这么来的:7 条 500 全是 /api/residential-projects/undefined/insights。
// 加守卫的地方必须是每个 router 自己,`router.param` 不跨 router 生效。
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
router.param('id', (_req: Request, res: Response, next, id: string) => {
  if (!UUID_RE.test(id)) {
    res.status(404).json({ success: false, error: 'project not found' })
    return
  }
  next()
})

// ── 全项目预热:构建一次 ~8.5s(DLD 聚合),但项目只有 ~21 个 ────────────────
// 启动 45s 后跑一轮,之后每 6h 强刷(TTL 7h,热度无缝)。用户请求从此永远打热
// 缓存(2026-07-07 前该端点 avg 7.8s / p95 15s,是 HIGH_LATENCY 报警主源)。
// 放在 route 文件而不是 service:worker 进程 import 服务时不会误启动定时器。
let warmingProjects = false
async function warmAllProjectInsights() {
  if (warmingProjects) return
  warmingProjects = true
  beginMaintenance() // 预热慢查询不进 SLOW_QUERIES 报警(见 perfSink)
  try {
    const r = await pool.query(`SELECT id FROM residential_projects`)
    let ok = 0
    for (const row of r.rows) {
      // 有真人在飞就等他先走完。250ms 的 sleep 只管**节奏**不管**优先级** ——
      // 预热的每一项都是打 DLD 大表的重聚合,照样能把 DB 的 CPU 占住,
      // 让一个没命中缓存的客户排队等 7.6 秒(2026-07-14 05:17 实际发生过)。
      // 预热没有 deadline,客户有。
      await yieldToLiveTraffic()
      try {
        await refreshProjectInsightsCache(String(row.id))
        ok++
      } catch { /* 单项目失败不影响整轮 */ }
      await new Promise(resolve => setTimeout(resolve, 250)) // 让出 DB
    }
    console.log(`[project-insights] warmed ${ok}/${r.rows.length}`)
  } catch (e) {
    console.error('[project-insights] warm failed:', e)
  } finally {
    warmingProjects = false
    endMaintenance()
  }
}
setTimeout(warmAllProjectInsights, 45_000)
setInterval(warmAllProjectInsights, 6 * 60 * 60 * 1000)

router.get('/:id/insights', async (req: Request, res: Response) => {
  try {
    const insights = await getProjectInsights(String(req.params.id))
    if (!insights) return res.status(404).json({ success: false, error: 'project not found' })
    res.set('Cache-Control', 'public, max-age=3600')
    res.json({ success: true, data: insights })
  } catch (err) {
    console.error('[project-insights] error:', err)
    res.status(500).json({ success: false, error: 'failed to build insights' })
  }
})

// 本盘 + 最近同类项目横评(对比分析 tab)。
router.get('/:id/nearby-compare', async (req: Request, res: Response) => {
  try {
    const data = await getNearbyCompare(String(req.params.id))
    if (!data) return res.status(404).json({ success: false, error: 'project not found' })
    res.set('Cache-Control', 'public, max-age=3600')
    res.json({ success: true, data })
  } catch (err) {
    console.error('[project-insights] nearby-compare error:', err)
    res.status(500).json({ success: false, error: 'failed to build comparison' })
  }
})

// Real DLD transactions for this project's matched development.
router.get('/:id/transactions', async (req: Request, res: Response) => {
  try {
    const data = await getProjectTransactions(String(req.params.id))
    if (!data) return res.status(404).json({ success: false, error: 'project not found' })
    res.set('Cache-Control', 'public, max-age=3600')
    res.json({ success: true, data })
  } catch (err) {
    console.error('[project-insights] transactions error:', err)
    res.status(500).json({ success: false, error: 'failed to load transactions' })
  }
})

export default router
