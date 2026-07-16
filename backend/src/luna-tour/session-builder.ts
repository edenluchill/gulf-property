/**
 * Luna Tour — reusable session builder.
 *
 * Core logic shared by the demo seed and the parameterized generator: given a
 * set of residential project ids + an agent/client/config, it fetches real
 * facts (coords/price/image + real nearest POIs + 5yr ROI), runs the AI
 * TourScript generator, and writes lt_demo_sessions + lt_session_properties +
 * lt_tour_scripts. Lets an agent generate a tour for ANY properties, not just
 * the hardcoded demo.
 *
 * ISOLATION: only lt_* writes + read of residential_projects/dubai_pois. Delete
 * the luna-tour directory to remove.
 */
import type { PoolClient } from 'pg'
import { runAudit } from '../quality'
import { TOUR_RULES } from '../quality/tour-rules'
import pool from '../db/pool'
import {
  calculateInvestment5yr,
  calculatePaybackYears,
} from '../services/investment-calculator'
import { generateTourScript } from './tour-generator'
import { generateSessionAudio } from './audio-pipeline'
import { TourInput, TourProperty, TourPropertyUnit, TourConfig } from './tour-script.types'
import { fetchAreaContext } from './area-context'

// ⚠️ 这里曾经有两个常量:PLACEHOLDER_YIELD_PCT = 6.5 / PLACEHOLDER_GROWTH_PCT = 7。
// 它们让**每一份 tour 的每一个项目**都播报同一组编造的数字(73% / 6.5% / 15年),
// 而 AI 把它当事实讲给客户听。已删除 —— 见 buildProperty 的注释。
// **绝不要把它们加回来。** 没有真实数据就少讲一拍。

const AMENITY_SPECS = [
  { cat: 'metro_station', zh: '地铁', emoji: '🚇', ideal: 1.5, zero: 5, weight: 0.25 },
  { cat: 'school', zh: '学校', emoji: '🏫', ideal: 1.5, zero: 6, weight: 0.2 },
  { cat: 'mall', zh: '商场', emoji: '🛍️', ideal: 3, zero: 8, weight: 0.2 },
  { cat: 'hospital', zh: '医院', emoji: '🏥', ideal: 2, zero: 10, weight: 0.2 },
  { cat: 'supermarket', zh: '超市', emoji: '🛒', ideal: 1, zero: 4, weight: 0.15 },
] as const

interface ProjectRow {
  id: string
  project_name: string
  area: string | null
  latitude: string | number | null
  longitude: string | number | null
  min_price: string | number | null
  max_price: string | number | null
  status: string | null
  developer: string | null
  primary_image: string | null
  project_images: unknown
}

function num(v: string | number | null): number | undefined {
  if (v == null) return undefined
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : undefined
}

function tierOf(score100: number): string {
  return score100 >= 75 ? '优秀' : score100 >= 55 ? '良好' : score100 >= 35 ? '一般' : '偏远'
}

interface NearbyResult {
  distances: NonNullable<TourProperty['distances']>
  amenities: NonNullable<TourProperty['amenities']>
  score: number
  tier: string
}

/**
 * POI 的名字能不能说给这位客户听。
 *
 * 🔴 1,817 个 amenity POI 里有 196 个**只有阿拉伯语名**。它们原样进了中文旁白和
 *    地图标签 —— demo 里那句「🚇 地铁（صيدلية لايف）」就是这么来的
 *    （而且 صيدلية لايف 是「Life Pharmacy」,一家**药房**被标成了地铁站）。
 *
 * 名字不是这场 tour 的语言 → **丢掉名字,只说「🚇 地铁 0.9 公里」**。
 * 还是真的,只是不荒谬。宁可少说一个专名,也不能对着客户念一串他看不懂的阿拉伯字。
 */
function nameUsable(name: string | null | undefined, lang: string): boolean {
  const n = (name || '').trim()
  if (!n) return false
  if (/[؀-ۿ]/.test(n)) return false                  // 阿拉伯字母 → 一律不用
  if (lang.startsWith('zh')) return /[一-龥a-zA-Z]/.test(n)  // 中文 tour:中文或拉丁名都行
  return /[a-zA-Z]/.test(n)                                     // 英文 tour:必须有拉丁字母
}

