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
    // 指纹 = DLD 导入时间 + 区域/地标编辑时间：
    // 改区域名/翻译/边界/地标内容都要让客户端缓存失效
    const r = await pool.query(
      `SELECT
         (SELECT MAX(created_at) FROM dld_transactions) AS c,
         (SELECT MAX(updated_at) FROM dubai_areas) AS a,
         (SELECT MAX(updated_at) FROM dubai_landmarks) AS l`
    )
    const c = r.rows[0]?.c ? new Date(r.rows[0].c).getTime() : 0
    const a = r.rows[0]?.a ? new Date(r.rows[0].a).getTime() : 0
    const l = r.rows[0]?.l ? new Date(r.rows[0].l).getTime() : 0
    const version = `dld-${c}-a${a}-l${l}`
    cache = { v: version, at: Date.now() }
    res.json({ version })
  } catch (err) {
    console.error('[meta/data-version] error:', err)
    // 出错时返回一个稳定值，避免把缓存误清
    res.json({ version: 'unknown' })
  }
})

export default router
