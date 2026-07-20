/**
 * Area Matcher — 区域名解析，**带置信度**。
 *
 * ## 为什么重写(2026-07-20)
 *
 * 旧版是三级 SQL cascade(exact LIKE → strip-spaces → word-overlap),第三级是:
 *
 *     WHERE EXISTS (SELECT 1 FROM unnest(...) AS word
 *                   WHERE LENGTH(word) > 2 AND LOWER(name) LIKE '%'||word||'%')
 *     ORDER BY priority, name LIMIT 1        -- ← tie-break 是【字母序】
 *
 * 「命中任意一个 >2 字符的词就算候选,然后按字母序取第一个」。生产事故:
 *
 *   - "Dubai Harbor"                  → "D3 Dubai Dsign District 3"
 *     (dubai 一个词命中全库 20+ 个区,字母序 D3 排第一;真正的 Dubai Harbour 被 LIMIT 1 砍掉)
 *   - "Jumeirah Village Circle (JVC)" → "Jebel Ali Village"
 *     (village 一个词命中,Je < Ju;命中 3/4 个词的 JVC Jumeirah Village Circle 输给字母序)
 *
 * 而且**返回值不带任何匹配质量信息** —— 路由层 res.json({area:{id,name,lat,lng}}) 把
 * priority 扔了,工具层再用匹配结果**覆盖用户原词**。于是 Luna 收到一个语气笃定的
 * 成功回执,张口就开始介绍另一个区。**工具撒谎而模型无从察觉,这是全部问题的总根源。**
 *
 * ## 现在怎么做
 *
 * `dubai_areas` 只有 232 行 —— 全量载入内存打分,不跟 SQL 较劲。好处:纯函数、可单测、
 * 能算置信度、能给候选。
 *
 * 打分 = IDF 加权的 token 覆盖率(双向,偏向 query 覆盖) + 词级模糊匹配。
 * **IDF 是关键**:"dubai" 出现在 20+ 个区名里(几乎无信息量),"harbour" 只出现 2 次
 * (高信息量)。旧版把这两个词一视同仁,所以 "dubai" 成了万能通配符。
 *
 * **margin 规则同样关键**:top1 与 top2 差距 < AMBIGUOUS_MARGIN 时判定为歧义,
 * 返回候选列表而不是猜一个。"village" 这种词就该问一句,不该赌。
 *
 * ## 数据现实(别指望能靠 SQL 精确匹配)
 *
 * 232 个区名里:8 个带首尾空格("Business Bay " / "Dubai Marina " / " Blue water ");
 * 一批混着中文注释("Zayed Port 港口免税区" / "Yas Island（亚斯娱乐岛）");
 * "‏Trade Center First" 开头有个不可见的 RTL 控制符(U+200F);
 * 拼写错误遍地(Dsign / Indusdrial / Ialand / Heartland / villiage / Finacial)。
 * 归一化必须处理这些,否则用户永远打不出能精确匹配的字符串。
 */

import { Pool } from 'pg'

// ── 阈值 ────────────────────────────────────────────────────────────────────
/** ≥ 此分数才算匹配上 */
export const ACCEPT_THRESHOLD = 0.62
/** ≥ 此分数才配进候选列表(低于此的连"你是不是想问"都不配) */
export const CANDIDATE_THRESHOLD = 0.30
/** top1 与 top2 差距小于此值 → 判定歧义,要求澄清而不是猜 */
export const AMBIGUOUS_MARGIN = 0.08
/** 词级模糊匹配的最低相似度(Harbor↔Harbour = 0.857) */
const FUZZY_MIN_SIM = 0.78
/** 模糊命中的折扣(模糊匹配不该和精确匹配等价) */
const FUZZY_DISCOUNT = 0.9

// ── 归一化 ──────────────────────────────────────────────────────────────────

/** 双向文本控制符 —— "‏Trade Center First" 开头就藏了一个 U+200F */
const BIDI_MARKS = /[‎‏‪-‮⁦-⁩​-‍﻿]/g
/** CJK + 全角标点 —— 区名里的中文是注释不是名字("Zayed Port 港口免税区") */
const CJK = /[　-〿㐀-䶿一-鿿豈-﫿＀-￯]/g

