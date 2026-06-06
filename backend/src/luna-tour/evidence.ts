/**
 * Luna Tour — market EVIDENCE service (E1 credibility layer).
 *
 * Turns the 1.5M-row real Dubai Land Department transaction table
 * (`dld_transactions`) into verifiable, citable evidence the tour can show on
 * screen: "last 30 days N units sold here, median AED X/sqft", plus a few recent
 * comparable sales — every figure traceable to DLD so the customer can verify.
 *
 * Honest by construction:
 *   • only `trans_group = 'Sales'` (excludes mortgages / gifts),
 *   • the window is relative to the LATEST date in the data (DLD lags real time),
 *   • project-first, falls back to area when the project sample is too thin,
 *   • `meter_sale_price` is per-square-METRE → converted to the AED/sqft Dubai
 *     listings use.
 *
 * ISOLATION: read-only against an existing table; lives in luna-tour/. Delete
 * the file + the one public-router route to remove.
 */
import pool from '../db/pool'

const SQM_TO_SQFT = 10.7639
/** Min sales in the window for a PROJECT-level number to be trustworthy; below
 *  this we fall back to the (broader, more stable) area. */
const MIN_PROJECT_SAMPLE = 5
const DLD_URL = 'https://dubailand.gov.ae/en/open-data/real-estate-data/'
const DISCLAIMER = '数据来源:迪拜土地局(DLD)公开成交记录。历史成交不代表未来表现,仅供参考。'

export interface Comparable {
  date: string // YYYY-MM-DD
  rooms: string | null
  psf: number // AED/sqft
  worth: number // total AED
  is_offplan: boolean
}

export interface MarketEvidence {
  granularity: 'project' | 'area'
  scope: string // the matched project or area name
  window_days: number
  window_end: string // YYYY-MM-DD (latest data date)
  volume: number // sales count in window
  median_psf: number | null // AED/sqft
  comparables: Comparable[]
  source: { label: string; url: string; as_of: string } // as_of = YYYY-MM
  disclaimer: string
}

interface AggRow {
  vol: string
  median_psm: string | null
}
interface CompRow {
  instance_date: string
  rooms: string | null
  meter_sale_price: string
  actual_worth: string
  is_offplan: boolean
}

let cachedLatest: { value: string; at: number } | null = null
/** Latest sale date in the data (cached 1h) — the window anchors here, not on
 *  wall-clock "today", because DLD publishes with a lag. */
async function latestSaleDate(): Promise<string | null> {
  if (cachedLatest && Date.now() - cachedLatest.at < 3_600_000) return cachedLatest.value
  const r = await pool.query<{ d: string }>(
    `SELECT to_char(max(instance_date),'YYYY-MM-DD') AS d FROM dld_transactions WHERE trans_group='Sales'`
  )
  const d = r.rows[0]?.d ?? null
  if (d) cachedLatest = { value: d, at: Date.now() }
  return d
}

async function aggregate(field: 'project_name' | 'area_name', value: string, end: string, windowDays: number): Promise<number> {
  const r = await pool.query<AggRow>(
    `SELECT count(*) AS vol
       FROM dld_transactions
      WHERE trans_group='Sales'
        AND ${field} ILIKE $1
        AND instance_date > ($2::date - ($3 || ' days')::interval)
        AND instance_date <= $2::date`,
    [`%${value}%`, end, windowDays]
  )
  return Number(r.rows[0]?.vol ?? 0)
}

async function detail(field: 'project_name' | 'area_name', value: string, end: string, windowDays: number) {
  const agg = await pool.query<AggRow>(
    `SELECT count(*) AS vol,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY meter_sale_price) AS median_psm
       FROM dld_transactions
      WHERE trans_group='Sales' AND meter_sale_price > 0
        AND ${field} ILIKE $1
        AND instance_date > ($2::date - ($3 || ' days')::interval)
        AND instance_date <= $2::date`,
    [`%${value}%`, end, windowDays]
  )
  const comps = await pool.query<CompRow>(
    `SELECT to_char(instance_date,'YYYY-MM-DD') AS instance_date, rooms,
            meter_sale_price, actual_worth, COALESCE(is_offplan,false) AS is_offplan
       FROM dld_transactions
      WHERE trans_group='Sales' AND meter_sale_price > 0 AND actual_worth > 0
        AND ${field} ILIKE $1
        AND instance_date <= $2::date
      ORDER BY instance_date DESC, id DESC
      LIMIT 3`,
    [`%${value}%`, end]
  )
  const medianPsm = agg.rows[0]?.median_psm
  const median_psf = medianPsm ? Math.round(Number(medianPsm) / SQM_TO_SQFT) : null
  const comparables: Comparable[] = comps.rows.map((c) => ({
    date: c.instance_date,
    rooms: c.rooms,
    psf: Math.round(Number(c.meter_sale_price) / SQM_TO_SQFT),
    worth: Math.round(Number(c.actual_worth)),
    is_offplan: c.is_offplan,
  }))
  return { volume: Number(agg.rows[0]?.vol ?? 0), median_psf, comparables }
}

/**
 * Real market evidence for a property. Tries the project first; if too few
 * recent sales there, falls back to the area (and says which).
 */
export async function getMarketEvidence(opts: {
  projectName?: string | null
  areaName?: string | null
  windowDays?: number
}): Promise<MarketEvidence | null> {
  const windowDays = opts.windowDays ?? 30
  const end = await latestSaleDate()
  if (!end) return null
  const asOf = end.slice(0, 7) // YYYY-MM

  // project-first
  if (opts.projectName) {
    const vol = await aggregate('project_name', opts.projectName, end, windowDays)
    if (vol >= MIN_PROJECT_SAMPLE) {
      const d = await detail('project_name', opts.projectName, end, windowDays)
      return {
        granularity: 'project',
        scope: opts.projectName,
        window_days: windowDays,
        window_end: end,
        ...d,
        source: { label: 'Dubai Land Department', url: DLD_URL, as_of: asOf },
        disclaimer: DISCLAIMER,
      }
    }
  }
  // area fallback
  if (opts.areaName) {
    const d = await detail('area_name', opts.areaName, end, windowDays)
    if (d.volume > 0 || d.comparables.length) {
      return {
        granularity: 'area',
        scope: opts.areaName,
        window_days: windowDays,
        window_end: end,
        ...d,
        source: { label: 'Dubai Land Department', url: DLD_URL, as_of: asOf },
        disclaimer: DISCLAIMER,
      }
    }
  }
  return null
}