async function fetchNearby(client: PoolClient, lng: number, lat: number, lang = 'zh'): Promise<NearbyResult> {
  let score = 0
  const amenities: NearbyResult['amenities'] = []
  const distances: NearbyResult['distances'] = []

  // 🔴 **按每个品类自己的 `zero` 半径卡死**。
  //    旧实现只有 `ORDER BY distance ASC`,**没有任何距离上限** —— 于是
  //    Palm Jebel Ali 的「最近地铁」是 11 公里外的东西,「最近学校」13 公里外,
  //    照样被当成「配套」讲给客户听。`zero` 字段一直存在,但只用来算分,从不用来过滤。
  //    （而前端的同名实现是卡了 10km 的 → 地图上画的和旁白说的根本不是同一份数据。）
  for (const s of AMENITY_SPECS) {
    const { rows } = await client.query<{ name: string; km: string; lng: string; lat: string }>(
      `SELECT name,
              ST_Distance(location::geography, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography)/1000 AS km,
              ST_X(location::geometry) AS lng, ST_Y(location::geometry) AS lat
         FROM dubai_pois
        WHERE category = $3::poi_category
          AND ST_DWithin(location::geography, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography, $4)
        ORDER BY ST_Distance(location::geography, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography) ASC
        LIMIT 1`,
      [lng, lat, s.cat, s.zero * 1000]
    )
    const hit = rows[0]
    if (!hit) continue   // 半径内根本没有 → 这个品类**整个不提**,不是硬凑一个远的上来

    const km = Number(parseFloat(hit.km).toFixed(2))
    const sub = Math.max(0, Math.min(1, (s.zero - km) / (s.zero - s.ideal)))
    score += s.weight * sub
    amenities.push({ label: s.zh, distance_km: km })

    // 名字能用就带上专名,不能用就只说品类 + 距离(仍然是真的)
    const label = nameUsable(hit.name, lang)
      ? `${s.emoji} ${s.zh}（${hit.name}）`
      : `${s.emoji} ${s.zh}`
    // cat 一并送出:label 是**会变的展示文案**,不能当数据键。
    // (前端曾用 label.includes('地铁') 找地铁 → label 一换语言,地铁行就静默消失。)
    distances.push({ label, cat: s.cat, to: [parseFloat(hit.lng), parseFloat(hit.lat)], distance_km: km })
  }

  const score100 = Math.round(score * 100)
  return { distances, amenities, score: score100, tier: tierOf(score100) }
}

/**
 * 该坐标所在区域的**真实**回报/涨幅（来自 DLD，地图一直在用的那个函数）。
 * 拿不到就返回 null —— 调用方必须**整个省略 investment**，绝不发合成常量。
 */
async function areaMetricsAt(client: PoolClient, lng: number, lat: number): Promise<{ yield_pct: number; growth_pct: number } | null> {
  try {
    // ⚠️ dubai_areas.boundary 是 **geography** —— ST_Contains 只吃 geometry，
    //    直接传 geography 会报 ParseFuncOrColumn，然后被 catch 静默吞掉 → 永远返回 null
    //    （也就是：投资数字永远不会出现）。必须显式 ::geometry。
    const { rows } = await client.query<{ y: string | null; g: string | null }>(
      `SELECT m.rental_yield_pct AS y, m.capital_growth_pct AS g
         FROM dubai_areas a
         JOIN get_dubai_area_metrics(NULL,NULL,NULL) m ON m.id = a.id
        WHERE a.boundary IS NOT NULL
          AND ST_Contains(a.boundary::geometry, ST_SetSRID(ST_MakePoint($1,$2),4326))
        LIMIT 1`,
      [lng, lat]
    )
    const y = rows[0]?.y != null ? Number(rows[0].y) : null
    const g = rows[0]?.g != null ? Number(rows[0].g) : null
    if (y == null || g == null || !Number.isFinite(y) || !Number.isFinite(g)) return null
    return { yield_pct: y, growth_pct: g }
  } catch { return null }
}