export function normalizeAreaName(raw: string): string {
  return (raw || '')
    .normalize('NFKC')
    .replace(BIDI_MARKS, '')
    .replace(CJK, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function tokenize(raw: string): string[] {
  const n = normalizeAreaName(raw)
  return n ? n.split(' ').filter(Boolean) : []
}

/**
 * 别名 —— 只放**模糊匹配够不到**的（词形差太远的）。
 * 能靠 Levenshtein 解决的(Harbor→Harbour、Hartland→Heartland)不要写进来,
 * 写进来就得永久维护。
 */
const ALIASES: Record<string, string> = {
  'dubai hills estate': 'dubai hills',
  'tecom': 'barsha heights',
  'the oasis': 'the oasis by emaar',
  'oasis by emaar': 'the oasis by emaar',
  'mbr city': 'mbr city district 1',
  'mohammed bin rashid city': 'mbr city district 1',
  'jumeirah lake towers': 'jlt jumeirah lake tower',
  'jumeirah village triangle': 'jvt jumeirah villiage triangle',
  'jumeirah beach residence': 'jumeirah beach residence jbr',
  'dubai design district': 'd3 dubai dsign district 3',
  'sobha hartland': 'sobha heartland',
  'silicon oasis': 'dubai silicon oasis',
  'expo city': 'dubai expo city',
  'creek harbour': 'dubai creek harbour',
  'creek harbor': 'dubai creek harbour',
  'difc': 'difc dubai international financial center',
  'business bay': 'business bay',
}

/**
 * 明显不是可售住宅区的条目 —— 命中这些要打折,别让它们赢。
 * 例:查 "downtown" 时 "downtown&local area 外国人无法买卖" 不该跟 "Downtown Dubai" 抢。
 */
const JUNK_MARKERS = ['vacant', 'labor camp', 'desert area', 'local villa residential area']

// ── 编辑距离 ────────────────────────────────────────────────────────────────

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = new Array(b.length + 1)
  let cur = new Array(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
    }
    ;[prev, cur] = [cur, prev]
  }
  return prev[b.length]
}

/** 0..1 的词相似度。Harbor↔Harbour = 1 - 1/7 = 0.857 */
export function tokenSimilarity(a: string, b: string): number {
  if (a === b) return 1
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 1
  // 长度差太大直接判负,避免 "al" 匹配上 "alexandria"
  if (Math.abs(a.length - b.length) > Math.max(2, maxLen * 0.4)) return 0
  return 1 - levenshtein(a, b) / maxLen
}

// ── 语料与 IDF ──────────────────────────────────────────────────────────────

export interface AreaRow {
  id: string
  name: string
  lat?: number | null
  lng?: number | null
}

interface Corpus {
  areas: Array<AreaRow & { tokens: string[]; norm: string; junk: boolean }>
  idf: Map<string, number>
  /** 未登录词的 IDF —— 用户打的词语料里没有,信息量按最高算 */
  maxIdf: number
}

function buildCorpus(rows: AreaRow[]): Corpus {
  const areas = rows.map((r) => {
    const norm = normalizeAreaName(r.name)
    return {
      ...r,
      norm,
      tokens: norm ? norm.split(' ').filter(Boolean) : [],
      junk: JUNK_MARKERS.some((m) => norm.includes(m)),
    }
  })
  const N = areas.length || 1
  const df = new Map<string, number>()
  for (const a of areas) {
    for (const t of new Set(a.tokens)) df.set(t, (df.get(t) || 0) + 1)
  }
  const idf = new Map<string, number>()
  for (const [t, d] of df) idf.set(t, Math.log(N / d))
  return { areas, idf, maxIdf: Math.log(N) }
}

/** 未登录词按最高信息量算 —— 用户特意打出来的生僻词最该被重视 */
function idfOf(c: Corpus, token: string): number {
  const v = c.idf.get(token)
  return v === undefined ? c.maxIdf : Math.max(v, 0.05)
}

// ── 打分 ────────────────────────────────────────────────────────────────────

/**
 * query 与候选区名的相似度 0..1。
 *
 * 用 **IDF 加权的双向覆盖率**,再用几何平均偏向 query 覆盖:
 *   score = queryCoverage^0.75 × candCoverage^0.25
 *
 * 偏向 query 覆盖是因为「用户说的词全都对上了」比「区名的词全被用上了」更能说明问题 ——
 * 否则短 query("JVC")永远赢不了长区名("JVC Jumeirah Village Circle")。
 * 但 candCoverage 不能丢:丢了的话 "dubai" 会以 1.0 匹配上所有含 Dubai 的区。
 */
