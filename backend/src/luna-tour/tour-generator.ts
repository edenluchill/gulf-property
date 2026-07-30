/**
 * Luna Tour — TourScript v2 generator (spec §4.2).
 *
 * ISOLATION: delete the whole backend/src/luna-tour directory to remove this
 * feature. This module only uses the @google/genai SDK + the local types; it
 * touches no app routes or existing services.
 *
 * Pipeline:
 *   1. Build a strict prompt from TourInput (narration in config.language;
 *      numbers only from input.properties; banned phrases + guardrails honored;
 *      arrival -> life -> numbers per property; total ~ target_seconds).
 *   2. Ask Gemini for JSON (PRIMARY_MODEL, fallback FALLBACK_MODEL).
 *   3. zod-parse + programmatic validation (timing within beats, references in
 *      input, total within ±20% of target). On failure, feed the errors back
 *      to the model and retry once.
 */
import { callGemini } from '../services/ai/gemini'
import { FLASH, FLASH_LITE } from '../services/ai/models'
import {
  TourScript,
  TourScriptSchema,
  TourInput,
  TourProperty,
  Beat,
  Overlay,
} from './tour-script.types'
import { areaContextFacts } from './area-context'

// Model names kept as top-level constants so they are trivial to swap.
const PRIMARY_MODEL = FLASH    // GA 旗舰(2026-05)。gemini-3-flash 是 404,3-flash-preview 已废弃
const FALLBACK_MODEL = FLASH_LITE  // 别掉回 2.5(全系 2026-10-16 关停)

const TOTAL_DURATION_TOLERANCE = 0.2 // ±20% of target_seconds

// ---------------------------------------------------------------------------
// Prompt building
// ---------------------------------------------------------------------------

/**
 * 配套聚光灯的出场顺序 —— 按**一天的用法**排,不按距离排。
 * 先是每天要走的(超市)、然后是每天要送的(学校)、通勤(地铁)、周末(商场)、
 * 最后是那个平时不想但必须有的(医院)。
 */
const POI_ORDER = ['supermarket', 'school', 'metro_station', 'mall', 'hospital'] as const

/**
 * 距离要按**人说话的精度**给它,不是按数据库的精度。
 *
 * OSRM 给的是 0.54 / 1.28 / 2.12 公里,模型照抄,旁白就念出「零点五四公里」
 * 「二点一二公里」—— 又拗口又在假装我们量到了十米级。没人这样说话:
 * 一公里以内说「约五百米」,再远说「约 1.3 公里」。
 *
 * ⚠️ 只影响**给模型看的文本**。地图上的 distance_line / amenity_spokes 标签走的是
 *    snapshot 里的原始数值,不受影响。
 */
function spokenDistance(km: number): string {
  if (!isFinite(km) || km <= 0) return '?'
  if (km < 1) return `about ${Math.max(50, Math.round((km * 1000) / 50) * 50)} m`
  return `about ${km.toFixed(1)} km`
}

function propertyFacts(p: TourProperty, opts?: { publicTour?: boolean }): string {
  const lines: string[] = []
  lines.push(`- id: ${p.id}`)
  lines.push(`  name: ${p.name}`)
  lines.push(`  area: ${p.area}`)
  if (p.developer) lines.push(`  developer: ${p.developer}`)
  if (p.status) lines.push(`  status: ${p.status}`)
  lines.push(`  coords (lng,lat): [${p.coords[0]}, ${p.coords[1]}]`)
  if (p.min_price != null) lines.push(`  min_price: ${p.min_price}`)
  if (p.max_price != null) lines.push(`  max_price: ${p.max_price}`)
  /**
   * 🔴 公开导览**根本不给它看 5 年测算**。
   *
   * prompt 里写「不许讲预测」是不够的 —— 上一次审计的结论就是「ROI 数字全是编的,
   * 而且被当事实播报」。而这些页面是公开的、会被搜索引擎和 AI 爬走的,
   * 说错一个开发商项目的收益预测不是丢人,是责任。
   *
   * **「LLM 会违反 prompt,代码不会。」** 看不到的数字它编不出来。
   */
  if (p.investment && !opts?.publicTour) {
    const i = p.investment
    lines.push(
      `  investment (5yr): buy ${i.buy} -> future ${i.future} over ${i.years} yrs | ` +
        `growth ${i.growth_pct}%` +
        (i.yield_pct != null ? ` | yield ${i.yield_pct}%` : '') +
        (i.payback_years != null ? ` | payback ${i.payback_years} yrs` : '')
    )
  }
  if (p.amenity_score != null) {
    /**
     * ⚠️ 分数**低于 70 就别念出来**。
     *
     * 实测旁白:「该项目生活配套得分**四十三分**」—— 主动把一个 43/100 报给客户,
     * 是在替自己拆台。而且这个分是**我们自己合成的**,客户根本没有参照系。
     *
     * 但 amenity_spokes overlay 需要它 → 不能不给,只能**明确标记不许念**。
     * (prompt 也写了规则,这里是双保险 —— 「LLM 会违反 prompt,代码不会」。)
     */
    /**
     * 公开导览里**任何分数都不许念**,高分也不行。
     * 实测公开版第一稿开口就是「这里的综合配套评测拿到了高分」—— 那是**我们自己合成的
     * 一个分**,客户没有参照系,而在一个公开页面上它读起来像一份权威评级。
     * 真实距离本来就更有说服力,而且是可核对的。
     */
    const weak = p.amenity_score < 70 || opts?.publicTour
    lines.push(
      `  amenity_score: ${p.amenity_score}${p.amenity_tier ? ` (${p.amenity_tier})` : ''}` +
        (weak
          ? ' [FOR THE amenity_spokes OVERLAY ONLY. Do NOT say this number or any rating' +
            ' word ("高分"/"评测"/"tier") in the narration, and do NOT characterise the area' +
            ' as well- or poorly-served. Narrate the real distances below instead — they' +
            ' are concrete and let the viewer judge.]'
          : '')
    )
  }
  if (p.distances?.length) {
    for (const d of p.distances) {
      // cat + name 是结构化真值;`label` 只有历史 session 才有(那是拼死的中文)。
      // name 已过地名防线 —— 没有就是「不能给这个语言的客户看」,别硬塞回去。
      const what = d.cat ? (d.name ? `${d.cat} (${d.name})` : d.cat) : d.label
      lines.push(
        `  distance: "${what}" = ${spokenDistance(d.distance_km)}, to [${d.to[0]}, ${d.to[1]}]` +
          `${d.placeholder ? ' [PLACEHOLDER — approximate, do not state as exact]' : ''}`
      )
    }
  }
  if (p.amenities?.length) {
    for (const a of p.amenities) {
      lines.push(
        `  amenity: "${a.label}" = ${spokenDistance(a.distance_km)}` +
          `${a.placeholder ? ' [PLACEHOLDER]' : ''}`
      )
    }
  }
  /**
   * 区域对比 —— 地理套利 + 能被反驳的短板。没有就整个不出现，那两拍跳过。
   *
   * 🔴 **公开导览拿不到它。** 里面是涨幅/成交量/单价对比,而它们一进旁白就变成
   * 「隔壁涨 12.1%、这里 10.9%,但成交量是八倍,变现时永远有充沛买盘支撑」——
   * 实测第一稿原话。数字是真的(DLD),但那三句话合起来是**投资建议**,
   * 而这是一个任何人都能打开、会被 AI 爬走的页面。
   * 公开版的「实话」那一拍改用真实距离讲「这个盘不适合谁」,不碰涨幅。
   */
  if (p.area_context && !opts?.publicTour) {
    lines.push(...areaContextFacts(p.area_context as never))
  }
  // 户型 —— 客户真正要买的东西。没有就整个不出现，那个项目跳过 homes 拍。
  if (p.units?.length) {
    for (const u of p.units) {
      lines.push(
        `  unit: ${u.label} (bedrooms=${u.bedrooms}, ${u.variants} layout(s))` +
          (u.area_sqft != null ? ` | from ${u.area_sqft} sqft` : '') +
          (u.price_from != null ? ` | from AED ${u.price_from}` : '') +
          (u.floor_plan_image ? ' | has floor plan' : '')
      )
    }
  }
  return lines.join('\n')
}