/**
 * 🔴 `metrics` = 该项目所在区域的**真实** DLD 回报/涨幅。**拿不到就传 null。**
 *
 * 旧实现用的是两个写死的常量：
 *     PLACEHOLDER_YIELD_PCT  = 6.5
 *     PLACEHOLDER_GROWTH_PCT = 7
 * 于是**每一份 tour、每一个项目**的快照都是 `growth 73 / yield 6.5 / payback 15`
 * ——16 条快照一模一样。而 AI 把它当事实播报给客户：
 *     「预计五年后价值可达 310万9593 迪拉姆，增长率高达 73%」
 *
 * 最讽刺的是 prompt 里写着「NEVER invent or estimate any number」，**而且它被严格
 * 遵守了** —— 造假发生在这里，在 TypeScript 里，然后被当作 ground truth 喂给模型。
 * **模型没有幻觉。它在忠实地为我们的造假洗白。**
 *
 * 现在：区域有真数据就用真的；**没有就整个省略 investment**，那一拍的数字直接不讲。
 * 宁可少一拍，也不能对着客户编一个五年回报。
 */
/**
 * 真实户型（按卧室数聚合）。
 *
 * 客户要买的是户型，不是「项目」。之前整场 tour 一句户型都没有 —— 讲完区域涨幅
 * 和地铁距离，客户还是不知道自己 180 万能买到什么。
 *
 * 只取有意义的行（有卧室数、且面积或价格至少有一个）。没有 → 返回 undefined，
 * 那个项目就**不讲户型这一拍**。绝不编。
 */
async function fetchUnits(
  client: PoolClient,
  projectId: string
): Promise<TourPropertyUnit[] | undefined> {
  const { rows } = await client.query<{
    bedrooms: number
    variants: string
    area_sqft: string | null
    price_from: string | null
    floor_plan_image: string | null
  }>(
    `SELECT bedrooms,
            COUNT(*)::text                        AS variants,
            MIN(area)                             AS area_sqft,
            MIN(price) FILTER (WHERE price > 0)   AS price_from,
            (ARRAY_AGG(floor_plan_image) FILTER (WHERE floor_plan_image IS NOT NULL))[1]
                                                  AS floor_plan_image
       FROM project_unit_types
      WHERE project_id = $1::uuid
        AND bedrooms IS NOT NULL
        AND (area IS NOT NULL OR price IS NOT NULL)
      GROUP BY bedrooms
      ORDER BY bedrooms`,
    [projectId]
  )
  if (!rows.length) return undefined
  // label 不再由后端拼:它以前是 `lang === 'en' ? 'Studio'/'N Bed' : '开间'/'N 房'`
  // —— **只有 en 一个分支,ar/ru/fr 全部穿透成中文**。而 bedrooms 数字就在同一个
  // 对象里,label 纯属冗余。现在交前端按 bedrooms 自己 t() 渲染(见 OverlayLayer)。
  return rows.map((r) => ({
    bedrooms: r.bedrooms,
    variants: parseInt(r.variants, 10),
    area_sqft: num(r.area_sqft) ? Math.round(num(r.area_sqft)!) : undefined,
    price_from: num(r.price_from),
    floor_plan_image: r.floor_plan_image ?? undefined,
  }))
}

function buildProperty(
  row: ProjectRow,
  real: NearbyResult,
  metrics: { yield_pct: number; growth_pct: number } | null,
  units: TourPropertyUnit[] | undefined,
  areaCtx: TourProperty['area_context']
): TourProperty {
  const lng = num(row.longitude)!
  const lat = num(row.latitude)!
  const minPrice = num(row.min_price)
  const maxPrice = num(row.max_price)
  const purchasePrice = minPrice ?? maxPrice ?? 0

  // 价格和区域数据**都**得有，才谈得上投资测算。缺任何一个 → investment: undefined。
  const inv = metrics && purchasePrice > 0
    ? calculateInvestment5yr(purchasePrice, metrics.yield_pct, metrics.growth_pct)
    : null
  const payback = metrics ? calculatePaybackYears(metrics.yield_pct) : null

  const imgs = Array.isArray(row.project_images) ? (row.project_images as unknown[]) : []
  const image = row.primary_image ?? (typeof imgs[0] === 'string' ? (imgs[0] as string) : undefined)

  return {
    id: row.id,
    name: row.project_name,
    area: row.area ?? 'Dubai',
    developer: row.developer ?? undefined,
    image,
    status: row.status ?? undefined,
    coords: [lng, lat],
    min_price: minPrice,
    max_price: maxPrice,
    investment: inv && metrics
      ? {
          buy: inv.purchase_price,
          /**
           * 抹到万位。**五年后的预测值精确到个位就是假精度** —— 旁白会念成
           * 「三百三十五万一千七百四十二迪拉姆」，既拗口又在假装我们算得准。
           * 一个五年预测，说「约 335 万」才是诚实的。
           */
          future: Math.round((inv.purchase_price + inv.total_profit_5yr) / 10000) * 10000,
          years: 5,
          growth_pct: Math.round((inv.total_profit_5yr / inv.purchase_price) * 100),
          yield_pct: metrics.yield_pct,
          payback_years: payback ?? undefined,
        }
      : undefined,
    /**
     * ⚠️ 得分 0 = **我们半径内一个 POI 都没查到**，不等于「这地方配套很差」。
     * 但它之前照样进了 prompt，于是 AI 对着客户念：
     *     「配套基建得分目前为 0」—— 然后硬拗成「顶奢海岛资产」。
     * 没有数据就闭嘴。score 0 / 没有任何距离 → 整个字段缺席，那一拍不讲配套。
     */
    amenity_score: real.score > 0 && real.distances.length ? real.score : undefined,
    amenity_tier: real.score > 0 && real.distances.length ? real.tier : undefined,
    distances: real.distances,
    amenities: real.amenities,
    units,
    area_context: areaCtx,
  }
}