export function scoreMatch(
  corpus: Corpus,
  queryTokens: string[],
  candTokens: string[]
): number {
  if (!queryTokens.length || !candTokens.length) return 0

  const best = (from: string[], to: string[]) => {
    const out = new Map<string, number>()
    for (const f of from) {
      let b = 0
      for (const t of to) {
        const s = f === t ? 1 : tokenSimilarity(f, t) >= FUZZY_MIN_SIM ? tokenSimilarity(f, t) * FUZZY_DISCOUNT : 0
        if (s > b) b = s
      }
      out.set(f, Math.max(out.get(f) ?? 0, b))
    }
    return out
  }

  const qHit = best(queryTokens, candTokens)
  const cHit = best(candTokens, queryTokens)

  const weighted = (tokens: string[], hits: Map<string, number>) => {
    let num = 0
    let den = 0
    for (const t of new Set(tokens)) {
      const w = idfOf(corpus, t)
      den += w
      num += w * (hits.get(t) ?? 0)
    }
    return den > 0 ? num / den : 0
  }

  const qc = weighted(queryTokens, qHit)
  const cc = weighted(candTokens, cHit)
  if (qc === 0) return 0

  return Math.pow(qc, 0.75) * Math.pow(Math.max(cc, 1e-6), 0.25)
}

// ── 对外结果类型 ────────────────────────────────────────────────────────────

export interface AreaCandidate {
  id: string
  name: string
  confidence: number
}

export interface AreaResolution {
  /** matched = 可以放心用;ambiguous = 必须回头问客户;not_found = 库里没有 */
  status: 'matched' | 'ambiguous' | 'not_found'
  /** 用户原话 —— **永远保留**,让上层能说"你问的是 X,我理解成 Y" */
  asked: string
  match: (AreaRow & { confidence: number; matched_via: string }) | null
  candidates: AreaCandidate[]
}

// ── 语料缓存 ────────────────────────────────────────────────────────────────

let cache: { corpus: Corpus; at: number } | null = null
const CACHE_TTL_MS = 5 * 60 * 1000

/** 测试用:强制下次重新载入 */
export function clearAreaCache(): void {
  cache = null
}

async function getCorpus(pool: Pool): Promise<Corpus> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.corpus
  const { rows } = await pool.query<AreaRow>(`
    SELECT id::text AS id,
           name,
           ST_Y(ST_Centroid(boundary::geometry)) AS lat,
           ST_X(ST_Centroid(boundary::geometry)) AS lng
      FROM dubai_areas
     WHERE visible = true
  `)
  const corpus = buildCorpus(rows)
  cache = { corpus, at: Date.now() }
  return corpus
}

/** 纯函数版,单测直接喂数据不碰 DB */
export function resolveAreaIn(rows: AreaRow[], query: string): AreaResolution {
  return resolveWithCorpus(buildCorpus(rows), query)
}