/**
 * 把旁白里的原始数字换成**人话**。
 *
 * 实测 demo 的旁白：
 *   「购入价 **1800000** 迪拉姆，预计 5 年后价值可达 **3351742** 迪拉姆」
 * 没有人这么说话，读出来更是一串数字噪音。中文该说「180 万」，英文该说
 * 「1.8 million」。
 *
 * ⚠️ 只动 ≥10000 的整数（价格量级）。百分比、年数、公里数、门牌号都不碰。
 * 在 validateTourScript 里对所有 beat 跑一遍 —— 字幕和 TTS 读的是同一个字符串，
 * 所以一处改两处受益。
 */
export function humanizeNumbers(text: string, lang: string): string {
  return text.replace(/\d{5,}/g, (raw) => {
    const n = parseInt(raw, 10)
    if (!Number.isFinite(n) || n < 10000) return raw
    const trim = (x: number) => String(parseFloat(x.toFixed(x < 10 ? 2 : 1)))
    if (lang.startsWith('zh')) {
      if (n >= 1e8) return `${trim(n / 1e8)}亿`
      return `${trim(n / 1e4)}万`
    }
    if (n >= 1e6) return `${trim(n / 1e6)} million`
    return n.toLocaleString('en-US')
  })
}

function buildPrompt(input: TourInput, repairNote?: string): string {
  const { client, config, properties } = input
  const targetMs = config.target_seconds * 1000
  const banned = config.banned_phrases?.length
    ? config.banned_phrases.join(', ')
    : '(none)'
  const guardrails = config.guardrails?.length
    ? config.guardrails.map((g, i) => `${i + 1}. ${g}`).join('\n')
    : '(none)'
  /**
   * 公开的单楼盘导览(`/tours` 目录 + 项目详情页的入口)。
   * 内容合约比经纪版严得多 —— 见 TourConfig.variant 和下面的 PUBLIC 段落。
   */
  const isPublic = config.variant === 'project'
  const facts = properties.map((p) => propertyFacts(p, { publicTour: isPublic })).join('\n')
  const ids = properties.map((p) => p.id).join(', ')

  /**
   * ⭐ 开场机位 —— **算给它，别让它猜**。
   *
   * demo 实测：intro 的 center 是**第一个项目**的坐标，而三个项目分散在整个迪拜
   * （d3 在东北、Palm Central 在西南）—— 所以开场根本看不到全局，客户不知道自己在哪儿。
   * 而 zoom 是 10（LLM 拍脑袋定的），跟项目的实际分布没有任何关系。
   *
   * establishing shot 的全部意义就是「先让他看见自己在哪儿」。这是纯几何，
   * LLM 算不好也不该由它算。
   */
  const lngs = properties.map((p) => p.coords[0])
  const lats = properties.map((p) => p.coords[1])
  const cLng = (Math.min(...lngs) + Math.max(...lngs)) / 2
  const cLat = (Math.min(...lats) + Math.max(...lats)) / 2
  const spanDeg = Math.max(Math.max(...lngs) - Math.min(...lngs), Math.max(...lats) - Math.min(...lats))
  // 经验值：让整个项目群 + 一点余量落在画面里。跨度越大，zoom 越小。
  const introZoom =
    spanDeg > 0.30 ? 9.6 :
    spanDeg > 0.18 ? 10.2 :
    spanDeg > 0.10 ? 10.9 :
    spanDeg > 0.05 ? 11.6 : 12.4
  const establishing =
    `ESTABLISHING SHOT (use these EXACT values for the intro's first keyframe — they are\n` +
    `computed to fit ALL properties on screen; do NOT invent your own):\n` +
    `  center: [${cLng.toFixed(5)}, ${cLat.toFixed(5)}]\n` +
    `  zoom: ${introZoom}   (the intro may push in to ~${(introZoom + 1.2).toFixed(1)}, no further)\n` +
    `  pitch: 45, bearing: 0`
  const clientLabel =
    [client.name && `name=${client.name}`, client.persona && `persona=${client.persona}`,
      client.goal && `goal=${client.goal}`, client.nationality && `nationality=${client.nationality}`]
      .filter(Boolean)
      .join(', ') || '(generic buyer)'

  /**
   * 🔴 公开导览的内容合约。
   *
   * 这些页面**任何人都能打开**,而且 robots.txt 放行了答案型 AI 爬虫 ——
   * 等于我们在替一个真实开发商的项目做公开陈述。所以:
   *   • 没有「客户」,不许出现任何人名、身份、预算、目的
   *   • 零预测、零回报率、零「值得投资/极具潜力」—— 只讲有出处的事实
   *   • 主线是**地理**:这个盘在哪、周围有什么、走过去多远、能买到什么户型
   * 上一次审计的结论是「ROI 数字全是编的且被当事实播报」;那放在经纪的私下 demo 里
   * 只是丢人,放在公开页面上是责任。(代码层面也没给它 investment 数据。)
   */
  const publicContract = [
    'AUDIENCE: this is a PUBLIC, evergreen tour of ONE project. Anyone can open it;',
    'search engines and AI crawlers index it. There is NO specific client.',
    '⛔ NEVER address a named person, and never mention a budget, nationality, persona',
    '   or goal. Speak to "you" as any curious buyer would be addressed.',
    '⛔ NEVER forecast, project, annualise or characterise returns. No "升值潜力",',
    '   no "值得投资", no yields, no 5-year numbers, no "prices will rise".',
    '   You have not been given any investment figures — do not invent any.',
    '⛔ NEVER use the `roi_card` or `area_compare` overlays. They do not exist for you.',
    '⛔ NEVER say a PERCENTAGE of any kind, and never compare this area\'s price growth,',
    '   transaction volume or resale liquidity with anywhere else. Not even with real',
    '   numbers — "隔壁涨 12.1%，这里 10.9%，但成交量是八倍" is investment advice',
    '   dressed as a fact, and this page is public.',
    '⛔ NEVER quote a score, rating or tier of ours (e.g. "配套评测高分"). We invented',
    '   that number; on a public page it reads as an official rating. Say the distances.',
    '✅ DO narrate GEOGRAPHY and what is verifiably there: where this project sits,',
    '   what surrounds it, the REAL distances given below, and the REAL layouts and',
    '   starting prices from the `unit:` lines. A buyer who has never been to Dubai',
    '   should finish knowing WHERE this is and WHAT DAILY LIFE around it looks like.',
    '✅ DO say plainly who this project is NOT for. That is what makes the rest credible',
    '   — and on a public page it is the difference between a guide and an ad.',
    '',
    '🎙 VOICE — speak from the VIEWER\'S side of the table, not the developer\'s.',
    '   The viewer is standing in front of a map wondering "what would MY life be here?".',
    '   So narrate what HE does, sees and walks to — in second person ("你"/"you").',
    '   ⛔ NOT brochure voice: "项目由知名开发商倾力打造，坐落于繁华核心，标志性都市水岸',
    '      生活方式" — that is the developer talking about itself. Cut every adjective',
    '      that a salesperson would use and a resident would not.',
    '   ✅ Resident voice: "从这里出门左转，走五分钟就是超市" / "孩子上学在一公里出头，',
    '      开车三四分钟" / "要去机场，你得先上谢赫扎耶德路".',
    '   Rule of thumb: if the sentence could appear unchanged in the developer\'s own ad,',
    '   rewrite it. Say what the viewer would DO, not how remarkable the project is.',
  ].join('\n')

  return [
    'You are Luna, a cinematic real-estate tour director. You produce ONE',
    'TourScript v2 JSON object that drives a map-based guided video tour.',
    '',
    isPublic ? publicContract : `CLIENT: ${clientLabel}.`,
    `LANGUAGE: write ALL narration strings in "${config.language}".`,
    `NARRATIVE FOCUS: lean the story toward "${config.narrative_focus}".`,
    `TARGET TOTAL DURATION: about ${config.target_seconds} seconds (${targetMs} ms).`,
    '',
    'HARD DATA RULES (must follow exactly):',
    '- Use ONLY the coordinates, prices, distances and investment numbers given',
    '  below. NEVER invent or estimate any number, coordinate, price, distance',
    '  or percentage. If a figure is not provided, do not mention it.',
    '- Items tagged [PLACEHOLDER] are approximate references — speak of them',
    '  loosely (e.g. "about a few minutes away"), never as precise facts.',
    '- Every camera "center"/"to"/"from" coordinate must appear in the data',
    `  below. Every overlay property_id / property_ids value must be among: ${ids}.`,
    '- For each property produce beats in this order: kind="arrival", then',
    '  kind="life", then kind="homes" (ONLY if that property has `unit:` lines in',
    '  the data — otherwise SKIP it entirely), then kind="numbers". Wrap each',
    '  property in one act with that property\'s id as the act "property_id".',
    '- ⛔ NEVER state a figure the data does not give you, and NEVER describe the',
    '  ABSENCE of data as a fact about the property. If there is no amenity_score,',
    '  do not say the area scores zero or "lacks amenities" — say nothing about it',
    '  and spend the words on what you DO have.',
    '- ⛔ NEVER name the beat or the section out loud. "地理套利" / "arbitrage" /',
    '  "短板" / "weakness" / "numbers beat" are OUR internal labels — a real agent',
    '  does not announce "now, the geographic-arbitrage section". Just SAY the thing:',
    '  "0.5 公里外的 Motor City，单价比这里贵 26%，涨幅是 0。" No preamble.',
    '- Speak numbers the way a person speaks them, not as raw digits. In Chinese',
    '  say「180 万」not「1800000」; in English say "1.8 million". Areas and per-area',
    '  prices are already sqft — say them as given, never convert to sqm/平米.',
    '- ⛔ NEVER mention a search radius or "within X metres/km" as a framing. The',
    '  radius is OUR implementation detail — the client does not care how wide we',
    '  looked. Say "the mall is 1.4 km away", never "within a 10,000-metre radius,',
    '  the mall is 1.4 km away". It makes 1.4 km sound like a technicality.',
    '- ⛔ amenity_score: state it ONLY when it is 70+. It is a composite WE made up;',
    '  reading out "this area scores 43" is arguing against your own listing. Below',
    '  70, drop the score entirely and speak the REAL distances instead (they are',
    '  concrete and the client can judge them). Never invert this into a negative',
    '  claim either — just talk about something else that IS true and good.',
    `- BANNED PHRASES (must never appear in any narration): ${banned}.`,
    '- GUARDRAILS (must respect):',
    guardrails,
    '',
    'STRUCTURE (TourScript v2):',
    '{ "version": 2, "voice": "Aoede", "language": <lang>, "total_ms": <int>,',
    '  "theme": { "map_style": "dark", "accent": "#00E0B8", "captions": true },',
    '  "intro": <Beat>, "acts": [ <Act>... ], "outro": <Beat> }',
    'Act = { "id", "property_id", "beats": [<Beat>...], "transition_out"?:',
    '  { "type":"flyover"|"cut", "duration_ms", "narration": null } }',
    'Beat = { "id", "kind"?, "narration", "duration_ms", "camera": [...], "overlays": [...] }',
    '',
    'CAMERA VOCABULARY — you are the cinematographer. These are your moves:',
    '  keyframe { at_ms, center?, zoom?, pitch?, duration_ms, easing? }',
    '      A pose. duration_ms: 0 = a CUT to that pose (use for the establishing shot).',
    '      ⛔ Do NOT set `bearing` — rotation comes ONLY from `orbit` (below).',
    '  flyover { type:"flyover", at_ms, from:[lng,lat], to:[lng,lat], duration_ms }',
    '      Travel between two places. The engine automatically arcs up just enough',
    '      that BOTH points are in frame mid-flight, then descends. You do not',
    '      author the arc. Keep it ≤2500ms — travel is dead time, information',
    '      lives at the destination.',
    '  orbit { type:"orbit", at_ms, center:[lng,lat], degrees, duration_ms }',
    '      Circle a point. THIS is how you show a building in the round and reveal',
    '      what surrounds it. 60–150°, 4000–8000ms. Slow.',
    '  push { type:"push", at_ms, zoom_delta, duration_ms }',
    '      Dolly in/out IN PLACE (centre unchanged). +0.5 to +1.2 tightens attention;',
    '      -0.5 to -1.0 opens up context. The cheapest way to keep a shot alive.',
    '  crane { type:"crane", at_ms, pitch?, zoom?, duration_ms }',
    '      Rise/descend IN PLACE. Raising pitch (→55) hugs the ground and makes',
    '      towers feel tall; lowering it (→25) reads the street grid from above.',
    'easing ∈ linear | easeIn | easeOut | easeInOut.',
    '',
    '⭐ MOTION GRAMMAR — the camera must be ALIVE. A frozen map is a dead demo.',
    '   Rule of thumb: EVERY beat carries motion, EXCEPT when the viewer is reading',
    '   a number. Motion is how you hold attention; stillness is how you let them read.',
    '   Chain moves inside one beat (they run back to back — at_ms in order):',
    '',
    '   • intro   — ⚠️ DO NOT author the opening camera. The app computes it from the',
    '               real viewport geometry (high aerial that frames every property,',
    '               then a slow orbit lasting exactly as long as your greeting) and',
    '               REPLACES whatever you write here. Emit just the establishing',
    '               keyframe (duration_ms: 0) so the storyboard reads correctly, and',
    '               spend your effort on the narration. Same for `outro`.',
    '   • arrival — flyover to the property (≤2500ms), then immediately a crane',
    '               (pitch→50) or push (+0.5) so the arrival keeps breathing.',
    '   • life    — SLOW orbit (60–100°, 5000–7000ms) around the property while the',
    '               distance lines draw. This is exactly the beat where circling',
    '               EARNS its keep: the client is being shown WHAT IS AROUND them.',
    '   • homes   — orbit again (80–150°, 6000–8000ms), slower and tighter. The client',
    '               is deciding which home is theirs; let them see it from every side',
    '               and see the neighbourhood turning behind it. NEVER hold still here.',
    '   • arbitrage — crane UP (pitch→30, zoom out ~1.0) so the neighbouring districts',
    '               are all on screen. The comparison IS the shot.',
    '   • weakness — ⛔ HOLD. Dead still. He is being told the truth; do not distract him.',
    '   • numbers — ⛔ HOLD. No orbit, no flyover. At most a barely-there push (+0.3).',
    '               They are reading a chart. Moving the map now competes with the',
    '               number and they will remember neither.',
    '   • outro   — crane up + push out (-0.8) to see all the homes together.',
    '',
    'OVERLAY types (each has "at_ms" and usually "duration_ms"):',
    '  title { text, subtitle? }',
    '  progress_dots { total, active }',
    '  property_card { property_id, fields? }',
    '  distance_line { property_id?, to:[lng,lat], label, anim:"draw" }',
    '  amenity_spokes { property_id?, center:[lng,lat], score, tier?, spokes?:[{label,distance_km}], anim:"pop" }',
    '  roi_card { property_id?, anim:"countup", data:{ buy, future, years, growth_pct, yield_pct? } }',
    '  area_compare { property_id }   ← the arbitrage beat. Carries NO numbers: the',
    '    app renders the real neighbour table from its own data. (Same rule as',
    '    unit_card — give the model a number field and it WILL invent numbers.)',
    '  unit_card { property_id, focus_bedrooms? }   ← the homes beat. Carries NO',
    '    numbers: the app renders the real layouts/areas/prices/floor plans from',
    '    its own data. You only choose WHICH property and which bedroom count to',
    '    highlight (the one that fits this client — omit focus_bedrooms if unsure).',
    '  highlight_all_pins { property_ids:[...] }',
    '  favorite_picker { property_ids:[...] }',
    '  cta { text?, agent?, channel?, prefill? }',
    '',
    'TIMING RULES:',
    '- Inside every beat each camera/overlay must satisfy',
    '  at_ms >= 0 AND at_ms + duration_ms <= beat.duration_ms.',
    '- total_ms MUST equal the sum of intro.duration_ms + every act beat',
    '  duration_ms + outro.duration_ms (transition_out durations are NOT summed).',
    `- total_ms must be within ±${Math.round(TOTAL_DURATION_TOLERANCE * 100)}% of ${targetMs} ms.`,
    '',
    'CAMERA GRAMMAR (hard rules):',
    '- ⛔ TRAVEL (flyover / a keyframe that changes centre) must be ≤2500 ms. Flying',
    '  over empty desert teaches the viewer NOTHING — it is dead air. The engine',
    '  already arcs up just enough to keep both endpoints in frame; do not stretch it.',
    '- ✅ DWELLING (orbit / push / crane) SHOULD be long — 4000–8000 ms. This is not',
    '  wandering: the camera is holding on ONE subject and revealing it. A slow orbit',
    '  around the home while you describe what surrounds it is the single most',
    '  cinematic thing you can do. Use it on `life` and `homes`.',
    '- ⛔ Never move the camera while the narration is explaining a NUMBER. On the',
    '  `numbers` beat the camera holds still and they read.',
    '- ⛔ Never write `bearing` on a keyframe. Rotation comes ONLY from `orbit`. A map',
    '  that slowly rotates for no reason reads as aimless drifting.',
    '- Vary beat lengths and vary the MOVE. Do not orbit every single beat at the same',
    '  speed — that metronome is what makes it feel like software instead of film.',
    '',
    establishing,
    '',
    'COMPOSITION GUIDANCE:',
    '- intro: ONE keyframe = the ESTABLISHING SHOT above (duration_ms: 0). No push,',
    '  no orbit — the app owns the opening move (see the intro note above). Overlays:',
    '  title with the client name, progress_dots, and highlight_all_pins.',
    '- arrival beat: ONE short flyover (≤2500 ms) to the property, then a crane or',
    '  push so the shot keeps breathing.',
    '  ⭐ The property_card overlay MUST have at_ms = 0 — it appears the INSTANT',
    '  the beat starts, and stays for the whole beat. The viewer must never be',
    '  looking at a moving map with no information on screen.',
    '- life beat: distance_line / amenity_spokes overlays for that property. The',
    '  camera MAY fly to the amenity (metro/school) and back — that is exactly the',
    '  case where motion carries the message. Keep each leg ≤4000 ms.',
    '- homes beat: unit_card overlay, at_ms = 0. Camera HOLDS STILL. This is the',
    '  beat where the client finally learns WHAT THEY CAN BUY — until now they have',
    '  heard about an area, not a home. Narrate the layouts that fit THIS client',
    '  (their budget, their family), name the bedroom counts and say why that one',
    '  suits them. Use only the `unit:` lines given for this property.',
    '- arbitrage beat ⭐ (地理套利 — the single most persuasive thing a MAP can do,',
    '  and a PDF brochure never can): overlay `area_compare` { property_id }, at_ms 0.',
    '  Camera cranes UP so the neighbouring areas are all in frame.',
    '  The investor does not want to know "how much does this project grow". He wants',
    '  to know "WHY HERE and not the district a 5-minute walk away". Answer THAT.',
    '  Use the `area_self:` and `area_neighbor:` lines. Name the neighbour, its',
    '  distance, and the number that makes the case. Be concrete and blunt, e.g.',
    '  "0.5 km away, Motor City costs 26% MORE per sqft — and grew 0%."',
    '- weakness beat ⭐ (它的短板 — honesty, but ARMED): overlay: none needed.',
    '  Camera HOLDS STILL — this is a moment of eye contact, not scenery.',
    '  Say `weakness_claim:` FIRST, plainly, no hedging. Then say `weakness_rebuttal:`.',
    '  ⛔ You MUST NOT soften the claim, and you MUST NOT omit the rebuttal.',
    '  Why: a stated flaw WITHOUT a refutation is WORSE than saying nothing (Allen).',
    '  What works is INOCULATION — you are vaccinating the client against what the',
    '  NEXT agent will say to him. He will hear "JVC grows slower" from someone else;',
    '  he should hear it from YOU first, with the answer already attached.',
    '  End by naming who this is NOT for. That is what makes the rest believable.',
    '- numbers beat: roi_card overlay, at_ms = 0. Camera HOLDS STILL. Numbers are',
    '  read, not flown over.',
    '- outro: pull back, highlight_all_pins + favorite_picker + cta.',
    '',
    /**
     * 单楼盘公开版的结构 —— **写死**,不让模型自由发挥。
     *
     * 理由和开场机位一样:这 53 条导览是产品的门面,不能每条都碰运气。
     * 而且 60~90 秒里只装得下四拍,让它自己挑必然会漏掉「周边环境」那一拍 ——
     * 而那一拍正是地图能做、楼书做不到的唯一一件事。
     */
    isPublic
      ? [
          '════════ PUBLIC SINGLE-PROJECT STRUCTURE (this OVERRIDES the act/beat guidance above) ════════',
          'EXACTLY ONE act, for the one project below. `acts[0].property_id` = that id.',
          'These beats, in this order, and NOTHING else (the middle block repeats per neighbour):',
          '  1. id "arrival"  kind "arrival"  ~14000ms',
          '     Where it is, in words a stranger to Dubai understands: name the area and',
          '     anchor it to something famous from the `poi:`/`dist:` lines. Then the',
          '     developer and the entry price (min_price) — plainly, no adjectives.',
          '     Camera: ONE flyover (≤2500ms) to the coords, then a push (+0.5).',
          '     Overlay: property_card at_ms 0.',
          `  2. ⭐ THE POINT OF THE WHOLE TOUR — ONE BEAT PER NEIGHBOUR, NOT ONE LIST.`,
          `     Emit one beat for EACH of these categories, in this exact order, skipping any`,
          `     that is not in the data: ${POI_ORDER.join(', ')}.`,
          `     id "nearby_<cat>", kind "nearby", ~11000ms each. Overlay: exactly one`,
          `     poi_spotlight { cat: "<cat>" } at_ms 0 — and NOTHING else on that beat.`,
          `     ⛔ The overlay carries ONLY \`cat\`. No name, no distance, no coordinates —`,
          `        the app fills those in from real data. Do not put numbers in overlays.`,
          `     ⛔ NO amenity_spokes and NO distance_line anywhere: the app draws the single`,
          `        line to that one place and frames the camera so you can SEE both ends.`,
          `     Camera: leave \`camera\` as [] — the app computes the framing per neighbour.`,
          `     Narration: ONE or TWO sentences about THAT place only, from the viewer's side`,
          `     — what he'd use it for and how he'd get there (walk / short drive), using the`,
          `     real distance. Do not mention the other categories in this beat.`,
          `     WHY one at a time: five distances read out in one breath ("超市 550 米、学校`,
          `     1.3 公里、医院 1.7、商场 1.8、地铁 2.1") leaves the viewer remembering none of`,
          `     them, and the map shows a fan of anonymous lines. One place, named and`,
          `     labelled, is something he can actually picture.`,
          '  3. id "homes"    kind "homes"    ~20000ms',
          '     What you can actually buy: bedroom counts, sizes, starting prices —',
          '     ONLY from the `unit:` lines. Say which layout suits which kind of household.',
          '     Camera: slower, tighter orbit (60–90°). Overlay: unit_card at_ms 0.',
          '  4. id "truth"    kind "weakness" ~13000ms',
          '     `weakness_claim:` plainly, then `weakness_rebuttal:`. If neither is given,',
          '     instead say who this project is NOT for, based on the real distances',
          '     (e.g. no metro within 3km → not for someone without a car).',
          '     Camera: HOLD. Overlay: none.',
          'Then `outro` (~8000ms): one sentence inviting a question, cta overlay. NO favorite_picker.',
          '`intro` still exists but keep it ONE keyframe + ONE short line naming the project',
          'and its area — the app replaces the opening camera anyway.',
          '⛔ NO arbitrage beat, NO numbers beat, NO roi_card, NO area_compare.',
          '',
        ].join('\n')
      : '',
    'PROPERTY DATA:',
    facts,
    '',
    repairNote
      ? `PREVIOUS ATTEMPT WAS INVALID. Fix EXACTLY these problems and regenerate:\n${repairNote}`
      : '',
    '',
    'Return ONLY the TourScript JSON object. No markdown fences, no commentary.',
  ]
    .filter(Boolean)
    .join('\n')
}

