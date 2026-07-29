/**
 * 地图搜索框的候选排序 —— 「打一个区域名,直接把你带过去」。
 *
 * **为什么不直接用 area-matcher.resolveArea**:那个解决的是反向的问题 ——
 * 整句解析(Luna 语音「带我去朱美拉海滩」→ 必须收敛成**唯一一个**区,拿不准
 * 就回头问客户)。搜索框要的恰恰相反:**半个词就得给一串候选**
 * ("mar" → Dubai Marina / Marjan Island …),宁可多给也不能不给,更不能因为
 * 「歧义」返回空。所以两边共用归一化 + 别名表 + 词级模糊,排序各写各的。
 *
 * 旧实现是 `LOWER(name) LIKE '%q%'` 一条 SQL。它挡掉的真实查询(owner 2026-07-29
 * 实测,客户 slavynchuk94@ 的原话是 "Can't find many off plan projects or area"):
 *   • "Jumeirah Lake Towers" → 库里叫 `JLT Jumeirah Lake tower`(单数+词序)→ 0 条
 *   • "sports city"          → 库里叫 `Sport city`(单数)               → 0 条
 *   • "emaar beachfront"     → 库里叫 `Beach front by Emaar`(词序)     → 0 条
 *   • "meydan"               → 库里拼作 `Medan`                          → 0 条
 * 全都是「名字对得上、字面对不上」,不是数据缺失。
 */
import { ALIASES, JUNK_MARKERS, normalizeAreaName, tokenize, tokenSimilarity } from './area-matcher'

/** 词级模糊的下限 —— 和 area-matcher 的 FUZZY_MIN_SIM 一致(Harbor↔Harbour = 0.857) */
const FUZZY_MIN_SIM = 0.78

/**
 * 搜索框专属的额外别名。放在 area-matcher 的 ALIASES **之上**,不改那张表 ——
 * 那张表服务于语音解析,加错一条会把客户带到错的区;这里只影响候选排序,错了
 * 最多多出一行。
 */
const EXTRA_ALIASES: Record<string, string> = {
  meydan: 'medan',
  'meydan city': 'medan',
  'nad al sheba': 'nadd al sheba',
  'palm jumeirah island': 'palm jumeirah',
  'downtown dubai': 'downtown dubai',
  'emaar beachfront': 'beach front by emaar',
  'dubai marina jbr': 'dubai marina',
  'city walk': 'al wasl',
}

/** 归一化 + 展开别名。别名查不到就原样返回。 */
export function normalizeQuery(raw: string): string {
  const n = normalizeAreaName(raw)
  return normalizeAreaName(EXTRA_ALIASES[n] || ALIASES[n] || n)
}

/** 名字里带这些标记 = 内部标注行,不是客户会去的社区 → 排到最后 */
function isJunk(nameNorm: string, rawName: string): boolean {
  return JUNK_MARKERS.some((m) => nameNorm.includes(m)) || rawName.includes('外国人无法买卖')
}

/**
 * 两个词算不算「同一个词」。三档,从严到松:
 *   1. 完全相同
 *   2. 谁是谁的前缀都行 —— 单复数(sport↔sports)、连写(beach↔beachfront)、
 *      正在打字打了一半(mar↔marina)全靠这条。限 3 字符起,否则 "al" 能勾上一切。
 *   3. 编辑距离(medan↔meydan、harbor↔harbour),限 5 字符起。
 */
function tokenMatch(nameTok: string, qTok: string): boolean {
  if (nameTok === qTok) return true
  const short = nameTok.length < qTok.length ? nameTok : qTok
  const long = nameTok.length < qTok.length ? qTok : nameTok
  if (short.length >= 3 && long.startsWith(short)) return true
  if (short.length >= 5 && tokenSimilarity(nameTok, qTok) >= FUZZY_MIN_SIM) return true
  return false
}

/**
 * 候选得分 0..1。分档而不是连续打分 —— 搜索框要的是「稳定可预期的顺序」,
 * 同档之间再用成交量之类的热度做 tie-break(由调用方决定)。
 */
export function scoreName(name: string, qNorm: string, qTokens: string[]): number {
  const nameNorm = normalizeAreaName(name)
  if (!nameNorm || !qNorm) return 0

  if (nameNorm === qNorm) return 1
  if (nameNorm.startsWith(qNorm)) return 0.9

  const nameTokens = nameNorm.split(' ').filter(Boolean)
  // 词首命中:"marina" → "dubai marina"。买家心里的名字往往是全名的后半截。
  if (nameTokens.some((t) => t.startsWith(qNorm))) return 0.8
  if (nameNorm.includes(qNorm)) return 0.7

  // 逐词覆盖 —— 词序无关。"emaar beachfront" 也能落到 "Beach front by Emaar"。
  const matched = qTokens.filter((qt) => nameTokens.some((nt) => tokenMatch(nt, qt))).length
  if (!matched) return 0
  if (matched === qTokens.length) {
    // 查询词全中。名字里多出来的词越少越贴切(Sport city > Sport city annex)
    return 0.6 - Math.min(0.1, (nameTokens.length - qTokens.length) * 0.02)
  }
  // 部分命中只在多词查询里给分,单词查询没中就是没中(否则满屏噪声)
  return qTokens.length > 1 ? 0.25 * (matched / qTokens.length) : 0
}

