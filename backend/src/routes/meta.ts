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

/**
 * GET /data-freshness — 数据截止到哪天 + 源头最后发布时间。
 *
 * WHY(2026-07-14):DLD 停发 6 天,页面上只是"最新一条停在 07-07",看起来像**我们坏了**
 * —— owner 就是这么以为的。把截止日标在页面上,断更就变成一句「数据截至 X 日」的事实。
 *
 * ⚠️ 必须挂在 /api/meta 而不是 /api/market:**`/api/market` 整个前缀挂了 mapMeter**
 * (匿名地图 10min/天),放那儿会让这个接口烧地图额度、并对额度耗尽的匿名访客 429。
 * 而匿名访客恰恰是最会把"数据停更"当成"网站坏了"的人。元信息就该在元信息路由里。
 *
 * 口径:instance_date = 成交日;load_timestamp = **源 API 自带的发布时间**(不是入库时间)。
 * rent 不能用 start_date —— 那是起租日,**可以是未来**,拿它判断新鲜度必然误判。
 * 见 [[dld-freshness-load-timestamp]]。
 */
let freshCache: { data: unknown; at: number } | null = null

router.get('/data-freshness', async (_req: Request, res: Response) => {
  try {
    if (freshCache && Date.now() - freshCache.at < 15 * 60_000) {
      return res.json(freshCache.data)
    }
    const { rows } = await pool.query(
      `SELECT
         (SELECT max(instance_date)   FROM dld_transactions)   AS tx_through,
         (SELECT max(load_timestamp)  FROM dld_transactions)   AS tx_published_at,
         (SELECT max(load_timestamp)  FROM dld_rent_contracts) AS rent_published_at`
    )
    const r = rows[0]
    const data = {
      txThrough: r?.tx_through ?? null,
      txPublishedAt: r?.tx_published_at ?? null,
      rentPublishedAt: r?.rent_published_at ?? null,
    }
    freshCache = { data, at: Date.now() }
    res.set('Cache-Control', 'public, max-age=1800') // 半小时;这是「天」级的事实
    res.json(data)
  } catch (err) {
    console.error('[meta/data-freshness] error:', err)
    res.status(500).json({ error: 'internal error' })
  }
})

export default router