// ---------------------------------------------------------------------------
// Gemini call
// ---------------------------------------------------------------------------

function stripJsonFence(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  return (fenced ? fenced[1] : trimmed).trim()
}

async function callModel(prompt: string): Promise<unknown> {
  try {
    const { text } = await callGemini({
      task: 'tour-generator',
      models: [PRIMARY_MODEL, FALLBACK_MODEL],
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        temperature: 0.7,
        /**
         * 🔴 **thinking 是按 output 价计费的**($9/1M) —— 不设就是默认全开。
         *
         * 剧本生成确实需要一点规划(编排 12 拍的节奏、决定哪一拍讲什么),
         * 所以不能像抽取任务那样设 'minimal'。'low' 是权衡:留一点推理,
         * 但不让它为了"想周全"烧掉几千个 output token。
         *
         * ⚠️ Gemini 3.x 是 `thinkingLevel`,**不是 `thinkingBudget`**(那是 2.5 的,
         *    写错会被**静默忽略**)。
         */
        thinkingConfig: { thinkingLevel: 'low' },
      },
    })

    if (!text.trim()) throw new Error('empty response')
    return JSON.parse(stripJsonFence(text))
  } catch (err) {
    throw new Error(
      `Gemini generation failed for both ${PRIMARY_MODEL} and ${FALLBACK_MODEL}: ` +
        (err instanceof Error ? err.message : String(err))
    )
  }
}

