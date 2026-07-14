/**
 * Luna Tour — 区域对比（地理套利 + 诚实的短板）。
 *
 * 🔴 **投资客真正想知道的不是「这个项目涨多少」,而是「我为什么该买这里,
 *    而不是走路 5 分钟外的那个区」。**
 *    这是地图产品能做、而 PDF 楼书和视频永远做不到的事。
 *
 * 数据全在库里(PostGIS 邻接 + get_dubai_area_metrics),实测:
 *   JVC(目标)      涨 8.5%  回报 6.69%  16,084/㎡  成交 14,817 笔
 *   Arjan   0.15km 涨 13.5% 回报 6.38%  16,482/㎡  成交  3,889
 *   JVT     0.18km 涨 15.0% 回报 5.90%  17,539/㎡  成交  5,242
 *   Motor city 0.53km 涨 0.0% 回报 4.07% **20,236/㎡** 成交 4,867
 *
 *   → 0.5 公里外的 Motor City:单价贵 **26%**,涨幅 **0%**,回报只有 4.07%。
 *     **同样的地段,你多付四分之一,换来一半的回报。**
 *
 * ⚠️ **必须按成交量过滤邻居**(实测 Al Barsha South 2 只有 7 笔成交 ——
 *    拿它做对比是在用噪音说话)。
 */
import type { PoolClient } from 'pg'

export interface AreaStats {
  name: string
  distance_km: number
  growth_pct: number
  yield_pct: number
  price_sqm: number
  transactions: number
}

export interface AreaContext {
  self: AreaStats
  neighbors: AreaStats[]
  /**
   * 这个区**输在哪** —— 用来做「它的短板」那一拍。
   *
   * > **Allen 的元分析:说了缺点却不反驳它,比什么都不说更糟。**
   * 有效的机制不是「坦诚」,是**接种(inoculation)**:你在给客户打疫苗,
   * 让他**免疫下一个经纪要说的话**。所以每一条 weakness 都必须**带一条 rebuttal**,
   * 而且 rebuttal 必须是**真数据**,不是嘴硬。
   */
  weakness: { claim: string; rebuttal: string } | null
}

const MIN_TX = 500          // 成交量低于这个数的邻居是噪音,不能拿来对比
const NEIGHBOR_RADIUS_M = 3000

interface Row {
  name: string
  km: string | number
  g: string | number | null
  y: string | number | null
  p: string | number | null
  tx: string | number | null
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : 0
}

const toStats = (r: Row): AreaStats => ({
  name: r.name,
  distance_km: Number(num(r.km).toFixed(2)),
  growth_pct: num(r.g),
  yield_pct: num(r.y),
  price_sqm: Math.round(num(r.p)),
  transactions: Math.round(num(r.tx)),
})

export async function fetchAreaContext(
  client: PoolClient,
  lng: number,
  lat: number
): Promise<AreaContext | null> {
  // 项目落在哪个区
  const selfRes = await client.query<Row & { id: string }>(
    `SELECT a.id::text, a.name, 0 AS km,
            m.capital_growth_pct g, m.rental_yield_pct y,
            m.median_price_sqm p, m.transaction_count tx
       FROM dubai_areas a
       JOIN get_dubai_area_metrics(NULL,NULL,NULL) m ON m.id = a.id
      WHERE a.boundary IS NOT NULL
        AND ST_Contains(a.boundary::geometry, ST_SetSRID(ST_MakePoint($1,$2),4326))
      LIMIT 1`,
    [lng, lat]
  )
  const selfRow = selfRes.rows[0]
  if (!selfRow) return null

  const nb = await client.query<Row>(
    `SELECT a.name,
            ST_Distance(a.boundary, t.boundary)/1000 AS km,
            m.capital_growth_pct g, m.rental_yield_pct y,
            m.median_price_sqm p, m.transaction_count tx
       FROM dubai_areas t
       JOIN dubai_areas a
         ON a.id <> t.id AND a.boundary IS NOT NULL
        AND ST_DWithin(a.boundary, t.boundary, $2)
       JOIN get_dubai_area_metrics(NULL,NULL,NULL) m ON m.id = a.id
      WHERE t.id = $1::uuid
        AND m.transaction_count > $3        -- ⚠️ 成交量太低的邻居是噪音
      ORDER BY ST_Distance(a.boundary, t.boundary)
      LIMIT 5`,
    [selfRow.id, NEIGHBOR_RADIUS_M, MIN_TX]
  )

  const self = toStats(selfRow)

  /**
   * ⚠️ **自己也可能是噪音。**
   *
   * 实测:113 RESIDENCES 所在的 Al Safouh First 一年只有 **72 笔**成交。
   * 拿一个 72 笔的区去跟 Palm Jumeirah(1,263 笔)比涨幅,比出来的差距**没有意义** ——
   * 样本太小,那个百分比是随机数。
   *
   * 邻居要过成交量门槛,**目标区自己同样要过**。过不了 → 这两拍整个不讲。
   */
  if (self.transactions < MIN_TX) return null

  const neighbors = nb.rows.map(toStats)
  if (!neighbors.length) return { self, neighbors: [], weakness: null }

  return { self, neighbors, weakness: findWeakness(self, neighbors) }
}

