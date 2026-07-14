/**
 * Luna Tour — AI client home-finding report.
 *
 * Given a client profile, (1) match best-fit real projects (auto-match), (2)
 * compute a 5-year ROI projection from REAL price + placeholder yield/growth
 * (investment-calculator — same basis as the tour), and (3) ask Gemini to write,
 * per property, a plain-language "what might happen" narrative (optimistic /
 * base / conservative scenarios + key risks) and an overall summary.
 *
 * The MODEL never invents numbers — all figures are computed here and passed in;
 * the model only narrates. Best-effort: on any AI failure the report still
 * returns with numbers + match reasons, just without scenario prose.
 *
 * ISOLATION: lives under luna-tour/, reads residential_projects. Delete the
 * directory to remove.
 */
import { callGemini } from '../services/ai/gemini'
import pool from '../db/pool'
import { calculateInvestment5yr, calculatePaybackYears } from '../services/investment-calculator'
import { matchProperties } from './auto-match'

// Same placeholder assumptions the tour uses (keep reports + tours consistent).
const YIELD_PCT = 6.5
const GROWTH_PCT = 7

export interface ReportProjection {
  buy: number
  future: number
  total_profit_5yr: number
  rental_income_5yr: number
  appreciation_5yr: number
  annualized_return_pct: number
  yield_pct: number
  payback_years: number | null
}

export interface ReportProperty {
  id: string
  name: string
  area: string | null
  developer: string | null
  image: string | null
  reason: string
  projection: ReportProjection | null
  scenarios: { optimistic: string; base: string; conservative: string } | null
  risks: string[]
}

export interface ClientReport {
  client_name: string
  profile: string
  summary: string
  properties: ReportProperty[]
  assumptions: string
  disclaimer: string
}

interface ProjRow {
  id: string
  project_name: string
  area: string | null
  developer: string | null
  primary_image: string | null
  project_images: unknown
  min_price: number | null
  max_price: number | null
}

const DISCLAIMER =
  '本报告基于真实房价数据与统一假设的租金收益率/年增长率测算,仅供参考,不构成投资建议或任何回报承诺。实际收益受市场、汇率、交付与政策等因素影响。'

function stripFence(t: string): string {
  return t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
}

export async function buildClientReport(
  client: Record<string, unknown>,
  oneLiner: string,
  count = 3
): Promise<ClientReport> {
  const clientName = typeof client.name === 'string' ? client.name.trim() : ''
  const base: ClientReport = {
    client_name: clientName,
    profile: oneLiner,
    summary: '',
    properties: [],
    assumptions: `测算假设:租金收益率 ${YIELD_PCT}%/年、价格年增长 ${GROWTH_PCT}%,持有 5 年。`,
    disclaimer: DISCLAIMER,
  }

  const matches = await matchProperties(client, oneLiner, count)
  if (!matches.length) return base

  const { rows } = await pool.query<ProjRow>(
    `SELECT id::text, project_name, area, developer, primary_image, project_images,
            min_price::float8 AS min_price, max_price::float8 AS max_price
       FROM residential_projects
      WHERE id = ANY($1::uuid[])`,
    [matches.map((m) => m.id)]
  )
  const byId = new Map(rows.map((r) => [r.id, r]))

  const properties: ReportProperty[] = []
  for (const m of matches) {
    const row = byId.get(m.id)
    if (!row) continue
    const price = row.min_price ?? row.max_price ?? 0
    const inv = price > 0 ? calculateInvestment5yr(price, YIELD_PCT, GROWTH_PCT) : null
    const imgs = Array.isArray(row.project_images) ? (row.project_images as unknown[]) : []
    const image = row.primary_image ?? (typeof imgs[0] === 'string' ? (imgs[0] as string) : null)
    properties.push({
      id: m.id,
      name: row.project_name,
      area: row.area,
      developer: row.developer,
      image,
      reason: m.reason,
      projection: inv
        ? {
            buy: inv.purchase_price,
            future: inv.purchase_price + inv.total_profit_5yr,
            total_profit_5yr: inv.total_profit_5yr,
            rental_income_5yr: inv.rental_income_5yr,
            appreciation_5yr: inv.appreciation_5yr,
            annualized_return_pct: inv.annualized_return_pct,
            yield_pct: YIELD_PCT,
            payback_years: calculatePaybackYears(YIELD_PCT),
          }
        : null,
      scenarios: null,
      risks: [],
    })
  }
  base.properties = properties
  if (!properties.length) return base

  // One AI call: overall summary + per-property scenarios/risks. Numbers given.
  const facts = properties
    .map((p, i) => {
      const j = p.projection
      const money = j
        ? `买入 AED ${Math.round(j.buy).toLocaleString()}, 5年后约 AED ${Math.round(j.future).toLocaleString()} (年化约 ${j.annualized_return_pct}%, 回本约 ${j.payback_years ?? '?'} 年)`
        : '价格数据缺失'
      return `${i + 1}. id=${p.id} | ${p.name} | ${p.area || 'Dubai'} | ${p.developer || '-'} | ${money} | 匹配理由: ${p.reason}`
    })
    .join('\n')

  const prompt = `你是迪拜房产投资顾问,为客户写一份「选房分析」。下面每个楼盘的数字已算好,你只能引用、不能改动或新增数字。

客户档案: ${JSON.stringify(client)}
经纪一句话: ${oneLiner || '(无)'}

候选楼盘(数字已固定):
${facts}

只输出 JSON,不要任何额外解释:
{
  "summary": "150字以内,面向这位客户的整体建议(组合思路、为何这几个)",
  "properties": [
    {
      "id": "上面的id",
      "scenarios": {
        "optimistic": "乐观情景(如市场强劲/区域利好)一句话,可引用上面的5年数字",
        "base": "中性/基准情景一句话",
        "conservative": "保守情景(如增长放缓/空置)一句话,语气稳健不悲观"
      },
      "risks": ["关键风险1", "关键风险2"]
    }
  ]
}

规则:
- 每个候选都要有一条,id 必须对应。
- 口语化、具体、面向客户;不得承诺或保证回报,不得编造新数字。
- risks 给 2-3 条,简短(如「交付延期」「区域新供应多」「汇率波动」)。`

  try {
    const { text } = await callGemini({
      task: 'auto-report',
      contents: prompt,
      config: { responseMimeType: 'application/json', temperature: 0.5 },
    })
    if (!text.trim()) return base
    const raw = JSON.parse(stripFence(text)) as {
      summary?: string
      properties?: Array<{ id?: string; scenarios?: { optimistic?: string; base?: string; conservative?: string }; risks?: string[] }>
    }
    base.summary = typeof raw.summary === 'string' ? raw.summary.trim() : ''
    const sById = new Map((raw.properties || []).map((p) => [String(p.id), p]))
    for (const p of base.properties) {
      const s = sById.get(p.id)
      if (s?.scenarios) {
        p.scenarios = {
          optimistic: String(s.scenarios.optimistic || ''),
          base: String(s.scenarios.base || ''),
          conservative: String(s.scenarios.conservative || ''),
        }
      }
      if (Array.isArray(s?.risks)) p.risks = s!.risks.map(String).slice(0, 3)
    }
    return base
  } catch {
    return base // numbers + reasons, no AI prose
  }
}
