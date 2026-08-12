/**
 * 迪拜每日成交速报 —— **把「查询工具」变成「每天值得看一眼的东西」**。
 *
 * ## 为什么做
 *
 * 2026-08-12 owner：「我们这个项目有点像一滩死水，没有新的信息吧？」
 * 查完数据发现**恰恰相反**：
 *   · DLD 每天加载（实测最后加载在问话前一天 18:30，成交滞后 2 天）
 *   · 每天 **436–932 笔**成交、**8–18 亿迪拉姆**，其中约 2/3 是期房
 *   · 租约合同 3 天内新增 **108,660 条**
 *
 * 死的不是数据，是**形态**：我们把它做成了「查询工具」——
 * 有需求才来，一个人一年买一次房就一年来一次。
 * 而 DXBInteract 用**同一个数据源、同样 2 天滞后**做成了「每日速报」，
 * 于是成了行业每天要刷的地方。他们的 slogan 就是全部答案：
 * **"Listings are marketing. Transactions are truth."**
 *
 * ## 口径（三条都踩过坑，别改）
 *
 * 1. `trans_group = 'Sales'` —— 不加这条会把租赁/抵押算进成交，
 *    结论直接反向（memory `dld-transaction-group-trap`）
 * 2. `property_usage = 'Residential'` + `property_type IN ('Unit','Villa')`
 *    —— 否则地块/商业会把中位价拉飞
 * 3. 面积一律 sqft（memory `area-units-sqft-default`）
 *
 * 查询走 `dld_transactions_new_instance_date_idx`，实测 **0.86ms**。
 */
import pool from '../db/pool'

export interface DailyBrief {
  /** 最新有成交的那天（不是今天 —— DLD 有 ~2 天滞后） */
  date: string
  /** 距今几天 —— UI 要如实说明「这是哪天的数据」 */
  lagDays: number
  sales: {
    count: number
    totalAed: number
    medianPrice: number | null
    offplanCount: number
    offplanPct: number
  }
  /** 与上一个有成交的工作日相比 */
  vsPrev: { date: string; count: number; pct: number } | null
  topAreas: Array<{ name: string; count: number; medianPrice: number | null }>
  /** 当天最高的那笔 —— 每天都不一样，是天然的话题 */
  topSale: {
    area: string | null
    building: string | null
    project: string | null
    price: number
    rooms: string | null
    sizeSqft: number | null
    isOffplan: boolean
  } | null
  /** 租赁市场当天登记量 —— 顺带，租售两边的人都看得到自己关心的 */
  rentContracts: number
}

/** 住宅口径 —— 三处查询共用，避免各写各的然后对不上。 */
const RESIDENTIAL = `
  trans_group = 'Sales'
  AND property_usage = 'Residential'
  AND property_type IN ('Unit', 'Villa')
`

/**
 * 一天才变一次的数据，没必要每次请求都打库。
 * 30 分钟足够 —— 即使 DLD 刚加载完，晚半小时看到也无所谓。
 */
let cached: { at: number; brief: DailyBrief } | null = null
const TTL_MS = 30 * 60 * 1000

export async function getDailyBrief(force = false): Promise<DailyBrief> {
  if (!force && cached && Date.now() - cached.at < TTL_MS) return cached.brief

  // 最新有成交的那天。**不能用 now()** —— DLD 滞后，今天大概率没有数据。
  const { rows: dayRows } = await pool.query<{ d: string }>(
    `SELECT max(instance_date)::date::text d FROM dld_transactions WHERE ${RESIDENTIAL}`
  )
  const date = dayRows[0]?.d
  if (!date) throw new Error('no transactions')

  const [agg, prev, areas, top, rent] = await Promise.all([
    pool.query(
      `SELECT count(*)::int n,
              coalesce(sum(actual_worth),0)::bigint total,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY actual_worth) med,
              count(*) FILTER (WHERE is_offplan)::int offplan
       FROM dld_transactions WHERE ${RESIDENTIAL} AND instance_date = $1`,
      [date]
    ),
    // 上一个**有成交**的日子 —— 不能简单减一天，周末会是 0 导致环比永远 -100%
    pool.query(
      `SELECT instance_date::date::text d, count(*)::int n
       FROM dld_transactions WHERE ${RESIDENTIAL} AND instance_date < $1
       GROUP BY 1 ORDER BY 1 DESC LIMIT 1`,
      [date]
    ),
    pool.query(
      `SELECT area_name name, count(*)::int n,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY actual_worth) med
       FROM dld_transactions WHERE ${RESIDENTIAL} AND instance_date = $1
       GROUP BY 1 ORDER BY n DESC LIMIT 5`,
      [date]
    ),
    pool.query(
      `SELECT area_name, building_name, project_name, actual_worth, rooms, actual_area, is_offplan
       FROM dld_transactions WHERE ${RESIDENTIAL} AND instance_date = $1
       ORDER BY actual_worth DESC NULLS LAST LIMIT 1`,
      [date]
    ),
    pool.query(
      `SELECT count(*)::int n FROM dld_rent_contracts WHERE start_date::date = $1`,
      [date]
    ).catch(() => ({ rows: [{ n: 0 }] })),
  ])

  const a = agg.rows[0]
  const p = prev.rows[0]
  const t = top.rows[0]
  const count = Number(a?.n || 0)

  const brief: DailyBrief = {
    date,
    lagDays: Math.max(0, Math.round((Date.now() - new Date(date).getTime()) / 86_400_000)),
    sales: {
      count,
      totalAed: Number(a?.total || 0),
      medianPrice: a?.med != null ? Math.round(Number(a.med)) : null,
      offplanCount: Number(a?.offplan || 0),
      offplanPct: count ? Math.round((Number(a?.offplan || 0) / count) * 100) : 0,
    },
    vsPrev: p
      ? { date: p.d, count: Number(p.n), pct: p.n ? Math.round(((count - Number(p.n)) / Number(p.n)) * 100) : 0 }
      : null,
    topAreas: areas.rows.map(r => ({
      name: r.name,
      count: Number(r.n),
      medianPrice: r.med != null ? Math.round(Number(r.med)) : null,
    })),
    topSale: t
      ? {
          area: t.area_name || null,
          building: t.building_name || null,
          project: t.project_name || null,
          price: Number(t.actual_worth),
          rooms: t.rooms || null,
          // 库里是 ㎡，对外一律 sqft（memory area-units-sqft-default）
          sizeSqft: t.actual_area ? Math.round(Number(t.actual_area) * 10.7639) : null,
          isOffplan: !!t.is_offplan,
        }
      : null,
    rentContracts: Number(rent.rows[0]?.n || 0),
  }

  cached = { at: Date.now(), brief }
  return brief
}