function resolveWithCorpus(corpus: Corpus, query: string): AreaResolution {
  const asked = (query || '').trim()
  const empty: AreaResolution = { status: 'not_found', asked, match: null, candidates: [] }
  if (!asked) return empty

  let normQuery = normalizeAreaName(asked)
  let via = 'tokens'
  if (ALIASES[normQuery]) {
    normQuery = normalizeAreaName(ALIASES[normQuery])
    via = 'alias'
  }
  const qTokens = normQuery.split(' ').filter(Boolean)
  if (!qTokens.length) return empty

  const scored = corpus.areas
    .map((a) => {
      let s = scoreMatch(corpus, qTokens, a.tokens)
      // 完全相等直接封顶 —— 归一化后相等就是同一个区,别让 IDF 把它压下去
      if (a.norm === normQuery) s = 1
      if (a.junk) s *= 0.6
      return { a, s }
    })
    .filter((x) => x.s > 0)
    .sort((x, y) => y.s - x.s || x.a.norm.length - y.a.norm.length || x.a.norm.localeCompare(y.a.norm))
  //                              ^^^ 确定性 tie-break:分数 → 名字更短 → 字母序。
  //                              旧版直接拿字母序当主排序,那是抽奖不是匹配。

  if (!scored.length) return empty

  // **精确命中一律直接返回，不走 margin 判定。**
  //
  // 栽过一次:查 "Damac Hills" 被判成歧义 —— 因为库里还有 "Damac Hills 2",而 "2"
  // 这个 token 在 232 个区名里到处都是(Al Qusais 2 / Arabian Ranches 2 / …),IDF 极低,
  // 于是两者只差 0.03 分，触发了 margin 规则。
  // 但用户**一字不差地打出了某个区的名字**,再回头问「你是指哪个」是纯粹的添乱。
  // 精确相等是比相对分差更强的信号,必须优先。
  const exact = scored.filter((x) => x.a.norm === normQuery)
  if (exact.length === 1) {
    const e = exact[0]
    return {
      status: 'matched',
      asked,
      match: { id: e.a.id, name: e.a.name.trim(), lat: e.a.lat, lng: e.a.lng, confidence: 1, matched_via: 'exact' },
      candidates: scored
        .filter((x) => x.a.id !== e.a.id && x.s >= CANDIDATE_THRESHOLD)
        .slice(0, 3)
        .map((x) => ({ id: x.a.id, name: x.a.name.trim(), confidence: round2(x.s) })),
    }
  }

  const candidates: AreaCandidate[] = scored
    .filter((x) => x.s >= CANDIDATE_THRESHOLD)
    .slice(0, 4)
    .map((x) => ({ id: x.a.id, name: x.a.name.trim(), confidence: round2(x.s) }))

  const top = scored[0]
  const second = scored[1]
  const margin = second ? top.s - second.s : 1

  if (top.s < ACCEPT_THRESHOLD) {
    return { status: candidates.length ? 'ambiguous' : 'not_found', asked, match: null, candidates }
  }
  if (margin < AMBIGUOUS_MARGIN && second && second.s >= ACCEPT_THRESHOLD) {
    // 两个都够格且分不出高下 —— 猜一个就是 50% 概率带客户去错地方
    return { status: 'ambiguous', asked, match: null, candidates }
  }

  return {
    status: 'matched',
    asked,
    match: {
      id: top.a.id,
      name: top.a.name.trim(),
      lat: top.a.lat,
      lng: top.a.lng,
      confidence: round2(top.s),
      matched_via: top.a.norm === normQuery ? 'exact' : via,
    },
    candidates: candidates.filter((c) => c.id !== top.a.id),
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * 主入口 —— 带置信度的区域解析。新代码一律用这个。
 */
export async function resolveArea(pool: Pool, query: string): Promise<AreaResolution> {
  const corpus = await getCorpus(pool)
  return resolveWithCorpus(corpus, query)
}

// ── 向后兼容层 ──────────────────────────────────────────────────────────────
// 旧调用方(market.ts / area-resolver.ts / ai-areas.ts)保持签名不变。
// 行为变化:**匹配不确定时返回 null,而不是返回一个错的区**。
// 对调用方而言"没找到"永远比"给错了"安全 —— 后者会被当成事实播报给客户。

export async function findAreaByName(
  pool: Pool,
  areaName: string,
  extraColumns = ''
): Promise<any | null> {
  const r = await resolveArea(pool, areaName)
  if (r.status !== 'matched' || !r.match) return null

  const cols = extraColumns ? `, ${extraColumns}` : ''
  const { rows } = await pool.query(
    `SELECT id, name, name_ar, description ${cols} FROM dubai_areas WHERE id = $1`,
    [r.match.id]
  )
  if (!rows[0]) return null
  return { ...rows[0], match_confidence: r.match.confidence, matched_via: r.match.matched_via }
}

export async function findAreaWithCentroid(
  pool: Pool,
  areaName: string
): Promise<{ id: any; name: string; lat: number; lng: number } | null> {
  const r = await resolveArea(pool, areaName)
  if (r.status !== 'matched' || !r.match) return null
  return {
    id: r.match.id,
    name: r.match.name,
    lat: r.match.lat as number,
    lng: r.match.lng as number,
  }
}

/**
 * compare_areas 用:两个区各自解析后取指标。
 * 任一区解析不确定 → 该区直接缺席,不拿错区凑数。
 */
export async function findAreasWithMetrics(
  pool: Pool,
  area1: string,
  area2: string
): Promise<any[]> {
  const [r1, r2] = await Promise.all([resolveArea(pool, area1), resolveArea(pool, area2)])
  const ids = [r1, r2]
    .filter((r) => r.status === 'matched' && r.match)
    .map((r) => r.match!.id)
  if (!ids.length) return []

  const { rows } = await pool.query(
    `SELECT DISTINCT ON (da.id)
            da.name AS area_name,
            dam.median_price_sqm,
            dam.rental_yield_pct,
            dam.price_growth_pct,
            dam.sales_transaction_count
       FROM dubai_areas da
       JOIN dubai_area_rolling_metrics dam ON dam.dubai_area_id = da.id
      WHERE da.id = ANY($1::uuid[])
        AND dam.usage = 'residential'
        AND dam.segment = 'all'
      ORDER BY da.id, dam.period_end_month DESC, dam.id`,
    [ids]
  )
  // 保持调用方给的顺序
  const byId = new Map(rows.map((r: any) => [r.area_name, r]))
  const order = [r1, r2]
    .filter((r) => r.status === 'matched' && r.match)
    .map((r) => r.match!.name)
  return order.map((n) => byId.get(n)).filter(Boolean)
}
