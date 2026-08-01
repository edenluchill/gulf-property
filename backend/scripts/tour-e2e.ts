/**
 * Luna Tour — 端到端跑分（我自己能跑，不用等 owner 点）。
 *
 * 走**真实 HTTP 接口**，整条链路：
 *   选盘 → 生成草稿(不烧语音) → 草稿对客户 404 → 读大纲时间线 → 内容体检
 *   → 模拟经纪改文案 → 确认渲染 → 对客户 200 → 语音生成 → 清理
 *
 * ⚠️ 走 **`x-luna-internal` 内部 token**（env: LUNA_INTERNAL_TOKEN）→ demo 经纪 → 不扣额度。
 *
 *    之前它靠的是「不带 Authorization 就跳过配额」这个**安全漏洞** —— 而那个漏洞让
 *    开放互联网上的任何人都能无限烧我们的 Gemini + TTS。**不能用漏洞来做测试。**
 *    漏洞已堵（requireAgent），跑分改走正当的内部通道。
 *
 * 真正的价值不在「接口通不通」，在**内容体检**：那些反复咬人的问题
 *（念原始数字、推销售罄的房、把「没数据」说成「得分为 0」、户型全程缺席、
 *  阿拉伯语地名、卡片迟到、镜头绕圈）现在每一条都是一个断言 —— 改完就能验，
 *  不用再靠肉眼看截图。
 *
 * 用法（backend/ 下）：
 *   npx ts-node -T scripts/tour-e2e.ts                 # 打生产
 *   TOUR_E2E_BASE=http://localhost:3001 npx ts-node -T scripts/tour-e2e.ts
 *   npx ts-node -T scripts/tour-e2e.ts --keep          # 不删,留着人眼看
 */
import 'dotenv/config'
import pool from '../src/db/pool'

const BASE = process.env.TOUR_E2E_BASE || 'https://api.pinzos.com'
const KEEP = process.argv.includes('--keep')
const AGENT = `${BASE}/api/luna/agent`
const PUBLIC = `${BASE}/api/luna`

// ── 断言收集 ────────────────────────────────────────────────────────────────
interface Check { ok: boolean; name: string; detail?: string }
const checks: Check[] = []
const ok = (name: string, detail?: string) => checks.push({ ok: true, name, detail })
const bad = (name: string, detail?: string) => checks.push({ ok: false, name, detail })
const expect = (cond: boolean, name: string, detail?: string) =>
  cond ? ok(name, detail) : bad(name, detail)

const INTERNAL = process.env.LUNA_INTERNAL_TOKEN || ''

async function api(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const r = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(INTERNAL ? { 'x-luna-internal': INTERNAL } : {}),
      ...(init?.headers || {}),
    },
  })
  const text = await r.text()
  let body: any = null
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  return { status: r.status, body }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * 挑 3 个**在售 + 有真实户型**的项目，跨区域。
 *
 * ⚠️ **优先挑成交量大的区。** 第一版随便挑，结果选中的区全都成交量太低 →
 *    地理套利和「短板+反驳」那两拍**正确地跳过了** → 于是那两条断言**空过**。
 *    **空过的断言是虚假的安全感**：它绿着，但它什么都没验。
 *    现在按区域成交量排序，保证这条路径每次都被真正走一遍。
 */
async function pickProjects(): Promise<{ id: string; name: string; units: number }[]> {
  const { rows } = await pool.query<{ id: string; name: string; units: string; tx: string }>(
    `SELECT DISTINCT ON (p.area)
            p.id::text, p.project_name AS name,
            COUNT(u.id)::text AS units,
            COALESCE(MAX(m.transaction_count), 0)::text AS tx
       FROM residential_projects p
       JOIN project_unit_types u ON u.project_id = p.id AND u.bedrooms IS NOT NULL
       LEFT JOIN dubai_areas a
              ON a.boundary IS NOT NULL
             AND ST_Contains(a.boundary::geometry,
                             ST_SetSRID(ST_MakePoint(p.longitude, p.latitude), 4326))
       LEFT JOIN get_dubai_area_metrics(NULL,NULL,NULL) m ON m.id = a.id
      WHERE p.latitude IS NOT NULL AND p.longitude IS NOT NULL
        AND p.status = 'selling' AND p.min_price > 500000
      GROUP BY p.id, p.project_name, p.area
      ORDER BY p.area, COUNT(u.id) DESC`
  )
  const sorted = [...rows].sort((a, b) => Number(b.tx) - Number(a.tx))
  return sorted.slice(0, 3).map((r) => ({ id: r.id, name: r.name, units: Number(r.units) }))
}