export interface CreateSessionInput {
  shareCode: string
  /** residential_projects ids, in tour order (2-4 recommended) */
  projectIds: string[]
  title: string
  agentId: string
  clientId?: string | null
  client?: TourInput['client']
  config?: Partial<TourConfig>
  theme?: Record<string, unknown>
  /** Wait for narration audio to finish before resolving. CLI passes true; the
   *  HTTP path leaves it false so the request returns fast (audio backfills). */
  awaitAudio?: boolean
  /**
   * 草稿模式:**只出剧本,不烧语音,不发布**。
   *
   * 两段式生成的第一段 —— 经纪要先在时间线上看见 Luna 打算怎么讲、改完确认了,
   * 才值得为语音付钱。旧流程是一口气生成 + 立刻 TTS,经纪第一次看到成品时钱已经花了,
   * 唯一的补救是事后改文案**再烧一遍**。
   *
   * 语音在 /sessions/:id/render 里生成(见 agent-router)。
   */
  draft?: boolean
}

export interface CreateSessionResult {
  sessionId: string
  shareCode: string
  totalMs: number
  acts: number
  warnings: string[]
  /** true if audio generation was kicked off (in background unless awaitAudio) */
  audioStarted: boolean
  /** left→right tour structure node labels: 开场 → 各楼盘 → 结尾 (for the UI) */
  stops: string[]
  /** number of narrated beats audio will be generated for (progress denominator) */
  audioTotal: number
}

const DEFAULT_CONFIG: TourConfig = {
  language: 'zh',
  narrative_focus: 'investment',
  target_seconds: 165,
  banned_phrases: ['抱歉', '对不起', '无法'],
  guardrails: [
    '不要承诺或保证任何回报率或升值',
    '只陈述提供的数字,不要编造任何价格、坐标或距离',
    '距离和配套来自真实地图数据,可直接、自然地陈述(如「步行到地铁约 X 公里」)',
  ],
}

/**
 * Build + persist a full Luna Tour session for arbitrary properties.
 * Idempotent on shareCode (deletes a prior session with the same code).
 */