// ---------------------------------------------------------------------------
// Programmatic validation (beyond zod shape)
// ---------------------------------------------------------------------------

function overlayPropertyRefs(o: Overlay): string[] {
  if ('property_id' in o && o.property_id) return [o.property_id]
  if ('property_ids' in o && o.property_ids) return o.property_ids
  return []
}

/**
 * ⭐ 镜头硬约束 —— **在代码里 clamp，不要指望 prompt**。
 *
 * 实测 demo 的 arrival beat：flyover **8000ms** + orbit **180° / 7000ms**。
 * 也就是说客户到了一个项目，先看 8 秒钟的飞行（画面里是一片模糊的沙地），
 * 再绕着一栋**还没盖的楼**转 7 秒。**卡片要到第 8 秒才出现**。
 * 15 秒里有 8 秒是纯粹的虚无。
 *
 * 规则（依据见 docs/reports/2026-07-12-buyer-commitment-guided-tour-research.md §6）：
 *   · 任何镜头运动 ≤ 4000ms（Cesium 给**每一次**飞行的硬上限是 3 秒）
 *   · orbit ≤ 120°（180° 是在绕着空地转圈）
 *   · **property_card / roi_card 一律 at_ms = 0** —— 观众绝不能对着一张移动的、
 *     没有任何信息的地图发呆
 *
 * LLM 会违反 prompt。代码不会。
 */
