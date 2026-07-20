/**
 * Luna 工具层跑分（Tier 1）—— 确定性、秒级、零 API 成本。
 *
 * ## 为什么要有这个
 *
 * 2026-07-20 审计 11 场真实对话，每一句「AI 回复智障」都对应一个**工具层**缺陷，
 * 没有一条是靠换模型能修好的：
 *
 *   · "Dubai Harbor"  → 工具返回 "D3 Dubai Dsign District 3"，Luna 照着介绍 D3
 *   · "JVC"           → 工具返回 "Jebel Ali Village"
 *   · 270 万的 1 居室  → 工具算出「5 年增值 4818 万，年化 79.9%」(取到了商业写字楼那行指标)
 *   · "100万左右"      → 模型填 min==max，退化成精确匹配，只剩 1-3 个盘
 *   · 查无结果         → 返回体只有一句 "No projects found"，对话当场死掉
 *
 * **总根源是「工具撒谎而模型无从察觉」**：工具返回一个语气笃定的成功回执，
 * 里面既没有置信度也没有用户原话。模型只能照着讲。
 *
 * 所以这一层跑分**不测模型**，只测工具：给定输入，工具有没有返回真话？
 * 不确定的时候有没有老实说不确定？这四类问题在这里全能抓住，而且是确定性的 ——
 * 不会像模型跑分那样今天绿明天红。
 *
 * ## 用法（backend/ 下）
 *
 *   npx ts-node -T scripts/luna-eval.ts                  # 打生产
 *   LUNA_EVAL_BASE=http://localhost:3000 npx ts-node -T scripts/luna-eval.ts
 *   npx ts-node -T scripts/luna-eval.ts --json out.json  # 存结果，用来做前后对比
 *   npx ts-node -T scripts/luna-eval.ts --diff before.json   # 跟基线比
 *
 * ⚠️ **它打的是部署好的 API**。改完后端要先 `.\quick-deploy.ps1` 再跑分，
 *    否则你测的是旧镜像 —— 这个坑 tour-e2e 已经踩过一次了。
 */
import 'dotenv/config'
import { writeFileSync, readFileSync, existsSync } from 'fs'

const BASE = process.env.LUNA_EVAL_BASE || 'https://api.pinzos.com'
const jsonArgIdx = process.argv.indexOf('--json')
const OUT = jsonArgIdx >= 0 ? process.argv[jsonArgIdx + 1] : null
const diffArgIdx = process.argv.indexOf('--diff')
const DIFF = diffArgIdx >= 0 ? process.argv[diffArgIdx + 1] : null

// ── 断言收集 ────────────────────────────────────────────────────────────────
interface Check { suite: string; name: string; ok: boolean; detail: string }
const checks: Check[] = []
function expect(suite: string, name: string, ok: boolean, detail = '') {
  checks.push({ suite, name, ok, detail })
}

async function api(path: string): Promise<any> {
  const r = await fetch(`${BASE}${path}`, { headers: { 'Content-Type': 'application/json' } })
  const t = await r.text()
  try { return JSON.parse(t) } catch { return { __raw: t, __status: r.status } }
}

/** 区名比较：忽略大小写/空格/标点/中文注释/RTL 控制符（库里这些全都有） */
function sameArea(a: string, b: string): boolean {
  const n = (s: string) => (s || '')
    .normalize('NFKC')
    .replace(/[‎‏‪-‮]/g, '')
    .replace(/[一-鿿　-〿＀-￯]/g, ' ')
    .toLowerCase().replace(/[^a-z0-9]+/g, '')
  return n(a) === n(b)
}

// ════════════════════════════════════════════════════════════════════════════
// Suite A —— 区域名解析
//
// 铁律：**宁可说不知道，也不能给错。**
// 一个 status='matched' 但指向别的区的回答，比 'not_found' 危险得多 ——
// 后者只是没帮上忙，前者会被 Luna 当成事实播报给客户。
// ════════════════════════════════════════════════════════════════════════════

