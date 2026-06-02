/**
 * Luna Tour — AI property matcher.
 *
 * Given a client profile + one-liner brief, ask Gemini to pick the best-fit
 * projects from REAL inventory (residential_projects) and explain, per pick,
 * why it suits this specific client. Only ids that exist in the candidate set
 * are returned, so the model can never invent a property.
 *
 * Best-effort: any failure returns [] so the picker just stays manual.
 *
 * ISOLATION: lives under luna-tour/, reads residential_projects. Delete the
 * directory to remove.
 */
import { GoogleGenAI } from '@google/genai'
import pool from '../db/pool'

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
const MODELS = ['gemini-3-flash', 'gemini-2.5-flash']

export interface MatchPick {
  id: string
  project_name: string
  area: string | null
  reason: string
}

interface Candidate {
  id: string
  project_name: string
  area: string | null
  developer: string | null
  min_price: number | null
  max_price: number | null
  status: string | null
}

function stripFence(t: string): string {
  return t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
}

/**
 * Pick `count` best-fit projects for a client + explain each. Returns [] on any
 * failure or when there aren't enough usable (coordinated) candidates.
 */
export async function matchProperties(
  client: Record<string, unknown>,
  oneLiner: string,
  count = 3
): Promise<MatchPick[]> {
  const { rows } = await pool.query<Candidate>(
    `SELECT id::text, project_name, area, developer,
            min_price::float8 AS min_price, max_price::float8 AS max_price, status
       FROM residential_projects
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL
      ORDER BY verified DESC NULLS LAST, project_name
      LIMIT 90`
  )
  if (rows.length < 2) return []
  const byId = new Map(rows.map((r) => [r.id, r]))

  const list = rows
    .map((r) => {
      const lo = r.min_price ? `AED ${Math.round(r.min_price / 1000)}k` : '?'
      const hi = r.max_price ? `${Math.round(r.max_price / 1000)}k` : '?'
      return `${r.id} | ${r.project_name} | ${r.area || 'Dubai'} | ${r.developer || '-'} | ${lo}-${hi} | ${r.status || '-'}`
    })
    .join('\n')

  const prompt = `你是迪拜房产经纪助手。根据客户画像,从候选楼盘里挑出最适合的 ${count} 个,并解释为什么适合这位客户。

客户档案: ${JSON.stringify(client)}
经纪一句话: ${oneLiner || '(无)'}

候选楼盘 (格式: id | 名称 | 区域 | 开发商 | 价格区间 | 状态):
${list}

只输出 JSON,不要任何解释:
{ "picks": [ { "id": "候选列表里的id", "reason": "一句中文,说明为何适合该客户" } ] }

规则:
- id 必须来自上面候选列表,挑 ${count} 个,顺序按推荐优先级(最适合的在前)。
- reason 要针对这位客户,具体、口语化、不超过 40 字,可结合预算/区域/生活方式/投资回报。
- 客户画像里若有预算/区域偏好,优先满足;拿不准就选区域多样、价格有梯度的组合。`

  for (const model of MODELS) {
    try {
      const resp = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: 'application/json', temperature: 0.5 },
      })
      const text = resp.text ?? ''
      if (!text.trim()) continue
      const raw = JSON.parse(stripFence(text)) as { picks?: Array<{ id?: string; reason?: string }> }
      const picks: MatchPick[] = []
      for (const p of raw.picks || []) {
        const c = p.id ? byId.get(String(p.id)) : undefined
        if (c && !picks.some((x) => x.id === c.id)) {
          picks.push({ id: c.id, project_name: c.project_name, area: c.area, reason: String(p.reason || '').slice(0, 120) })
        }
      }
      if (picks.length >= 2) return picks.slice(0, count)
    } catch {
      /* try next model */
    }
  }
  return []
}
