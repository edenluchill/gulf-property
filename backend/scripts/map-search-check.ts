/**
 * 地图搜索框跑分 —— 改 services/map-search.ts 或 /api/dubai/search 必跑。
 *
 *   cd backend && npx ts-node -T scripts/map-search-check.ts
 *
 * 拿**生产库里真实的区名和楼盘名**跑一遍经纪会打的查询词。断言的是
 * 「排第一的那条对不对」,不是「有没有结果」—— 搜索框的价值全在第一条。
 *
 * 用例来源:客户 slavynchuk94@(付费经纪)2026-07-29 的原话
 * "Can't find many off plan projects or area",逐条复现出来的。
 */
import pool from '../src/db/pool'
import { rankAreas, rankProjects, mergeSuggestions, type AreaCandidateRow, type ProjectCandidateRow } from '../src/services/map-search'

/**
 * [查询词, 期望命中的名字片段(小写), 允许出现在前几条(默认 1 = 必须排第一)]
 * expect = null → 期望没有结果。
 *
 * 打半个词时放宽到前 3:"mar" 下 Maritime City 和 Dubai Marina 都是合法的
 * 第一名(整名前缀 vs 词首前缀),强行钉死谁第一是在把测试写成实现的复读机。
 */
const AREA_CASES: [string, string | null, number?][] = [
  ['dubai marina', 'dubai marina'],
  ['marina', 'dubai marina'],
  ['mar', 'marina', 3],
  ['downtown', 'downtown dubai'],
  ['jvc', 'jumeirah village circle'],
  ['jumeirah village circle', 'jumeirah village circle'],
  ['jlt', 'jumeirah lake'],
  ['jumeirah lake towers', 'jumeirah lake'],      // 库里是单数 tower + 前缀 JLT
  ['jbr', 'jumeirah beach residence'],
  ['business bay', 'business bay'],
  ['palm jumeirah', 'palm jumeirah'],
  ['sports city', 'sport city'],                   // 库里是单数
  ['sport city', 'sport city'],
  ['emaar beachfront', 'beach front by emaar'],    // 库里词序相反
  ['meydan', 'medan'],                             // 库里拼作 Medan
  ['dubai hills estate', 'dubai hills'],
  ['creek harbour', 'dubai creek harbour'],
  ['dubai harbour', 'dubai harbour'],
  ['sobha hartland', 'sobha'],
  ['tecom', 'barsha heights'],
  ['difc', 'difc'],
  ['damac hills', 'damac hills'],
  ['mbr city', 'mbr city'],
  ['al barsha', 'al barsha'],
  ['barsha', 'barsha'],
  ['arjan', 'arjan'],
  ['motor city', 'motor city'],
  ['studio city', 'studio city'],
  ['production city', 'production city'],
  ['expo city', 'expo city'],
  ['silicon oasis', 'silicon oasis'],
  ['the valley', 'valley'],
  ['zzzznotanarea', null],
]