interface AreaCase {
  q: string
  /** 必须解析到这个区（用宽松比较，容忍库里的空格/中文注释） */
  want?: string
  /** 绝不能解析到这些区 —— 生产事故的原样复现 */
  forbid?: string[]
  /** 期望「拿不准」：必须 ambiguous，不许自信地猜一个 */
  wantAmbiguous?: boolean
  /** 期望库里真没有 */
  wantNotFound?: boolean
  why?: string
}

const AREA_CASES: AreaCase[] = [
  // ── 生产事故原样复现 ───────────────────────────────────────────────────
  { q: 'Dubai Harbor', want: 'Dubai Harbour', forbid: ['D3 Dubai Dsign District 3', 'Dubai Creek Harbour'],
    why: '生产事故：美式拼写 Harbor 少一个 u → 旧版按字母序返回 D3' },
  { q: 'Jumeirah Village Circle (JVC)', want: 'JVC Jumeirah Village Circle', forbid: ['Jebel Ali Village'],
    why: '生产事故：village 一个词命中 Jebel Ali Village，Je < Ju 靠字母序赢' },

  // ── 缩写（库里缩写前置，用户经常只说缩写） ──────────────────────────────
  { q: 'JVC', want: 'JVC Jumeirah Village Circle', forbid: ['Jebel Ali Village'] },
  { q: 'JBR', want: 'Jumeirah Beach Residence(JBR)' },
  { q: 'DIFC', want: 'DIFC Dubai international financial center' },
  { q: 'JLT', want: 'JLT Jumeirah Lake tower' },

  // ── 库里带首尾空格的（8 个，用户永远打不出来） ──────────────────────────
  { q: 'Dubai Marina', want: 'Dubai Marina' },
  { q: 'Business Bay', want: 'Business Bay' },
  { q: 'The Meadows', forbid: ['The Greens'] },

  // ── 相似区名不能串（这几组最容易互相污染） ──────────────────────────────
  { q: 'Palm Jumeirah', want: 'Palm Jumeirah', forbid: ['Pearl Jumeirah', 'Palm Jebel Ali'] },
  { q: 'Palm Jebel Ali', want: 'Palm Jebel Ali', forbid: ['Palm Jumeirah', 'Jebel Ali Village'] },
  { q: 'Dubai Creek Harbour', want: 'Dubai Creek Harbour', forbid: ['Dubai Harbour'] },
  { q: 'Downtown', want: 'Downtown Dubai', forbid: ['downtown&local area 外国人无法买卖'],
    why: '库里有个 "downtown&local area 外国人无法买卖" 的垃圾条目会来抢' },
  { q: 'Downtown Dubai', want: 'Downtown Dubai' },

  // ── 拼写与大小写变体 ────────────────────────────────────────────────────
  { q: 'Dubai Hills Estate', want: 'Dubai hills' },
  { q: 'Emaar South', want: 'Emaar south' },
  { q: 'Motor City', want: 'Motor city' },
  { q: 'Dubai Silicon Oasis', want: 'Dubai Silicon Oasis' },
  { q: 'International City', want: 'International City' },
  { q: 'The Oasis by Emaar', want: 'The Oasis by Emaar' },
  { q: 'Town Square', want: 'Town Square' },
  { q: 'Damac Hills', want: 'Damac hills' },

  // ── 必须承认拿不准（这是新增能力，旧版永远会猜一个） ────────────────────
  { q: 'village', wantAmbiguous: true,
    why: '"village" 命中多个区且分不出高下，猜一个就是 50% 概率带客户去错地方' },
  { q: 'dubai', wantAmbiguous: true,
    why: '"dubai" 出现在 20+ 个区名里，是万能通配符，绝不能自信地挑一个' },

  // ── 库里真没有 ──────────────────────────────────────────────────────────
  { q: 'Zzzqqx Nowhere Land', wantNotFound: true },
  { q: 'Manhattan', wantNotFound: true },
]