/**
 * 🔴 转场飞行 ≤ 2 秒（owner 2026-07-12 定）。
 *
 * 跨项目的 flyover 会走 van Wijk 的最优曲线 —— 它**自动拉高再落下**。
 * 从 113 RESIDENCES 飞到 Palm Central 跨了半个迪拜，于是就成了
 * 「**弹远又弹近**」，而中间那几秒画面里什么信息都没有。压到 2 秒。
 */
/**
 * 每一类运镜**各自的上限** —— 不再一刀切。
 *
 * 之前所有 cue 一律压到 2 秒(包括 orbit),等于把 orbit 判了死刑。
 * 但 owner 要的从来不是「不许动」,而是「**不许无意义地动**」:
 *   • **移动**(flyover/keyframe)要短 —— 跨越途中画面里没有信息,那是死时间
 *   • **原地的动**(orbit/push/crane)可以长 —— 它们让观众**看清眼前这个东西**,
 *     那正是摄影师的活:环绕看周边、缓缓推近、抬起来看全貌
 */
const MAX_MOVE_MS = 2500     // flyover / 带 center 的 keyframe:移动要利落
const MAX_DWELL_MS = 8000    // orbit / push / crane:原地的动可以从容
const MAX_ORBIT_DEG = 150    // 一圈半以上就晕了
const MAX_PUSH_DELTA = 1.5   // 推轨幅度