export async function createSession(input: CreateSessionInput): Promise<CreateSessionResult> {
  if (!input.projectIds.length) throw new Error('projectIds is empty')
  const client = await pool.connect()
  try {
    // fetch the chosen projects (preserve caller order)
    const { rows } = await client.query<ProjectRow>(
      `SELECT id::text, project_name, area, latitude, longitude, min_price, max_price,
              status, developer, primary_image, project_images
         FROM residential_projects
        WHERE id = ANY($1::uuid[]) AND latitude IS NOT NULL AND longitude IS NOT NULL`,
      [input.projectIds]
    )
    /**
     * 🚫 售罄的项目不能进 tour。
     *
     * demo 里 Palm Central 是 sold-out —— AI 只能照实说：
     *     「该项目目前处于**售罄**状态，配套基建得分目前为 0」
     * 然后硬拗成「顶奢海岛资产，具有极高的长线收藏价值」。
     * 这是在带客户看一套他买不到的房。选品阶段就该拦掉，不是靠 prompt 求它别说。
     */
    const soldOut = rows.filter((r) => (r.status ?? '').toLowerCase().includes('sold'))
    if (soldOut.length) {
      console.warn(
        `  ⚠️  跳过 ${soldOut.length} 个售罄项目(不能带客户看买不到的房): ` +
          soldOut.map((r) => r.project_name).join(', ')
      )
    }
    const byId = new Map(
      rows.filter((r) => !(r.status ?? '').toLowerCase().includes('sold')).map((r) => [r.id, r])
    )
    const ordered = input.projectIds.map((id) => byId.get(id)).filter((r): r is ProjectRow => !!r)
    if (ordered.length < 2) {
      throw new Error(`Need ≥2 usable projects with coords; got ${ordered.length} of ${input.projectIds.length}`)
    }

    // tour 的语言 —— POI 名字要按它过滤（阿语名不能念给中文客户听）
    const lang = input.config?.language || DEFAULT_CONFIG.language

    const properties: TourProperty[] = []
    for (const row of ordered) {
      const lng = num(row.longitude)!
      const lat = num(row.latitude)!
      // 真实的区域回报/涨幅（DLD）+ 半径内、名字能读的 POI。两者都可能是 null/空 ——
      // 那就少讲一拍，绝不编。
      const [real, metrics, units, areaCtx] = await Promise.all([
        fetchNearby(client, lng, lat, lang),
        areaMetricsAt(client, lng, lat),
        fetchUnits(client, row.id),
        // 地理套利 + 能被反驳的短板。成交量过不了门槛就返回 null → 那两拍不讲。
        fetchAreaContext(client, lng, lat).catch(() => null),
      ])
      properties.push(buildProperty(row, real, metrics, units, areaCtx ?? undefined))
    }

    const config: TourConfig = { ...DEFAULT_CONFIG, ...input.config }
    const tourInput: TourInput = {
      client: input.client ?? {},
      config,
      properties,
    }

    const { script, warnings } = await generateTourScript(tourInput)

    /**
     * 生产质检 —— **每一场真实生成的 tour 都体检**(不只是我手动跑测试的时候)。
     *
     * 这些规则本来就写在 tour-e2e.ts 里,而且很好(每条都是踩坑换来的:
     * 「户型卡不带数字」是因为**只要让模型填数字它就会编**),但它们从来没有
     * 作用在真实输出上 —— 我们对生产 tour 的质量一无所知。
     *
     * 分数和问题落 quality_samples(带 share_code,**可回溯到原剧本**),
     * 失败的规则进 quality.rule 指标 → **哪条最常挂,就是下一个该优化的地方**。
     * 不阻塞生成:质检挂了也不影响经纪拿到 tour。
     */
    void runAudit('luna_tour', input.shareCode, script, TOUR_RULES, {
      projects: properties.map((p) => ({
        id: p.id,
        name: p.name,
        units: (p.units || []).length,
      })),
      language: config.language,
      warnings: warnings.length,
    }).catch((e) => console.error('[quality] tour audit failed:', e))

    const theme = input.theme ?? { map_style: 'dark', accent: '#00E0B8', captions: true }
    await client.query('BEGIN')
    await client.query(`DELETE FROM lt_demo_sessions WHERE share_code=$1`, [input.shareCode])

    const sessionRes = await client.query<{ id: string }>(
      `INSERT INTO lt_demo_sessions
         (agent_id, client_id, title, share_code, status, effective_config,
          data_as_of, theme, is_published, published_at)
       VALUES ($1,$2,$3,$4,$7,$5,CURRENT_DATE,$6,$8,CASE WHEN $8 THEN now() END)
       RETURNING id`,
      [
        input.agentId, input.clientId ?? null, input.title, input.shareCode,
        JSON.stringify(config), JSON.stringify(theme),
        // 草稿:未发布 —— 分享链接在经纪确认之前不该能播
        input.draft ? 'draft' : 'published',
        !input.draft,
      ]
    )
    const sessionId = sessionRes.rows[0].id

    for (let i = 0; i < properties.length; i++) {
      const p = properties[i]
      const snapshot = {
        name: p.name, developer: p.developer, image: p.image, area: p.area, status: p.status,
        coords: p.coords, min_price: p.min_price, max_price: p.max_price, investment: p.investment,
        amenity_score: p.amenity_score, amenity_tier: p.amenity_tier, distances: p.distances, amenities: p.amenities,
        units: p.units,
        area_context: p.area_context,
      }
      await client.query(
        `INSERT INTO lt_session_properties (session_id, project_id, sort_order, snapshot)
         VALUES ($1,$2,$3,$4)`,
        [sessionId, p.id, i, JSON.stringify(snapshot)]
      )
    }

    await client.query(
      `INSERT INTO lt_tour_scripts (session_id, language, voice, script, total_ms)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (session_id, language)
       DO UPDATE SET script = EXCLUDED.script, total_ms = EXCLUDED.total_ms`,
      [sessionId, script.language, script.voice, JSON.stringify(script), script.total_ms]
    )
    await client.query('COMMIT')

    // Pre-generate narration audio (one voice = Aoede). This is HEAVY (per-beat
    // Gemini TTS + R2 upload for 11+ beats → 60–120s), so by default we do NOT
    // block the HTTP response on it — otherwise the request exceeds Cloudflare's
    // ~100s proxy timeout and the browser sees "Failed to fetch". The session is
    // already fully playable (the engine falls back to browser TTS for any beat
    // whose audio_url isn't ready yet) and audio_url backfills as clips finish.
    // CLI callers pass awaitAudio:true to wait. Done after COMMIT so a TTS hiccup
    // can never roll back a valid session.
    // 草稿模式在这里就停 —— 语音等经纪确认了再烧(POST /sessions/:id/render)
    if (input.draft) {
      return {
        sessionId,
        shareCode: input.shareCode,
        totalMs: script.total_ms,
        acts: script.acts.length,
        warnings,
        audioStarted: false,
        stops: ['开场', ...properties.map((p) => p.name), '结尾'],
        // 草稿还没烧语音 —— 数出**将要**烧几条,前端好显示进度
        audioTotal: 1 + script.acts.reduce((n, a) => n + a.beats.length, 0) + 1,
      }
    }

    const audioJob = generateSessionAudio(sessionId)
      .then((audio) =>
        console.log(
          `[luna] audio for ${input.shareCode}: ${audio.ready}/${audio.total} ready` +
            (audio.failed ? `, ${audio.failed} failed` : '')
        )
      )
      .catch((err) => console.warn('[luna] audio pre-generation skipped:', err instanceof Error ? err.message : err))
    if (input.awaitAudio) await audioJob

    return {
      sessionId,
      shareCode: input.shareCode,
      totalMs: script.total_ms,
      acts: script.acts.length,
      warnings,
      audioStarted: true,
      stops: ['开场', ...properties.map((p) => p.name), '结尾'],
      audioTotal: 1 + script.acts.reduce((n, a) => n + a.beats.length, 0) + 1,
    }
  } catch (err) {
    try {
      await client.query('ROLLBACK')
    } catch {
      /* ignore */
    }
    throw err
  } finally {
    client.release()
  }
}