export interface AreaCandidateRow {
  id: string
  name: string
  name_ar: string | null
  lat: number | null
  lng: number | null
  transaction_count: number | null
  avg_price_sqm: number | null
  project_count: number
  /** 多语言译名(translations jsonb 里的 name),一起参与匹配 */
  alt_names: string[]
}

export interface ProjectCandidateRow {
  id: string
  project_name: string
  developer: string | null
  area: string | null
  latitude: number | null
  longitude: number | null
  min_price: number | null
}

export interface Suggestion {
  kind: 'area' | 'project'
  id: string
  name: string
  nameAr: string | null
  /** 副标题:区 = 「N 个在售楼盘」由前端组装;楼盘 = 开发商 · 区域 */
  subtitle: string | null
  centroid: { lat: number; lng: number } | null
  transactionCount: number | null
  avgPriceSqm: number | null
  projectCount: number | null
  minPrice: number | null
}

/** 区域候选。译名也参与匹配,取最高分。 */
export function rankAreas(rows: AreaCandidateRow[], q: string, limit: number): Suggestion[] {
  const qNorm = normalizeQuery(q)
  const qTokens = qNorm.split(' ').filter(Boolean)
  if (!qTokens.length) return []

  return rows
    .map((r) => {
      let s = Math.max(scoreName(r.name, qNorm, qTokens), ...r.alt_names.map((n) => scoreName(n, qNorm, qTokens)))
      if (isJunk(normalizeAreaName(r.name), r.name)) s *= 0.4
      // 平台上有在售楼盘的区微微加权 —— 搜到就能看到房,比空区有用
      if (s > 0 && r.project_count > 0) s += 0.02
      return { r, s }
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || (b.r.transaction_count ?? 0) - (a.r.transaction_count ?? 0))
    .slice(0, limit)
    .map(({ r }) => ({
      kind: 'area' as const,
      id: r.id,
      name: r.name.trim(),
      nameAr: r.name_ar,
      subtitle: null,
      centroid: r.lat != null && r.lng != null ? { lat: r.lat, lng: r.lng } : null,
      transactionCount: r.transaction_count,
      avgPriceSqm: r.avg_price_sqm,
      projectCount: r.project_count,
      minPrice: null,
    }))
}

/** 楼盘候选。楼盘名命中最强,开发商/区域名次之(搜 "EMAAR" 该列出它的楼盘)。 */
export function rankProjects(rows: ProjectCandidateRow[], q: string, limit: number): Suggestion[] {
  const qNorm = normalizeQuery(q)
  const qTokens = qNorm.split(' ').filter(Boolean)
  if (!qTokens.length) return []

  return rows
    .map((r) => {
      const byName = scoreName(r.project_name, qNorm, qTokens)
      const byDev = r.developer ? scoreName(r.developer, qNorm, qTokens) * 0.75 : 0
      const byArea = r.area ? scoreName(r.area, qNorm, qTokens) * 0.7 : 0
      return { r, s: Math.max(byName, byDev, byArea) }
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.r.project_name.localeCompare(b.r.project_name))
    .slice(0, limit)
    .map(({ r }) => ({
      kind: 'project' as const,
      id: r.id,
      name: r.project_name,
      nameAr: null,
      subtitle: [r.developer, r.area].filter(Boolean).join(' · ') || null,
      centroid: r.latitude != null && r.longitude != null ? { lat: r.latitude, lng: r.longitude } : null,
      transactionCount: null,
      avgPriceSqm: null,
      projectCount: null,
      minPrice: r.min_price,
    }))
}

/**
 * 区在前、楼盘在后,各有保底名额。
 *
 * 顺序写死成「区 → 楼盘」而不是纯按分排:买家的思考顺序是从大到小(先挑区,
 * 再挑楼盘),成交页的统一搜索也是这个顺序(market.ts 的 QUOTA)。两处保持一致。
 * 某一类不够,名额让给另一类,不留空。
 */
export function mergeSuggestions(areas: Suggestion[], projects: Suggestion[], total: number): Suggestion[] {
  const AREA_QUOTA = Math.ceil(total / 2)
  const areaTake = Math.min(areas.length, Math.max(AREA_QUOTA, total - projects.length))
  const projTake = Math.min(projects.length, total - areaTake)
  return [...areas.slice(0, areaTake), ...projects.slice(0, projTake)]
}

/** 单测用:导出内部判据 */
export const __testing = { tokenMatch, isJunk }

export { tokenize }