export function clampCinematography(beat: Beat): void {
  for (const c of beat.camera) {
    const t = (c as unknown as { type?: string }).type

    if (t === 'orbit') {
      // 🔴 orbit 回来了 —— 但它必须是**剧本作者化写下的动作**,而不是引擎每帧偷偷加的自转。
      //    (引擎里那条 3°/秒 的全局强制旋转已经删掉,见 TimelineEngine 的注释。)
      const o = c as unknown as { degrees: number; duration_ms: number }
      o.degrees = Math.max(-MAX_ORBIT_DEG, Math.min(MAX_ORBIT_DEG, o.degrees))
      o.duration_ms = Math.min(o.duration_ms, MAX_DWELL_MS)
      continue
    }
    if (t === 'push') {
      const p = c as unknown as { zoom_delta: number; duration_ms: number }
      p.zoom_delta = Math.max(-MAX_PUSH_DELTA, Math.min(MAX_PUSH_DELTA, p.zoom_delta))
      p.duration_ms = Math.min(p.duration_ms, MAX_DWELL_MS)
      continue
    }
    if (t === 'crane') {
      c.duration_ms = Math.min(c.duration_ms, MAX_DWELL_MS)
      continue
    }

    /**
     * flyover / keyframe = **移动**。移动途中画面里没有信息,那是死时间。
     * 跨项目 flyover 走 van Wijk 曲线会自动拉高再落下 —— 拖长了就成了「弹远又弹近」。
     */
    c.duration_ms = Math.min(c.duration_ms, MAX_MOVE_MS)
  }

  for (const o of beat.overlays) {

    // 信息卡从第一帧就在 —— 它是这一拍的主角,不是迟到的注脚
    if ((o.type === 'property_card' || o.type === 'roi_card') && o.at_ms > 0) {
      const wanted = beat.duration_ms - 0
      o.duration_ms = Math.min(o.duration_ms ?? wanted, wanted)
      o.at_ms = 0
    }
  }
}

