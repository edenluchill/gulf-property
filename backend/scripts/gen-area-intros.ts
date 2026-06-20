/**
 * 为所有 dubai_areas 生成买家视角的区域简介（中英双语）：
 *   1-2 句特色/定位/适合人群（Gemini 生成，给定真实指标防编造）
 *   + 程序计算的"离哪近"（最近 2 个地标 + 距离）
 *
 * 写入 translations.zh.description / translations.en.description，
 * 并在 description 为空时填英文版。已有 zh 简介(≥20字)的区域跳过。
 *
 * Run: npx ts-node backend/scripts/gen-area-intros.ts
 */
import 'dotenv/config'
import pool from '../src/db/pool'
import { GoogleGenAI } from '@google/genai'

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
const MODEL = 'gemini-3.5-flash'

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

const fmtKm = (km: number) => (km < 10 ? km.toFixed(1) : String(Math.round(km)))

async function genIntro(input: {
  name: string; zhName: string | null
  medianPrice: number | null; yieldPct: number | null; growthPct: number | null
  nearest: { en: string; zh: string; km: number }[]
}): Promise<{ zh: string; en: string } | null> {
  const facts = [
    `Area: ${input.name}${input.zhName ? ` (${input.zhName})` : ''}`,
    input.medianPrice ? `Median unit price: AED ${Math.round(input.medianPrice).toLocaleString()}` : null,
    input.yieldPct ? `Gross rental yield: ${input.yieldPct.toFixed(1)}%` : null,
    input.growthPct != null ? `YoY price growth: ${input.growthPct.toFixed(1)}%` : null,
    `Nearest landmarks: ${input.nearest.map(n => `${n.en} (${fmtKm(n.km)}km)`).join(', ')}`
  ].filter(Boolean).join('\n')

  const prompt = `You write short, factual area intros for a Dubai property-buying app used by Chinese investors.

${facts}

Write a 1-2 sentence intro about this Dubai area for a property BUYER: positioning/character of the area and who it suits (e.g. rental investors / families / first-time buyers / luxury buyers). Be professional and restrained — do NOT invent specific facilities, schools, or amenities you don't know. Do NOT mention the landmark distances (shown separately). Do NOT repeat exact numbers from the facts.

Return STRICT JSON: {"zh": "<简体中文版>", "en": "<English version>"}`

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await ai.models.generateContent({
        model: MODEL,
        contents: prompt,
        config: { responseMimeType: 'application/json' }
      })
      const text = res.text || ''
      const parsed = JSON.parse(text)
      if (parsed.zh && parsed.en) return { zh: String(parsed.zh).trim(), en: String(parsed.en).trim() }
    } catch (e: any) {
      console.log(`    retry ${attempt + 1}: ${String(e.message || e).slice(0, 120)}`)
      await new Promise(r => setTimeout(r, 2500))
    }
  }
  return null
}

async function main() {
  const landmarksRes = await pool.query(`
    SELECT name, translations->'zh'->>'name' AS zh,
           ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
    FROM dubai_landmarks WHERE visible = true
  `)
  const landmarks = landmarksRes.rows.map(r => ({
    en: r.name as string,
    zh: (r.zh as string) || (r.name as string),
    lat: Number(r.lat),
    lng: Number(r.lng)
  }))

  const areasRes = await pool.query(`
    SELECT da.id, da.name, da.description, da.translations,
           ST_Y(ST_Centroid(da.boundary::geometry)) AS lat,
           ST_X(ST_Centroid(da.boundary::geometry)) AS lng,
           m.median_unit_price, m.rental_yield_pct, m.capital_growth_pct
    FROM dubai_areas da
    LEFT JOIN get_dubai_area_metrics() m ON m.id = da.id
    WHERE da.visible = true
    ORDER BY da.name
  `)

  console.log(`Areas: ${areasRes.rows.length}, landmarks: ${landmarks.length}\n`)
  let done = 0, failed = 0

  const pending = areasRes.rows.filter(a => (a.translations?.zh?.description || '').length < 20)
  const skipped = areasRes.rows.length - pending.length
  console.log(`Pending: ${pending.length}, skipped(existing): ${skipped}\n`)

  const processOne = async (a: any) => {
    const nearest = landmarks
      .map(lm => ({ ...lm, km: haversineKm(Number(a.lat), Number(a.lng), lm.lat, lm.lng) }))
      .sort((x, y) => x.km - y.km)
      .slice(0, 2)

    const intro = await genIntro({
      name: a.name,
      zhName: a.translations?.zh?.name || null,
      medianPrice: a.median_unit_price ? Number(a.median_unit_price) : null,
      yieldPct: a.rental_yield_pct ? Number(a.rental_yield_pct) : null,
      growthPct: a.capital_growth_pct != null ? Number(a.capital_growth_pct) : null,
      nearest
    })
    if (!intro) { failed++; console.log(`  ❌ ${a.name}`); return }

    const proximityZh = nearest.map(n => `距${n.zh}约 ${fmtKm(n.km)}km`).join('、')
    const proximityEn = nearest.map(n => `${fmtKm(n.km)}km to ${n.en}`).join(', ')
    const zhDesc = `${intro.zh}${intro.zh.endsWith('。') ? '' : '。'}${proximityZh}。`
    const enDesc = `${intro.en}${intro.en.endsWith('.') ? '' : '.'} ${proximityEn}.`

    const translations = { ...(a.translations || {}) }
    translations.zh = { ...(translations.zh || {}), description: zhDesc }
    translations.en = { ...(translations.en || {}), description: enDesc }

    await pool.query(
      `UPDATE dubai_areas
          SET translations = $1,
              description = CASE WHEN description IS NULL OR description = '' THEN $2 ELSE description END,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $3`,
      [JSON.stringify(translations), enDesc, a.id]
    )
    done++
    console.log(`  ✅ [${done}/${pending.length}] ${a.name} → ${zhDesc.slice(0, 50)}…`)
  }

  // 4 路并发（Gemini 延迟为主，不压 DB）
  const CONCURRENCY = 4
  for (let i = 0; i < pending.length; i += CONCURRENCY) {
    await Promise.all(pending.slice(i, i + CONCURRENCY).map(processOne))
  }

  console.log(`\nDone: ${done}, skipped(existing): ${skipped}, failed: ${failed}`)
  await pool.end()
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })
