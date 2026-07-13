/**
 * Luna Tour — 端到端跑分（我自己能跑，不用等 owner 点）。
 *
 * 走**真实 HTTP 接口**，整条链路：
 *   选盘 → 生成草稿(不烧语音) → 草稿对客户 404 → 读大纲时间线 → 内容体检
 *   → 模拟经纪改文案 → 确认渲染 → 对客户 200 → 语音生成 → 清理
 *
 * ⚠️ **不带 Authorization → 落到 demo 经纪 → 不扣任何额度**（isLoggedIn=false）。
 *    所以这个脚本可以随便跑。
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

async function api(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const r = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  const text = await r.text()
  let body: any = null
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  return { status: r.status, body }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 挑 3 个**在售 + 有真实户型**的项目，跨区域、价格拉开。 */
async function pickProjects(): Promise<{ id: string; name: string; units: number }[]> {
  const { rows } = await pool.query<{ id: string; name: string; units: string }>(
    `SELECT DISTINCT ON (p.area) p.id::text, p.project_name AS name, COUNT(u.id)::text AS units
       FROM residential_projects p
       JOIN project_unit_types u ON u.project_id = p.id AND u.bedrooms IS NOT NULL
      WHERE p.latitude IS NOT NULL AND p.longitude IS NOT NULL
        AND p.status = 'selling' AND p.min_price > 500000
      GROUP BY p.id, p.project_name, p.area
      ORDER BY p.area, COUNT(u.id) DESC`
  )
  return rows.slice(0, 3).map((r) => ({ id: r.id, name: r.name, units: Number(r.units) }))
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
 * ⚠️ 只抓「米范围 / 半径」。**「3.99 公里范围内」是正常中文**（在说距离），
 *    第一版正则把它也算成泄露了 —— 断言不准，跑分就没意义。
 */
const RADIUS_LEAK = /米\s*(的)?\s*范围|半径/
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

  // 运镜
  const cams = allBeats.flatMap((b: any) => b.camera || [])
  const longCam = cams.filter((c: any) => (c.duration_ms ?? 0) > 2000)
  expect(longCam.length === 0, '没有超过 2 秒的镜头运动（弹远又弹近）',
    longCam.map((c: any) => `${c.type || 'keyframe'} ${c.duration_ms}ms`).join(' | '))

  const orbits = cams.filter((c: any) => c.type === 'orbit')
  expect(orbits.length === 0, '没有 orbit（到了目的地还绕着一栋没盖的楼转）')

  // 卡片必须**开场就在**，不能让客户对着一张空地图发呆
  const lateCards = allBeats.flatMap((b: any) => (b.overlays || []))
    .filter((o: any) => ['property_card', 'roi_card', 'unit_card'].includes(o.type) && (o.at_ms ?? 0) > 0)
  expect(lateCards.length === 0, '信息卡都在 at_ms=0 出现（不迟到）',
    lateCards.map((o: any) => `${o.type}@${o.at_ms}`).join(' | '))
}

// ── 主流程 ──────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🎬 Luna Tour 端到端跑分  →  ${BASE}\n${'─'.repeat(66)}`)

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