function withinBeat(beat: Beat): string[] {
  const errs: string[] = []
  const limit = beat.duration_ms
  for (const c of beat.camera) {
    const end = c.at_ms + c.duration_ms
    if (end > limit) {
      errs.push(
        `beat "${beat.id}": camera at_ms(${c.at_ms})+duration(${c.duration_ms})=${end} exceeds beat duration ${limit}`
      )
    }
  }
  for (const o of beat.overlays) {
    const end = o.at_ms + (o.duration_ms ?? 0)
    if (end > limit) {
      errs.push(
        `beat "${beat.id}": overlay "${o.type}" at_ms(${o.at_ms})+duration(${o.duration_ms ?? 0})=${end} exceeds beat duration ${limit}`
      )
    }
  }
  return errs
}

/**
 * 🔴 **bearing 只有一个来源:显式的 orbit。**
 *
 * 之前的坑:LLM 喜欢给每个 keyframe 写不同的 bearing（它觉得「有电影感」）。
 * clampCinematography 只锁**一拍之内**,拍与拍之间仍然不同 → 引擎平滑插值
 * → **整场 tour 慢慢转 80°**,而它什么信息都没传达。
 *
 * 但**一刀把所有 bearing 锁成同一个值也是错的** —— 那样 orbit 转完之后,
 * 下一个 keyframe 会把镜头**啪地掰回去**。
 *
 * 正确的做法:**除了开场的建立镜头,所有 cue 都不带 bearing** —— 让它们
 * 自然继承「相机现在朝哪」。于是:
 *   • 没有 orbit 的地方 → bearing 一直不变（不会莫名其妙地飘）
 *   • orbit 转过之后    → 后面的镜头**接着**那个朝向,不会被掰回来
 *
 * 旋转从此是**剧本作者写下的动作**,不是任何一层偷偷加的。
 */
export function normalizeBearing(beats: Beat[]): void {
  let first = true
  for (const b of beats) {
    for (const c of b.camera) {
      const anyC = c as unknown as { type?: string; bearing?: number }
      if (anyC.type === 'orbit') continue          // orbit 靠 degrees,不碰
      if (typeof anyC.bearing !== 'number') continue
      if (first) { first = false; continue }        // 开场机位保留（通常 0 = 正北）
      delete anyC.bearing                           // 其余一律继承当前朝向
    }
  }
}

/**
 * 🔴 **在代码里判定 beat 的 kind,不要求 LLM 自己标。**
 *
 * 实测:prompt 明明白白写了「kind="arbitrage"」「kind="weakness"」,模型**内容全写对了**
 *(邻居对比、短板+反驳一字不差),但把它们**统统标成了 `kind: "life"`**。
 * 于是 area_compare 卡片不会出现,下游按 kind 做的一切(断言、运镜、UI)全部落空。
 *
 * 「LLM 会违反 prompt。代码不会。」—— 那就别让 kind 由它决定:
 * 我们**知道**哪个项目有邻居数据、短板文案长什么样,直接认出来并打标。
 *
 * ⚠️ 顺序要紧:短板那一拍**也会**提到邻居的名字,所以必须**先认短板**(带反驳的),
 *    再认套利。反过来会把短板误判成套利。
 */
function classifyBeats(script: TourScript, input: TourInput): void {
  const byId = new Map(input.properties.map((p) => [p.id, p]))

  for (const act of script.acts) {
    const prop = byId.get(act.property_id)
    const ctx = prop?.area_context
    if (!ctx) continue

    const neighborNames = ctx.neighbors.map((n) => n.name).filter(Boolean)
    const mentionsNeighbor = (t: string) => neighborNames.some((n) => n && t.includes(n))
    const hasRebuttal = (t: string) => /但是|但|不过|however|but /i.test(t)

    // ① 短板拍 —— 提到邻居 **且** 带反驳。先认它。
    if (ctx.weakness) {
      const b = act.beats.find(
        (x) => x.kind !== 'arbitrage' && mentionsNeighbor(x.narration) && hasRebuttal(x.narration)
      )
      if (b) b.kind = 'weakness'
    }

    // ② 套利拍 —— 提到邻居(且不是刚认出来的短板拍)
    if (neighborNames.length) {
      const b = act.beats.find((x) => x.kind !== 'weakness' && mentionsNeighbor(x.narration))
      if (b) {
        b.kind = 'arbitrage'
        // 卡片也别指望它加 —— 我们自己确保它在,且从第 0 毫秒就在
        if (!b.overlays.some((o) => o.type === 'area_compare')) {
          b.overlays.unshift({
            type: 'area_compare',
            property_id: act.property_id,
            at_ms: 0,
            duration_ms: b.duration_ms,
          } as Overlay)
        }
      }
    }
  }
}