// ── 内容体检 —— 每一条都是踩过的坑 ──────────────────────────────────────────

/** 旁白里不能出现 ≥5 位的原始数字。「购入价 1800000 迪拉姆」没有人这么说话。 */
const RAW_NUMBER = /\d{5,}/
/** 只有阿语名的 POI 曾经原样进旁白（还把一家药房当成了地铁站）。 */
const ARABIC = /[؀-ۿ]/
/** 「该项目目前处于售罄状态」——在推销一套客户买不到的房。 */
const SOLD_OUT = /售罄|sold[\s-]?out/i
/**
 * 「周边**一万米范围内**，距离商场仅 1.45 公里」——它在把**我们内部的检索半径**
 * 念给客户听。客户不需要知道我们是在多大范围里搜的，那是实现细节。
 *
 * ⚠️ **这条断言我修过两次，两次都是同一个错误:把「正常地说距离」当成泄露。**
 *    第一版抓 `公里.*范围` → 冤枉了「学校在 3.99 公里范围内」。
 *    第二版改成只抓 `米.*范围` → 现在又冤枉了「地铁和超市都在约 200 米范围内」
 *    （旁白改成米制之后立刻复现）。
 *
 *    真正的信号不是单位，是**数值的形状**:我们的检索半径是 AMENITY_SPECS 里的
 *    `zero` 值 —— 4/5/6/8/10 公里，念出来一定是**整千米级**（「一万米」「五千米」
 *    「10000 米」）。而真实距离是具体的小数（200 米 / 1.3 公里）。
 *    所以只抓「四位数以上的米」和中文的万米/千米，外加「半径」这个词本身
 *    （对客户说话永远用不到它）。
 */
const RADIUS_LEAK =
  /(?:^|[^\d.])\d{4,}\s*米|[一两二三四五六七八九十]\s*万\s*米|[一两二三四五六七八九十]\s*千\s*米|半径|\bradius\b/i
/** 「配套基建得分目前为 0」——把**数据的缺席**说成了关于房子的事实。 */
const ZERO_SCORE = /得分[^。]{0,6}(为|是)\s*0(?!\.)|评分[^。]{0,6}(为|是)\s*0(?!\.)|score[^.]{0,8}\bis 0\b/i

interface FlowBeat { id: string; kind?: string; group?: string; narration: string }

function auditNarration(beats: FlowBeat[]) {
  const all = beats.map((b) => b.narration).join('\n')

  const raw = beats.filter((b) => RAW_NUMBER.test(b.narration))
  expect(raw.length === 0, '旁白没有原始数字（该说「180万」不是「1800000」）',
    raw.map((b) => `${b.id}: ${b.narration.match(RAW_NUMBER)![0]}`).join(' | '))

  expect(!ARABIC.test(all), '旁白没有阿拉伯语（药房曾被当成地铁站念出来）',
    (all.match(ARABIC) || []).join(''))

  const sold = beats.filter((b) => SOLD_OUT.test(b.narration))
  expect(sold.length === 0, '没有在推销售罄的项目', sold.map((b) => b.id).join(' | '))

  const zero = beats.filter((b) => ZERO_SCORE.test(b.narration))
  expect(zero.length === 0, '没有把「没数据」播报成「得分为 0」', zero.map((b) => b.id).join(' | '))

  /**
   * 🔴 **说了缺点却不反驳它,比什么都不说更糟**(Allen 的元分析)。
   *
   * 有效的机制不是「坦诚」,是**接种**:让客户免疫下一个经纪要说的话。
   * 所以 weakness 那一拍**必须带反驳** —— 只说缺点不给答案 = 主动帮竞争对手。
   */
  const weakBeats = beats.filter((b) => b.kind === 'weakness')
  const noRebuttal = weakBeats.filter((b) => !/但是|但|不过|however|but /i.test(b.narration))
  expect(noRebuttal.length === 0,
    weakBeats.length
      ? `短板那一拍**带了反驳**（${weakBeats.length} 拍；说了缺点不反驳比不说更糟）`
      : '（这批没有能被真数据反驳的短板 → 那一拍正确地跳过了）',
    noRebuttal.map((b) => b.narration.slice(0, 40)).join(' | '))

  /**
   * 不能**报幕**:「看一下地理套利」「下面是短板这一拍」—— 真实经纪不会宣布章节名。
   *
   * ⚠️ 只禁**报幕**,不禁词。第一版把「套利」整个词禁了 —— 但「更具套利空间」
   *    对投资客是完全正常的中文。**断言太紧和太松一样有害**:它会逼着我把
   *    本来对的东西改坏。
   */
  const JARGON = /地理套利|这一拍|本拍|arbitrage|weakness beat|接下来这一段/i
  const jargon = beats.filter((b) => JARGON.test(b.narration))
  expect(jargon.length === 0, '没把内部术语念给客户（「地理套利」是我们的黑话）',
    jargon.map((b) => b.narration.slice(0, 30)).join(' | '))

  const leak = beats.filter((b) => RADIUS_LEAK.test(b.narration))
  expect(leak.length === 0, '没有把内部检索半径念给客户（「周边一万米范围内」）',
    leak.map((b) => b.narration.slice(0, 40)).join(' | '))

}

