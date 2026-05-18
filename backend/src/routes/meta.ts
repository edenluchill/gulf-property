/**
 * 元信息：数据版本指纹。
 * 前端用它做客户端缓存自动失效——每次数据导入(dld_transactions 新增行 →
 * MAX(created_at) 变化)版本就变，所有客户端下次访问自动清缓存重拉。
 * 无需每次手动 bump 前端常量。
 */
import { Router, Request, Response } from 'express'
import pool from '../db/pool'

const router = Router()

let cache: { v: string; at: number } | null = null

router.get('/data-version', async (_req: Request, res: Response) => {
  try {
    // 轻量缓存 60s，避免每次刷新都打库
    if (cache && Date.now() - cache.at < 60_000) {
      return res.json({ version: cache.v })
    }
    const r = await pool.query(
      `SELECT MAX(created_at) AS c FROM dld_transactions`
    )
    const c = r.rows[0]?.c ? new Date(r.rows[0].c).getTime() : 0
    const version = `dld-${c}`
    cache = { v: version, at: Date.now() }
    res.json({ version })
  } catch (err) {
    console.error('[meta/data-version] error:', err)
    // 出错时返回一个稳定值，避免把缓存误清
    res.json({ version: 'unknown' })
  }
})

export default router