/** Returns a list of validation errors. Empty list = valid. */
export function validateTourScript(
  script: TourScript,
  input: TourInput
): string[] {
  const errors: string[] = []
  const validIds = new Set(input.properties.map((p) => p.id))
  const allBeats: Beat[] = [
    script.intro,
    ...script.acts.flatMap((a) => a.beats),
    script.outro,
  ]

  // ⭐ 先 clamp 再校验 —— 修掉 LLM 的运镜（8 秒飞行、180° 绕圈、迟到 8 秒的卡片），
  //    而不是把它当成错误退回去重试（那样只是白烧一次 LLM 调用，它下次照样犯）。
  for (const beat of allBeats) clampCinematography(beat)
  normalizeBearing(allBeats)

  // kind 由**代码**判定 —— 模型内容写对了却全标成 'life'(见 classifyBeats 的注释)
  classifyBeats(script, input)

  // 数字口语化 —— 「购入价 1800000 迪拉姆」→「购入价 180 万迪拉姆」。
  // 字幕和 TTS 读的是同一个字符串，改一处两处都对。
  for (const beat of allBeats) {
    beat.narration = humanizeNumbers(beat.narration, input.config.language)
  }
  for (const act of script.acts) {
    if (act.transition_out?.narration) {
      act.transition_out.narration = humanizeNumbers(
        act.transition_out.narration,
        input.config.language
      )
    }
  }

  for (const act of script.acts) {
    if (!validIds.has(act.property_id)) {
      errors.push(`act "${act.id}": unknown property_id "${act.property_id}"`)
    }
  }

  let summed = 0
  for (const beat of allBeats) {
    summed += beat.duration_ms
    errors.push(...withinBeat(beat))
    for (const o of beat.overlays) {
      for (const ref of overlayPropertyRefs(o)) {
        if (!validIds.has(ref)) {
          errors.push(
            `beat "${beat.id}": overlay "${o.type}" references unknown property_id "${ref}"`
          )
        }
      }
    }
  }

  /**
   * ⚠️ `total_ms` 是**可以算出来的**,所以就算出来 —— 别再让模型当计算器。
   *
   * 原来这里是一条校验:模型只要加错一次(实测 80000 vs 86000)就两次生成全判失败,
   * 于是每条 tour 都带着两条 warning 出厂。而这个字段的正确值**只有一个可能**,
   * 根本不需要它同意。真正该校验的是**总时长有没有跑偏目标**(下面那条)。
   */
  if (summed !== script.total_ms) script.total_ms = summed

  const targetMs = input.config.target_seconds * 1000
  const low = targetMs * (1 - TOTAL_DURATION_TOLERANCE)
  const high = targetMs * (1 + TOTAL_DURATION_TOLERANCE)
  if (script.total_ms < low || script.total_ms > high) {
    errors.push(
      `total_ms (${script.total_ms}) outside ±${Math.round(
        TOTAL_DURATION_TOLERANCE * 100
      )}% of target (${targetMs}); allowed ${Math.round(low)}–${Math.round(high)}`
    )
  }

  const banned = input.config.banned_phrases ?? []
  for (const beat of allBeats) {
    for (const phrase of banned) {
      if (phrase && beat.narration.includes(phrase)) {
        errors.push(
          `beat "${beat.id}": narration contains banned phrase "${phrase}"`
        )
      }
    }
  }

  return errors
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function parseAndValidate(
  raw: unknown,
  input: TourInput
): { script?: TourScript; errors: string[] } {
  const parsed = TourScriptSchema.safeParse(raw)
  if (!parsed.success) {
    const errs = parsed.error.issues.map(
      (i) => `${i.path.join('.') || '(root)'}: ${i.message}`
    )
    return { errors: errs }
  }
  if (input.config.variant === 'project') stripNonPublicOverlays(parsed.data)
  const semantic = validateTourScript(parsed.data, input)
  return { script: parsed.data, errors: semantic }
}

/**
 * 🔴 公开导览里**代码层面**摘掉不该出现的卡片。
 *
 * prompt 已经说了「NO roi_card / NO area_compare」,但 prompt 是请求,不是保证 ——
 * 这条链路上每一个「让模型自己遵守」的约定最后都被违反过至少一次。
 * 这些页面是公开且可被抓取的,一张编出来的 5 年回报卡就是一次对外失实陈述。
 * 所以在这里**无条件删掉**,而不是校验失败后重试(重试也可能再犯)。
 */
function stripNonPublicOverlays(script: TourScript): void {
  const BANNED = new Set(['roi_card', 'area_compare'])
  const beats = [script.intro, ...script.acts.flatMap((a) => a.beats), script.outro]
  for (const b of beats) {
    if (!b?.overlays?.length) continue
    const kept = b.overlays.filter((o) => !BANNED.has(o.type))
    if (kept.length !== b.overlays.length) b.overlays = kept
  }
}

export async function generateTourScript(
  input: TourInput
): Promise<{ script: TourScript; warnings: string[] }> {
  const warnings: string[] = []

  const firstRaw = await callModel(buildPrompt(input))
  const first = parseAndValidate(firstRaw, input)
  if (first.script && first.errors.length === 0) {
    return { script: first.script, warnings }
  }

  // Retry once, feeding the parse/validation errors back to the model.
  warnings.push(
    `first attempt had ${first.errors.length} issue(s), retried: ${first.errors.join('; ')}`
  )
  const repairNote = first.errors.map((e, i) => `${i + 1}. ${e}`).join('\n')
  const secondRaw = await callModel(buildPrompt(input, repairNote))
  const second = parseAndValidate(secondRaw, input)

  if (second.script && second.errors.length === 0) {
    return { script: second.script, warnings }
  }

  if (second.script) {
    // Shape valid but semantics still off — return it with loud warnings so the
    // caller (and the demo go/no-go gate) can judge rather than silently fail.
    warnings.push(
      `retry still has ${second.errors.length} validation issue(s): ${second.errors.join('; ')}`
    )
    return { script: second.script, warnings }
  }

  throw new Error(
    `TourScript failed schema parse after retry. Issues: ${second.errors.join('; ')}`
  )
}