async function suiteAreas() {
  const S = 'A·区域解析'
  for (const c of AREA_CASES) {
    const r = await api(`/api/ai/areas/match?q=${encodeURIComponent(c.q)}`)
    const status: string = r?.status ?? (r?.area ? 'matched' : 'not_found')
    const got: string = r?.area?.name ?? ''
    const label = `"${c.q}"`

    // 最重要的一条：绝不能自信地指向禁止列表里的区
    if (c.forbid?.length) {
      const hit = c.forbid.find(f => sameArea(f, got))
      expect(S, `${label} 不得错配`, !hit,
        hit ? `❌ 返回了 "${got}"（${c.why || ''}）` : `ok（返回 "${got || status}"）`)
    }
    if (c.want) {
      expect(S, `${label} → ${c.want}`, status === 'matched' && sameArea(c.want, got),
        status === 'matched' ? `got "${got}" conf=${r?.area?.confidence ?? '?'}` : `status=${status}`)
    }
    if (c.wantAmbiguous) {
      expect(S, `${label} 必须承认拿不准`, status === 'ambiguous',
        status === 'ambiguous'
          ? `ok，候选 ${(r.candidates || []).map((x: any) => x.name).slice(0, 3).join(' / ')}`
          : `❌ status=${status}${got ? `，自信地返回了 "${got}"` : ''}（${c.why || ''}）`)
    }
    if (c.wantNotFound) {
      expect(S, `${label} 必须报查无此区`, status === 'not_found',
        status === 'not_found' ? 'ok' : `❌ status=${status}，返回了 "${got}"`)
    }
    // 匹配上的必须带置信度 —— 没有置信度的成功回执就是在骗模型
    if (status === 'matched') {
      expect(S, `${label} 回执带置信度`, typeof r?.area?.confidence === 'number',
        typeof r?.area?.confidence === 'number' ? `conf=${r.area.confidence}` : '❌ 缺 confidence 字段')
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Suite B —— ROI 理智检查
//
// 迪拜没有任何住宅能稳定年化 79.9%。任何超出常识的数字都说明上游取错了数据，
// **宁可不显示也不能播给客户** —— 经纪拿着这个数字去见客户是会出事的。
// ════════════════════════════════════════════════════════════════════════════

/** 年化回报上限。超过这个数一定是数据错了，不是发现了金矿。 */
const MAX_SANE_ANNUALIZED = 30
/** 5 年增值不该超过本金的 2 倍 */
const MAX_SANE_APPRECIATION_RATIO = 2
/** 毛租金收益率的合理区间 */
const SANE_YIELD = [0, 15]

const ROI_AREAS = [
  'Business Bay', 'International City', 'JVC Jumeirah Village Circle', 'Dubai Marina',
  'Downtown Dubai', 'Dubai Silicon Oasis', 'Al Furjan', 'Arjan',
]

async function suiteRoi() {
  const S = 'B·ROI 理智'
  let seen = 0
  const offenders: string[] = []

  for (const area of ROI_AREAS) {
    const r = await api(`/api/ai/projects/search?area=${encodeURIComponent(area)}`)
    for (const p of r?.projects || []) {
      seen++
      const inv = p.investment_5yr
      const price = Number(p.min_price) || 0
      const name = `${p.project_name}@${p.area}`

      if (inv) {
        const ann = Number(inv.annualized_return_pct)
        if (Number.isFinite(ann) && ann > MAX_SANE_ANNUALIZED) {
          offenders.push(`${name} 年化 ${ann}%`)
        }
        const app = Number(inv.appreciation_5yr)
        if (price > 0 && Number.isFinite(app) && app > price * MAX_SANE_APPRECIATION_RATIO) {
          offenders.push(`${name} 5年增值 ${Math.round(app / 1e4)}万 vs 房价 ${Math.round(price / 1e4)}万`)
        }
      }
      const y = Number(p.area_yield)
      if (Number.isFinite(y) && (y < SANE_YIELD[0] || y > SANE_YIELD[1])) {
        offenders.push(`${name} 收益率 ${y}%`)
      }
    }
  }

  expect(S, `${seen} 个项目无荒谬 ROI`, offenders.length === 0,
    offenders.length ? `❌ ${offenders.slice(0, 6).join('；')}` : `ok（年化全部 ≤${MAX_SANE_ANNUALIZED}%）`)

  // Business Bay 是原始事故现场：commercial 那行是 79.9%，residential 是 10.9%
  const bb = await api(`/api/ai/projects/search?area=${encodeURIComponent('Business Bay')}`)
  const growths = [...new Set((bb?.projects || []).map((p: any) => Number(p.area_growth)).filter(Number.isFinite))]
  expect(S, 'Business Bay 不得取到写字楼增长率(79.9)',
    !growths.some((g: any) => Math.abs(g - 79.9) < 0.5),
    `area_growth = ${growths.join(', ') || '(无)'}`)

  // 🔴 detail 路由单独测 —— **79.9% 那次事故就是 detail 出的**（Luna 讲具体项目时走这条）。
  // search 路由的 DISTINCT ON 靠运气可能取到 residential，detail 的 LIMIT 1 则是纯赌。
  // 只测 search 会漏掉真正的事故现场。
  const detailOffenders: string[] = []
  let detailSeen = 0
  for (const area of ROI_AREAS.slice(0, 5)) {
    const s = await api(`/api/ai/projects/search?area=${encodeURIComponent(area)}`)
    for (const p of (s?.projects || []).slice(0, 3)) {
      const d = await api(`/api/ai/projects/${encodeURIComponent(p.id)}/detail`)
      const inv = d?.result?.investment_5yr
      if (!inv) continue
      detailSeen++
      const ann = Number(inv.annualized_return_pct)
      const growth = Number(inv.area_growth_pct)
      if (Number.isFinite(ann) && ann > MAX_SANE_ANNUALIZED) {
        detailOffenders.push(`${p.project_name} 年化 ${ann}%（area_growth=${growth}）`)
      }
      if (Number.isFinite(growth) && Math.abs(growth - 79.9) < 0.5) {
        detailOffenders.push(`${p.project_name} 取到写字楼增长率 79.9`)
      }
    }
  }
  expect(S, `detail 路由 ${detailSeen} 个项目无荒谬 ROI`, detailOffenders.length === 0,
    detailOffenders.length ? `❌ ${detailOffenders.slice(0, 5).join('；')}` : 'ok')

  // 同一个查询连打两次必须完全一致 —— 旧版 DISTINCT ON 缺 tiebreak，
  // 同一项目的 area_growth 会在 14.2 和 8.5 之间飘（日志实证）
  const a1 = await api(`/api/ai/projects/search?area=${encodeURIComponent('JVC Jumeirah Village Circle')}`)
  const a2 = await api(`/api/ai/projects/search?area=${encodeURIComponent('JVC Jumeirah Village Circle')}`)
  const sig = (x: any) => (x?.projects || []).map((p: any) => `${p.project_name}:${p.area_growth}:${p.area_yield}`).sort().join('|')
  expect(S, '重复查询结果稳定', sig(a1) === sig(a2) && sig(a1).length > 0,
    sig(a1) === sig(a2) ? 'ok' : `❌ 两次不一致\n  ${sig(a1).slice(0, 200)}\n  ${sig(a2).slice(0, 200)}`)
}

// ════════════════════════════════════════════════════════════════════════════
// Suite C —— 价格区间不许退化
//
// 用户说「100万左右」，模型会填 min_price==max_price==1000000。
// 那等于精确匹配，返回 1-3 个盘，客户以为迪拜只有这么点房。
// ════════════════════════════════════════════════════════════════════════════

async function suitePriceRange() {
  const S = 'C·价格区间'
  const degenerate = await api('/api/ai/projects/search?min_price=1000000&max_price=1000000')
  const proper = await api('/api/ai/projects/search?min_price=800000&max_price=1200000')
  const dn = degenerate?.count ?? (degenerate?.projects || []).length
  const pn = proper?.count ?? (proper?.projects || []).length

  // 必须显式声明它把 min==max 当成了「约等于」。
  // 只看「结果数够多」是不够的 —— 基线跑分里 3 vs 6 恰好蒙混过关了，
  // 但那纯属该价位的盘本来就少，工具其实什么都没做。
  expect(S, 'min==max 被当作「约等于」处理',
    !!degenerate?.interpreted_as,
    degenerate?.interpreted_as
      ? `ok，展开为 ${JSON.stringify(degenerate.interpreted_as)}（${dn} 个 vs 正常区间 ${pn} 个）`
      : `❌ 无 interpreted_as 字段，退化查询 ${dn} 个 vs 正常区间 ${pn} 个`)

  expect(S, '正常区间能查到房', pn > 0, `${pn} 个项目`)
}

// ════════════════════════════════════════════════════════════════════════════
// Suite D —— 0 结果必须给出路
//
// 旧版返回 {projects:[],count:0,summary:'No projects found'}，模型手上一张牌都没有，
// 只能说「没找到」，对话当场死掉。提示词曾要求它 pivot 到「之前的搜索结果」——
// 但首轮调用根本没有「之前」，等于要求模型编造。
// ════════════════════════════════════════════════════════════════════════════

async function suiteDeadEnd() {
  const S = 'D·0结果出路'
  const cases = [
    { q: '/api/ai/projects/search?developer=NoSuchDeveloperXyzzy', label: '不存在的开发商' },
    { q: '/api/ai/projects/search?min_price=1&max_price=2', label: '荒谬的预算' },
  ]
  for (const c of cases) {
    const r = await api(c.q)
    const n = r?.count ?? (r?.projects || []).length
    if (n > 0) { expect(S, `${c.label} → 意外有结果`, true, `${n} 个，跳过`); continue }
    const hasWayOut = !!r?.relaxation?.suggestions?.length || !!r?.relaxation?.blocking_filter
    expect(S, `${c.label} 带放宽建议`, hasWayOut,
      hasWayOut ? `ok，卡住的是 ${r.relaxation.blocking_filter}` : `❌ 返回体只有 summary="${r?.summary || ''}"`)
  }
}

// ════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// Suite E —— 产品指路
//
// Luna 的 16 个工具全是买家侧找房/数据分析，对产品自身一无所知。后果实测两种:
//   · 客户问 "How can I do live calling?" → "I can't help with that"
//     （实时带看是真实存在的功能，房间还免费）→ 那通对话到此为止
//   · 客户说「把资料发给我老婆」→「我可以发给您」→ 她发不了任何东西
// 这套断言守住两头:该有的必须指对，不该说的必须永远查不到。
// ════════════════════════════════════════════════════════════════════════════

async function suiteProductGuide() {
  const S = 'E·产品指路'
  const { findFeatures, allFeatureIds } = await import('../src/services/product-guide')

  const cases: { q: string; want: string; why?: string }[] = [
    { q: 'How can I do live calling?', want: 'live-tour', why: '生产事故原句：她当时答「帮不了」' },
    { q: 'can I do a video call with my client', want: 'live-tour' },
    { q: '实时带看在哪', want: 'live-tour' },
    { q: '能跟客户一起看地图吗', want: 'live-tour' },
    { q: 'can I send this to my client', want: 'ai-tour', why: '「发给客户」是最高频的产品问题' },
    { q: '怎么把这个发给我客户', want: 'ai-tour' },
    { q: 'how do I share a tour with my buyer', want: 'ai-tour' },
    { q: '我想把这个项目的资料发给我老婆看一下，能发吗？', want: 'ai-tour',
      why: '模型层跑分抓到的：关键词曾写死「发给客户」，客户说「发给我老婆」就全落空，Luna 答「不确定有没有这个功能」' },
    { q: '怎么分享', want: 'ai-tour' },
    { q: '我想给客户出个投资分析', want: 'client-report' },
    { q: '能不能生成报价单', want: 'sales-offer' },
    { q: 'I need a payment plan quote', want: 'sales-offer' },
    { q: '怎么看历史价格走势', want: 'map-timeline' },
    { q: 'how far is it from the metro', want: 'map-measure' },
    { q: '上传楼书', want: 'upload-brochure' },
    { q: 'how much does this cost', want: 'billing' },
    { q: '怎么推荐朋友拿免费月', want: 'referral' },
  ]

  for (const c of cases) {
    const hits = findFeatures(c.q)
    const top = hits[0]?.feature.id
    expect(S, `"${c.q}" → ${c.want}`, top === c.want,
      top === c.want ? `ok (score ${hits[0].score})` : `❌ 命中 ${top || '(无)'}${c.why ? `（${c.why}）` : ''}`)
  }

  // 完全不沾边的必须无匹配 —— 宁可说不知道，也不能硬塞一个功能
  for (const q of ['asdfgh qwerty', '今天天气怎么样']) {
    expect(S, `"${q}" 不硬塞功能`, findFeatures(q).length === 0,
      findFeatures(q).length === 0 ? 'ok' : `❌ 命中 ${findFeatures(q)[0].feature.id}`)
  }

  // 🔴 最重要的一条:内部/已下架功能绝不能被查出来。
  // 漏一条，Luna 就会把 admin 看板讲给客户听。
  const FORBIDDEN = ['admin', 'analytics', 'dashboard', 'leads', 'lead', '线索', '后台', '管理后台']
  const ids = allFeatureIds()
  const leaked = FORBIDDEN.filter(f => ids.some(id => id.includes(f)))
  expect(S, '知识库不含内部/已下架功能', leaked.length === 0,
    leaked.length ? `❌ 泄露 ${leaked.join(', ')}` : `ok（${ids.length} 条全部可对外）`)

  for (const q of ['admin dashboard', '后台分析', 'leads 线索在哪']) {
    const hits = findFeatures(q)
    const bad = hits.some(h => ['admin', 'leads'].includes(h.feature.id))
    expect(S, `"${q}" 不指向内部功能`, !bad,
      bad ? `❌ 命中 ${hits[0].feature.id}` : `ok${hits.length ? `（落到 ${hits[0].feature.id}，可接受）` : ''}`)
  }
}

async function main() {
  console.log(`\nLuna 工具层跑分 —— ${BASE}\n${'─'.repeat(70)}`)
  const t0 = Date.now()

  for (const [label, fn] of [
    ['区域解析', suiteAreas], ['ROI 理智', suiteRoi],
    ['价格区间', suitePriceRange], ['0结果出路', suiteDeadEnd], ['产品指路', suiteProductGuide],
  ] as const) {
    try { await fn() }
    catch (e: any) { expect(label, `${label} 套件崩了`, false, e?.message || String(e)) }
  }

  // 输出
  let cur = ''
  for (const c of checks) {
    if (c.suite !== cur) { cur = c.suite; console.log(`\n▎${cur}`) }
    console.log(`  ${c.ok ? '✅' : '❌'} ${c.name}${c.detail ? `\n       ${c.detail}` : ''}`)
  }

  const pass = checks.filter(c => c.ok).length
  const total = checks.length
  const pct = total ? Math.round((pass / total) * 100) : 0
  console.log(`\n${'─'.repeat(70)}`)
  console.log(`  ${pass}/${total} 通过 (${pct}%)   耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`)

  const failed = checks.filter(c => !c.ok)
  if (failed.length) {
    console.log(`\n  未通过：`)
    for (const f of failed) console.log(`    · [${f.suite}] ${f.name} — ${f.detail}`)
  }

  // 前后对比
  if (DIFF && existsSync(DIFF)) {
    const before: Check[] = JSON.parse(readFileSync(DIFF, 'utf8')).checks
    const key = (c: Check) => `${c.suite}::${c.name}`
    const bmap = new Map(before.map(c => [key(c), c]))
    const fixed: string[] = [], broke: string[] = []
    for (const c of checks) {
      const b = bmap.get(key(c))
      if (!b) continue
      if (!b.ok && c.ok) fixed.push(c.name)
      if (b.ok && !c.ok) broke.push(c.name)
    }
    const bpass = before.filter(c => c.ok).length
    console.log(`\n  ── 对比基线 ${DIFF} ──`)
    console.log(`  ${bpass}/${before.length} → ${pass}/${total}`)
    if (fixed.length) console.log(`  ✅ 修好 ${fixed.length} 条：\n     ${fixed.join('\n     ')}`)
    if (broke.length) console.log(`  🔴 弄坏 ${broke.length} 条：\n     ${broke.join('\n     ')}`)
    if (!fixed.length && !broke.length) console.log(`  （无变化）`)
  }

  if (OUT) {
    writeFileSync(OUT, JSON.stringify({ base: BASE, at: new Date().toISOString(), pass, total, checks }, null, 2))
    console.log(`\n  结果已存 ${OUT}`)
  }
  console.log()
  process.exit(failed.length ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