async function main() {
  const [areaRes, projRes] = await Promise.all([
    pool.query(`
      SELECT da.id::text AS id, da.name, da.name_ar, da.translations,
             ST_Y(ST_Centroid(da.boundary::geometry)) AS lat,
             ST_X(ST_Centroid(da.boundary::geometry)) AS lng,
             m.transaction_count, m.avg_price_sqm,
             COALESCE(p.cnt, 0)::int AS project_count
        FROM dubai_areas da
        LEFT JOIN get_dubai_area_metrics() m ON m.id = da.id
        LEFT JOIN (SELECT LOWER(TRIM(area)) AS area_key, COUNT(*) AS cnt
                     FROM residential_projects WHERE area IS NOT NULL GROUP BY 1) p
               ON p.area_key = LOWER(TRIM(da.name))
       WHERE da.visible = true
    `),
    pool.query(`SELECT id::text AS id, project_name, developer, area, latitude, longitude, min_price FROM residential_projects`),
  ])

  const areas: AreaCandidateRow[] = areaRes.rows.map((r) => ({
    id: r.id, name: r.name, name_ar: r.name_ar,
    lat: r.lat != null ? parseFloat(r.lat) : null,
    lng: r.lng != null ? parseFloat(r.lng) : null,
    transaction_count: r.transaction_count != null ? parseInt(r.transaction_count) : null,
    avg_price_sqm: r.avg_price_sqm != null ? parseFloat(r.avg_price_sqm) : null,
    project_count: r.project_count ?? 0,
    alt_names: Object.values(r.translations || {})
      .map((tr: any) => (tr && typeof tr.name === 'string' ? tr.name : ''))
      .filter(Boolean),
  }))

  const projects: ProjectCandidateRow[] = projRes.rows.map((r) => ({
    id: r.id, project_name: r.project_name, developer: r.developer, area: r.area,
    latitude: r.latitude != null ? Number(r.latitude) : null,
    longitude: r.longitude != null ? Number(r.longitude) : null,
    min_price: r.min_price != null ? parseFloat(r.min_price) : null,
  }))

  console.log(`语料:${areas.length} 个区 / ${projects.length} 个在售楼盘\n`)

  let pass = 0, fail = 0
  for (const [q, expect, within = 1] of AREA_CASES) {
    const hits = rankAreas(areas, q, 5)
    const ok = expect === null
      ? hits.length === 0
      : hits.slice(0, within).some((h) => h.name.trim().toLowerCase().includes(expect))
    if (ok) pass++; else fail++
    const mark = ok ? '✅' : '❌'
    const shown = hits.slice(0, 3).map((h) => h.name.trim()).join(' | ') || '(空)'
    console.log(`${mark} ${q.padEnd(24)} → ${shown}`)
    if (!ok) console.log(`   ↑ 期望前 ${within} 条里出现含 "${expect}" 的区`)
  }

  // 楼盘侧:随便挑几个真实楼盘名/开发商,自己搜自己必须排第一
  console.log('\n── 楼盘 ──')
  const sample = projects.slice(0, 6)
  for (const p of sample) {
    const hits = rankProjects(projects, p.project_name, 5)
    const ok = hits[0]?.id === p.id
    if (ok) pass++; else fail++
    console.log(`${ok ? '✅' : '❌'} ${p.project_name.slice(0, 30).padEnd(32)} → ${hits[0]?.name ?? '(空)'}`)
  }
  const devs = [...new Set(projects.map((p) => p.developer).filter(Boolean))].slice(0, 3) as string[]
  for (const d of devs) {
    const hits = rankProjects(projects, d, 5)
    const ok = hits.length > 0
    if (ok) pass++; else fail++
    console.log(`${ok ? '✅' : '❌'} 开发商 ${d.slice(0, 24).padEnd(26)} → ${hits.length} 个楼盘`)
  }

  // 混排:搜一个有楼盘的区,区必须排在楼盘前面
  const areaWithProjects = areas.find((a) => a.project_count > 0)
  if (areaWithProjects) {
    const merged = mergeSuggestions(
      rankAreas(areas, areaWithProjects.name, 10),
      rankProjects(projects, areaWithProjects.name, 10),
      10
    )
    const firstProjIdx = merged.findIndex((m) => m.kind === 'project')
    const lastAreaIdx = merged.map((m) => m.kind).lastIndexOf('area')
    const ok = firstProjIdx === -1 || firstProjIdx > lastAreaIdx
    if (ok) pass++; else fail++
    console.log(`\n${ok ? '✅' : '❌'} 混排顺序(区在楼盘之前):"${areaWithProjects.name.trim()}" → ${merged.map((m) => `${m.kind[0]}:${m.name.trim().slice(0, 18)}`).join(' | ')}`)
  }

  console.log(`\n${fail === 0 ? '✅ 全过' : '❌ 有失败'}  ${pass} pass / ${fail} fail`)
  await pool.end()
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
