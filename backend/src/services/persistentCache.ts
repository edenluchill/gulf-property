/**
 * 市场聚合结果的**持久**缓存 —— 补内存缓存(microCache)的一个洞:容器一重启就全没了。
 *
 * 实测(2026-07-19):/api/market/area-appreciation 冷算 12-14 秒、/area-monthly 8-11 秒,
 * 其中 9.6 秒是那条在 5.4GB 的 dld_rent_contracts 上扫 280 万行、排序 129MB 的
 * 63 个月中位租金查询。给 work_mem 加到 256MB 让排序全进内存 —— **并没有变快**
 * (8.2s → 9.3s),说明瓶颈是数据量本身不是溢出磁盘,所以调参没用,只能别再算。
 *
 * 这些结果一天才变一次(DLD 每日加载),所以重启后先端出上一次算好的、后台再重算,
 * 既快又不损失新鲜度。
 *
 * ⚠️ 刻意不写进 microCache.ts —— 那个文件的约定是**零项目依赖**(它自己注释里写着,
 * 免得缓存层的问题横向抛到别的代码路径)。这里单独一层,所有错误就地吞掉:
 * 持久缓存拿不到就退回原来的冷算,绝不能因为它挂了让接口挂掉。
 */
import pool from '../db/pool'

// 复用既有的 market_cache 表(market-perf.sql 建的,PK 是 (market,key)),只占一个新的
// 命名空间 'agg'。⚠️ 一开始我另写了 CREATE TABLE IF NOT EXISTS market_cache(...)
// 想建自己的表 —— 同名表早就存在,IF NOT EXISTS **静默什么都没做**,而我的 INSERT 引用
// 了不存在的列、又被 catch 吞掉 → 缓存永远写不进去且毫无迹象。同名 + IF NOT EXISTS
// 是个安静的陷阱,建表前先查 information_schema。
const NS = 'agg'

/** 读回上次算好的结果。任何异常(表不存在/连接问题)都返回 null,调用方照常冷算。 */
export async function readPersisted<T>(key: string): Promise<{ data: T; computedAt: Date } | null> {
  try {
    const r = await pool.query(
      `SELECT payload, updated_at FROM market_cache WHERE market = $1 AND key = $2`, [NS, key]
    )
    if (!r.rows.length) return null
    return { data: r.rows[0].payload as T, computedAt: r.rows[0].updated_at }
  } catch {
    return null
  }
}

/** 写回算好的结果。fire-and-forget —— 写失败不影响本次请求。 */
export async function writePersisted(key: string, data: unknown): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO market_cache (market, key, payload, updated_at)
       VALUES ($1, $2, $3::jsonb, now())
       ON CONFLICT (market, key) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`,
      [NS, key, JSON.stringify(data)]
    )
  } catch (err) {
    console.warn(`[persistentCache] 写入 ${key} 失败(不影响服务):`, (err as Error).message)
  }
}

/**
 * 把 loader 包一层:算完顺手落库。给预热器和 cached() 共用。
 */
export function persisting<T>(key: string, loader: () => Promise<T>): () => Promise<T> {
  return async () => {
    const data = await loader()
    void writePersisted(key, data)
    return data
  }
}