/**
 * 配套分只在**够硬（≥70）**的时候才值得讲。低分照报 = 替自己拆台
 *（实测:「该项目生活配套得分**四十三分**」）。
 *
 * ⚠️ 不能靠正则猜「这是不是低分」——「评分为满分」也会被糙正则抓成低分。
 *    去 DB 拿每个项目的**真实分数**，只检查低分项目的那几拍。
 */
async function auditWeakScore(code: string, script: any) {
  const { rows } = await pool.query<{ id: string; snapshot: any }>(
    `SELECT sp.project_id::text AS id, sp.snapshot
       FROM lt_session_properties sp
       JOIN lt_demo_sessions s ON s.id = sp.session_id
      WHERE s.share_code = $1`,
    [code]
  )
  const weakIds = new Set(
    rows.filter((r) => (r.snapshot?.amenity_score ?? 0) < 70).map((r) => r.id)
  )
  if (!weakIds.size) { ok('低分项目不报分数（这批没有低分项目）'); return }

  const offenders: string[] = []
  for (const act of script.acts || []) {
    if (!weakIds.has(act.property_id)) continue
    for (const b of act.beats || []) {
      if (/得分|评分/.test(b.narration)) offenders.push(`${b.id}: ${b.narration.slice(0, 30)}`)
    }
  }
  expect(offenders.length === 0,
    `低分项目不报分数（${weakIds.size} 个低分项目，只讲真实距离）`,
    offenders.join(' | '))
}

