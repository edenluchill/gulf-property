/**
 * Luna Tour —— 给**一个楼盘**生成一条公开常驻导览(不是经纪给某个客户生成的那种)。
 *
 * 为什么有这个东西:经纪版 tour 两个月 15 场、外部客户播放 0 次;而同期 211 个外部
 * 访客看了 442 次项目详情页。导览是好资产,只是摆在没人经过的地方。这条命令把它
 * 摆到买家已经在的那一页。
 *
 * 用法(backend/ 下):
 *   npx ts-node -T scripts/project-tour.ts --list                 # 有哪些盘可以做 / 已经做了
 *   npx ts-node -T scripts/project-tour.ts "Serenz"               # 按名字模糊匹配,生成 + 配音
 *   npx ts-node -T scripts/project-tour.ts <uuid>                 # 按 id
 *   npx ts-node -T scripts/project-tour.ts "Serenz" --no-voice    # 只出剧本(改稿阶段省 TTS)
 *   npx ts-node -T scripts/project-tour.ts --all --limit=5        # 批量铺开(调满意之后再用)
 *   npx ts-node -T scripts/project-tour.ts "Serenz" --hide        # 从公开目录里撤下
 *
 * share_code 形如 `p-serenz`(`p-` 前缀让它一眼区别于经纪的分享码),
 * **同一个楼盘重生成会复用同一个 code** —— 已经发出去的链接不能失效。
 */
import pool from '../src/db/pool'
import { createSession, ensureAgent } from '../src/luna-tour/session-builder'

const argv = process.argv.slice(2)
const has = (f: string) => argv.includes(`--${f}`)
const val = (f: string) => {
  const hit = argv.find((a) => a.startsWith(`--${f}=`))
  return hit ? hit.slice(f.length + 3) : undefined
}
const positional = argv.filter((a) => !a.startsWith('--'))

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Row {
  id: string
  project_name: string
  area: string | null
  status: string | null
  developer: string | null
  units: number
  tour_code: string | null
  tour_status: string | null
}

/** 楼盘名 → share_code。稳定、可读、可猜 —— 同一个盘永远算出同一个 code。 */
function codeFor(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return `p-${slug || 'project'}`
}

async function candidates(): Promise<Row[]> {
  const { rows } = await pool.query<Row>(
    `SELECT p.id::text, p.project_name, p.area, p.status, p.developer,
            COUNT(u.id)::int AS units,
            t.share_code AS tour_code, t.status AS tour_status
       FROM residential_projects p
       LEFT JOIN project_unit_types u ON u.project_id = p.id
       LEFT JOIN lt_project_tours t   ON t.project_id = p.id
      WHERE p.latitude IS NOT NULL AND p.longitude IS NOT NULL
        -- 售罄的盘不做公开导览:带人看一套买不到的房是在浪费他的时间
        AND COALESCE(lower(p.status), '') NOT LIKE '%sold%'
      GROUP BY p.id, p.project_name, p.area, p.status, p.developer, t.share_code, t.status
      ORDER BY (t.share_code IS NOT NULL), COUNT(u.id) DESC, p.project_name`
  )
  return rows
}