/** Find-or-create an agent by email; returns its id. Links the Supabase
 *  auth_user_id when provided (real agent login). */
export async function ensureAgent(opts: {
  email: string
  displayName: string
  phone?: string
  whatsapp?: string
  photoUrl?: string
  brand?: Record<string, unknown>
  authUserId?: string
}): Promise<string> {
  // ⚠️ 关键:ON CONFLICT 时**绝不覆盖 display_name** —— 这里每个登录请求都会跑,
  // 之前用 EXCLUDED.display_name 覆盖会把经纪自己填的专业名(证书署名)每次页面加载
  // 都重置回 Google 名字。display_name 只在首次 INSERT 时用 Google 名兜底,之后由
  // 经纪自己在名片/onboarding 里改,ensureAgent 不再动它。
  const res = await pool.query<{ id: string }>(
    `INSERT INTO lt_agents (email, display_name, phone, whatsapp, photo_url, brand, auth_user_id, onboarding_done)
     VALUES ($1,$2,$3,$4,$5,$6,$7,true)
     ON CONFLICT (email) DO UPDATE SET
       auth_user_id = COALESCE(lt_agents.auth_user_id, EXCLUDED.auth_user_id)
     RETURNING id`,
    [opts.email, opts.displayName, opts.phone ?? null, opts.whatsapp ?? null, opts.photoUrl ?? null, JSON.stringify(opts.brand ?? {}), opts.authUserId ?? null]
  )
  return res.rows[0].id
}