function auditScript(script: any, picked: { id: string; name: string; units: number }[]) {
  const acts: any[] = script.acts || []
  const allBeats: any[] = [script.intro, ...acts.flatMap((a) => a.beats), script.outro].filter(Boolean)

  expect(acts.length === picked.length, `每个项目一幕（${acts.length}/${picked.length}）`)

  // 户型拍 —— 客户要买的是户型。有户型数据的项目**必须**有 homes 拍。
  const withUnits = picked.filter((p) => p.units > 0)
  const homesActs = acts.filter((a) => a.beats.some((b: any) => b.kind === 'homes'))
  expect(homesActs.length === withUnits.length,
    `有户型数据的项目都讲了户型（${homesActs.length}/${withUnits.length}）`)

  const unitCards = allBeats.flatMap((b: any) => b.overlays || []).filter((o: any) => o.type === 'unit_card')
  expect(unitCards.length === homesActs.length, `户型卡数量对得上（${unitCards.length}）`)
  expect(unitCards.every((o: any) => !('area_sqft' in o) && !('price' in o)),
    '户型卡不带数字（只要让模型填数字它就会编）')

  /**
   * 运镜。
   *
   * ⚠️ 这里原来断言的是「**没有 orbit**」「所有镜头 ≤2 秒」—— 那是上一轮矫枉过正的产物:
   *    我为了修「乱飘」把镜头全按死了,结果 owner 说「动能太少了,镜头经常停下来不动,
   *    没有电影那种感觉」。**要管的从来不是「动不动」,是「动得有没有道理」。**
   *
   * 现在的口径:
   *   • 移动(flyover / 换 center 的 keyframe)必须短 —— 途中没有信息,是死时间
   *   • 停驻(orbit / push / crane)可以长 —— 它们让客户看清眼前这个东西
   *   • **numbers 拍必须定住** —— 他在读图表,动镜头就是跟数字抢注意力
   *   • **life / homes 拍必须有动作** —— 这两拍正是「让他看清周围」的地方
   *   • keyframe 不许带 bearing —— 旋转只能来自显式的 orbit
   */
  const cams = allBeats.flatMap((b: any) => b.camera || [])
  const TRAVEL = (c: any) => c.type === 'flyover' || (!c.type && Array.isArray(c.center))
  const longTravel = cams.filter((c: any) => TRAVEL(c) && (c.duration_ms ?? 0) > 2500)
  expect(longTravel.length === 0, '移动镜头都 ≤2.5 秒（飞越途中是死时间）',
    longTravel.map((c: any) => `${c.type || 'keyframe'} ${c.duration_ms}ms`).join(' | '))

  const spun = cams.filter((c: any) => !c.type && typeof c.bearing === 'number' && c !== cams[0])
  expect(spun.length === 0, 'keyframe 不带 bearing（旋转只能来自显式 orbit，不能靠漂移）',
    `${spun.length} 个 keyframe 写了 bearing`)

  const numbersBeats = acts.flatMap((a: any) => (a.beats || []).filter((b: any) => b.kind === 'numbers'))
  const movingNumbers = numbersBeats.filter((b: any) =>
    (b.camera || []).some((c: any) => c.type === 'orbit' || c.type === 'flyover'))
  expect(movingNumbers.length === 0, 'numbers 拍定住（读数字时不跟他抢注意力）',
    movingNumbers.map((b: any) => b.id).join(' | '))

  const showBeats = acts.flatMap((a: any) => (a.beats || []).filter((b: any) => b.kind === 'life' || b.kind === 'homes'))
  const frozen = showBeats.filter((b: any) => !(b.camera || []).length)
  expect(showBeats.length > 0 && frozen.length === 0,
    `life / homes 拍都有运镜（${showBeats.length} 拍，这两拍正是「让他看清周围」的地方）`,
    frozen.map((b: any) => b.id).join(' | '))

  // 卡片必须**开场就在**，不能让客户对着一张空地图发呆
  const lateCards = allBeats.flatMap((b: any) => (b.overlays || []))
    .filter((o: any) => ['property_card', 'roi_card', 'unit_card'].includes(o.type) && (o.at_ms ?? 0) > 0)
  expect(lateCards.length === 0, '信息卡都在 at_ms=0 出现（不迟到）',
    lateCards.map((o: any) => `${o.type}@${o.at_ms}`).join(' | '))
}