/**
 * 找出这个区**真正输在哪**,并**立刻用真数据反驳**。
 *
 * ⚠️ 只有**能被反驳的短板**才值得说。说了缺点却反驳不了,比什么都不说更糟
 *(Allen 的元分析)。所以:找不到有力的反驳 → 返回 null → **这一拍整个不讲**。
 */
function findWeakness(self: AreaStats, neighbors: AreaStats[]): AreaContext['weakness'] {
  // ── 短板一:涨幅不是最猛的 → 用**流动性**反驳 ──
  const faster = neighbors.filter((n) => n.growth_pct > self.growth_pct + 1)
  if (faster.length) {
    const top = [...faster].sort((a, b) => b.growth_pct - a.growth_pct).slice(0, 2)
    const liquidityEdge = self.transactions / Math.max(1, Math.max(...top.map((n) => n.transactions)))
    if (liquidityEdge >= 1.8) {
      return {
        claim:
          `${self.name} 不是这一带涨得最快的。` +
          top.map((n) => `${n.name} 涨了 ${n.growth_pct}%`).join('，') +
          `，都比这里猛（这里是 ${self.growth_pct}%）。`,
        rebuttal:
          `但是 —— ${self.name} 一年成交 ${self.transactions.toLocaleString()} 笔，` +
          `是它们的 ${liquidityEdge.toFixed(1)} 倍。你想出手的时候，这里永远有人接盘。` +
          `涨得快而没人买，那个数字是纸上的。`,
      }
    }
  }

  // ── 短板二:单价不是最便宜的 → 用**回报率**反驳 ──
  const cheaper = neighbors.filter((n) => n.price_sqm > 0 && n.price_sqm < self.price_sqm * 0.92)
  if (cheaper.length && self.yield_pct > 0) {
    const best = cheaper.sort((a, b) => a.price_sqm - b.price_sqm)[0]
    if (self.yield_pct > best.yield_pct + 0.5) {
      const pricier = Math.round(((self.price_sqm - best.price_sqm) / best.price_sqm) * 100)
      return {
        claim: `${self.name} 比隔壁的 ${best.name} 贵 ${pricier}%（每平米 ${self.price_sqm.toLocaleString()} vs ${best.price_sqm.toLocaleString()}）。`,
        rebuttal:
          `但这里的租金回报是 ${self.yield_pct}%，${best.name} 只有 ${best.yield_pct}%。` +
          `贵的那部分，租金会替你还回来。`,
      }
    }
  }

  // 找不到能被真数据反驳的短板 → **不讲**。宁可少一拍,也不能说完缺点接不上话。
  return null
}

/** 喂给 prompt 的事实块。 */
export function areaContextFacts(ctx: AreaContext): string[] {
  const lines: string[] = []
  const s = ctx.self
  lines.push(
    `  area_self: ${s.name} | growth ${s.growth_pct}% | yield ${s.yield_pct}% | ` +
      `median ${s.price_sqm}/sqm | ${s.transactions} transactions/yr`
  )
  for (const n of ctx.neighbors) {
    lines.push(
      `  area_neighbor: ${n.name} (${n.distance_km}km away) | growth ${n.growth_pct}% | ` +
        `yield ${n.yield_pct}% | median ${n.price_sqm}/sqm | ${n.transactions} transactions/yr`
    )
  }
  if (ctx.weakness) {
    lines.push(`  weakness_claim: ${ctx.weakness.claim}`)
    lines.push(`  weakness_rebuttal: ${ctx.weakness.rebuttal}`)
  }
  return lines
}