async function generateOne(row: Row, opts: { voice: boolean }): Promise<void> {
  const shareCode = codeFor(row.project_name)
  /**
   * 公开导览挂在**官方号**下,不是某个经纪。
   * 以后「经纪认领这条导览」= 把展示的经纪换成他 —— 那才是能卖的东西
   * (「你的名字挂在 Damac Islands 的导览上」)。现在先把默认形态立住。
   */
  const agentId = await ensureAgent({
    email: 'tours@pinzos.com',
    displayName: 'Pinzos',
    brand: { title: '迪拜楼盘导览', accent: '#00E0B8' },
  })

  console.log(`\n▶ ${row.project_name}  (${row.area ?? '—'}, ${row.units} 个户型)  → /${shareCode}`)
  const res = await createSession({
    shareCode,
    projectIds: [row.id],
    minProjects: 1, // 单楼盘导览:就讲这一个
    title: row.project_name,
    agentId,
    awaitAudio: opts.voice,
    draft: !opts.voice, // 不配音就先当草稿,不进公开目录
    config: {
      variant: 'project',
      narrative_focus: 'location',
      // 60~90 秒。四拍(落地/周边/户型/实话)+ 收尾刚好装满,再长买家就走了。
      target_seconds: 80,
    },
  })
  if (res.warnings.length) res.warnings.forEach((w) => console.log(`  ! ${w}`))

  await pool.query(
    `INSERT INTO lt_project_tours (project_id, session_id, share_code, status, published_at, duration_ms)
     VALUES ($1,$2,$3,$4, CASE WHEN $4 = 'ready' THEN now() END, $5)
     ON CONFLICT (project_id) DO UPDATE SET
       session_id   = EXCLUDED.session_id,
       share_code   = EXCLUDED.share_code,
       status       = EXCLUDED.status,
       duration_ms  = EXCLUDED.duration_ms,
       -- 重生成不该把它顶到目录最前面 → 保留首次上线时间
       published_at = COALESCE(lt_project_tours.published_at, EXCLUDED.published_at),
       updated_at   = now()`,
    [row.id, res.sessionId, shareCode, opts.voice ? 'ready' : 'generating', res.totalMs]
  )

  console.log(
    `  ✅ ${Math.round(res.totalMs / 1000)}s · ${res.audioTotal} 拍` +
      (opts.voice ? ' · 已配音并公开' : ' · 无配音(草稿,不进目录)')
  )
  console.log(`     看:  https://www.pinzos.com/?toursession=${shareCode}`)
}

async function main(): Promise<void> {
  const rows = await candidates()

  if (has('list') || (!positional.length && !has('all'))) {
    console.log(`\n可做公开导览的楼盘(已排除售罄):${rows.length} 个\n`)
    for (const r of rows) {
      const mark = r.tour_code ? (r.tour_status === 'ready' ? '✅' : '🕓') : '  '
      console.log(
        `${mark} ${String(r.units).padStart(3)} 户型  ${r.project_name.padEnd(34).slice(0, 34)}` +
          ` ${(r.area ?? '—').padEnd(22).slice(0, 22)} ${r.tour_code ?? ''}`
      )
    }
    const done = rows.filter((r) => r.tour_status === 'ready').length
    console.log(`\n已上线 ${done} / ${rows.length}。生成一条:npx ts-node -T scripts/project-tour.ts "<楼盘名>"`)
    return
  }

  const voice = !has('no-voice')

  if (has('hide')) {
    const key = positional[0]
    const row = rows.find((r) => (UUID_RE.test(key) ? r.id === key : r.project_name.toLowerCase().includes(key.toLowerCase())))
    if (!row) throw new Error(`没找到楼盘:${key}`)
    await pool.query(`UPDATE lt_project_tours SET status='hidden', updated_at=now() WHERE project_id=$1`, [row.id])
    console.log(`已从公开目录撤下:${row.project_name}`)
    return
  }

  let targets: Row[]
  if (has('all')) {
    const limit = Number(val('limit') || 0)
    // 已经 ready 的不重做(要重做就单个指定,免得批量把一整批链接的内容悄悄换掉)
    targets = rows.filter((r) => r.tour_status !== 'ready')
    if (limit > 0) targets = targets.slice(0, limit)
    console.log(`批量生成 ${targets.length} 条(--limit 可限量)`)
  } else {
    const key = positional[0]
    const hit = rows.filter((r) =>
      UUID_RE.test(key) ? r.id === key : r.project_name.toLowerCase().includes(key.toLowerCase())
    )
    if (!hit.length) throw new Error(`没找到楼盘:${key}(用 --list 看有哪些)`)
    if (hit.length > 1) {
      console.log(`「${key}」匹配到 ${hit.length} 个,说清楚是哪个:`)
      hit.forEach((r) => console.log(`  - ${r.project_name}  (${r.id})`))
      return
    }
    targets = hit
  }

  for (const row of targets) {
    try {
      await generateOne(row, { voice })
    } catch (e) {
      console.error(`  ✖ ${row.project_name}: ${e instanceof Error ? e.message : e}`)
    }
  }
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error('\nPROJECT TOUR FAILED:', err instanceof Error ? err.message : err)
    try {
      await pool.end()
    } catch {
      /* ignore */
    }
    process.exit(1)
  })