// ── 主流程 ──────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🎬 Luna Tour 端到端跑分  →  ${BASE}\n${'─'.repeat(66)}`)

  if (!INTERNAL) throw new Error('缺 LUNA_INTERNAL_TOKEN（在 backend/.env 里）')

  /**
   * ⓪ **匿名不能烧钱。**
   *
   * 曾经的漏洞:`currentAgentId()` 没 token 时回落到共享 demo 经纪,而配额门是
   * `if (isLoggedIn)` —— 不带 Authorization 就**完全跳过配额**,开放互联网上的
   * 任何人都能无限烧我们的 Gemini + TTS。**钱在漏。**
   * 这条断言就是那个洞的墓碑 —— 它再也不能悄悄打开。
   */
  const anon = await fetch(`${AGENT}/sessions/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },   // 故意不带任何凭证
    body: JSON.stringify({ project_ids: ['x', 'y'], client: {} }),
  })
  expect(anon.status === 401, '⓪ 匿名请求烧不了钱（401）', `实际 ${anon.status}`)

  const picked = await pickProjects()
  if (picked.length < 2) throw new Error('可用项目不足 2 个')
  console.log('选盘：' + picked.map((p) => `${p.name}(${p.units} 户型)`).join(' · '))

  // ① 生成草稿 —— 不该烧语音
  const t0 = Date.now()
  const create = await api(`${AGENT}/sessions/create`, {
    method: 'POST',
    body: JSON.stringify({
      project_ids: picked.map((p) => p.id),
      client: { name: 'E2E 测试客户' },
      one_liner: '香港投资客，预算 300 万，一家四口有小孩，重视 5 年回报',
      language: 'zh',
    }),
  })
  expect(create.status === 200 && !!create.body?.shareCode, '① 生成草稿', JSON.stringify(create.body).slice(0, 120))
  const code: string = create.body?.shareCode
  if (!code) throw new Error('没拿到 shareCode，后面没法跑')
  console.log(`   share_code = ${code}`)

  // ② 草稿对客户必须是 404 —— 经纪没确认之前，客户不该看到半成品
  const pubBefore = await api(`${PUBLIC}/public/v/${code}`)
  expect(pubBefore.status === 404, '② 草稿对客户是 404（未确认不该能播）', `实际 ${pubBefore.status}`)

  // ③ 等剧本
  let ready = false
  for (let i = 0; i < 60; i++) {
    const g = await api(`${AGENT}/sessions/${code}/gen-status`)
    if (g.body?.status === 'ready') { ready = true; break }
    if (g.body?.status === 'failed') { bad('③ 剧本生成', g.body?.error); break }
    await sleep(3000)
  }
  expect(ready, '③ 剧本生成完成', `${Math.round((Date.now() - t0) / 1000)}s`)
  if (!ready) return report(code)

  // ④ 拿到 session id + 大纲时间线
  const list = await api(`${AGENT}/sessions`)
  const sess = (list.body?.sessions || []).find((s: any) => s.share_code === code)
  expect(!!sess, '④ 草稿出现在经纪的列表里')
  expect(sess && sess.is_published === false, '④ 列表里标记为未发布（草稿）')
  const sid = sess?.id
  if (!sid) return report(code)

  const flowRes = await api(`${AGENT}/sessions/${sid}/script`)
  const beats: FlowBeat[] = flowRes.body?.flow || []
  expect(beats.length > 0, '④ 大纲时间线拿得到', `${beats.length} 拍`)

  /**
   * ⚠️ **契约断言 —— 后端返回的形状必须是前端要的形状。**
   *
   * 血的教训:后端 /script 返回 `camera: "环绕展示"`(**字符串**),而分镜时间线对它
   * `.map()` → `"环绕展示".map is not a function` → **整个经纪台白屏**。
   * 两段式生成把这条时间线放到了必经之路上 —— 一生成就炸。
   *
   * 而**两边各自的 tsc 都通过**(前端声明 string[],后端实际发 string)——
   * 类型在编译期是对的,运行期是错的。我的跑分只打 API 不打 UI,所以没抓到。
   * 这条断言就是那道缝的补丁。
   */
  const shapeBad: string[] = []
  for (const b of beats as any[]) {
    if (b.camera != null && !Array.isArray(b.camera)) shapeBad.push(`${b.id}.camera 不是数组(${typeof b.camera})`)
    if (b.overlays != null && !Array.isArray(b.overlays)) shapeBad.push(`${b.id}.overlays 不是数组`)
    if (typeof b.narration !== 'string') shapeBad.push(`${b.id}.narration 不是字符串`)
  }
  expect(shapeBad.length === 0, '④ 时间线形状对得上前端（camera/overlays 必须是数组）',
    shapeBad.slice(0, 3).join(' | '))

  console.log('\n📋 大纲时间线：')
  for (const b of beats) {
    const kind = (b.kind || '—').padEnd(8)
    console.log(`   ${kind} ${b.narration.slice(0, 58)}${b.narration.length > 58 ? '…' : ''}`)
  }
  console.log('')

  // ⑤ 内容体检
  auditNarration(beats)
  const scriptRow = await pool.query<{ script: any }>(
    `SELECT t.script FROM lt_tour_scripts t
       JOIN lt_demo_sessions s ON s.id = t.session_id WHERE s.share_code = $1`,
    [code]
  )
  if (scriptRow.rows[0]?.script) {
    auditScript(scriptRow.rows[0].script, picked)
    await auditWeakScore(code, scriptRow.rows[0].script)
  } else bad('⑤ 读得到剧本 JSON')

  // ⑥ 模拟经纪改文案（两段式的意义就在这儿：改完再烧语音）
  const first = beats[1] || beats[0]
  const edited = '【E2E 改过的一句】' + first.narration
  const patch = await api(`${AGENT}/sessions/${sid}`, {
    method: 'PATCH',
    body: JSON.stringify({ title: 'E2E 跑分', narration: { [first.id]: edited } }),
  })
  expect(patch.status === 200, '⑥ 经纪能在烧语音前改文案')
  const after = await api(`${AGENT}/sessions/${sid}/script`)
  const savedBeat = (after.body?.flow || []).find((b: FlowBeat) => b.id === first.id)
  expect(savedBeat?.narration === edited, '⑥ 改动存进去了')

  // ⑦ 确认渲染 → 发布 + 烧语音
  const render = await api(`${AGENT}/sessions/${sid}/render`, { method: 'POST' })
  expect(render.status === 200, '⑦ 确认渲染', JSON.stringify(render.body).slice(0, 100))

  const pubAfter = await api(`${PUBLIC}/public/v/${code}`)
  expect(pubAfter.status === 200, '⑦ 确认后客户能打开了（404 → 200）', `实际 ${pubAfter.status}`)

  // ⑧ 语音
  let audio = { ready: 0, total: 0 }
  for (let i = 0; i < 60; i++) {
    const g = await api(`${AGENT}/sessions/${code}/gen-status`)
    audio = { ready: g.body?.audioReady ?? 0, total: g.body?.audioTotal ?? 0 }
    if (audio.total > 0 && audio.ready >= audio.total) break
    await sleep(3000)
  }
  expect(audio.total > 0 && audio.ready >= audio.total,
    `⑧ 语音全部生成（${audio.ready}/${audio.total}）`)

  /**
   * ⑨ **发布后的 tour 里,每一拍都必须有 Gemini 语音。**
   *
   * 少一条 audio_url,引擎就回落到**浏览器机器音** —— owner 实测被这个坑到:
   *「怎么是用 browser 机器人语音说话的?」。发布出去的 tour 绝不能有这种拍。
   */
  const finalScript = await pool.query<{ script: any }>(
    `SELECT t.script FROM lt_tour_scripts t
       JOIN lt_demo_sessions s ON s.id = t.session_id WHERE s.share_code = $1`,
    [code]
  )
  const sc = finalScript.rows[0]?.script
  const allB = sc ? [sc.intro, ...(sc.acts || []).flatMap((a: any) => a.beats), sc.outro].filter(Boolean) : []
  const silent = allB.filter((b: any) => !b.audio_url)
  expect(allB.length > 0 && silent.length === 0,
    `⑨ 发布后每一拍都有 Gemini 真声（不会回落到机器音）`,
    silent.map((b: any) => b.id).join(' | '))

  await report(code)
}

async function report(code: string) {
  console.log(`${'─'.repeat(66)}`)
  const failed = checks.filter((c) => !c.ok)
  for (const c of checks) {
    console.log(`${c.ok ? '  ✅' : '  ❌'} ${c.name}${c.detail ? `\n        ${c.detail}` : ''}`)
  }
  console.log(`${'─'.repeat(66)}`)
  console.log(`${checks.length - failed.length}/${checks.length} 通过` + (failed.length ? `  —— ${failed.length} 项失败` : '  🎉'))

  if (KEEP) {
    console.log(`\n👀 保留了这场 tour（--keep）：${BASE.replace('api.', 'www.')}/v/${code}`)
  } else {
    await pool.query(`DELETE FROM lt_demo_sessions WHERE share_code = $1`, [code])
    console.log(`\n🧹 已清理 ${code}（要留着看就加 --keep）`)
  }
  await pool.end()
  process.exit(failed.length ? 1 : 0)
}

main().catch(async (e) => {
  console.error('\n💥', e instanceof Error ? e.message : e)
  await pool.end().catch(() => {})
  process.exit(1)
})
