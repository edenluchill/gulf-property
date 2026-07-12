/**
 * 两层论证验证 —— 户型真按画像匹配了吗?AI 会不会编朝向/景观?
 *
 * 最要命的一条:**朝向/景观/楼层的填充率是 0%**,绝不能出现在报告里。
 * 这份报告要发给真实客户 —— 编一句「南向采光好」就是在经纪的品牌上撒谎。
 *
 * 跑:  cd backend && npx ts-node -T scripts/test-fit-analyzer.ts
 */
import pool from '../src/db/pool'
import { projectUnits, scoreUnits, analyzeFit } from '../src/luna-tour/client-fit-analyzer'
import type { ExtractedProfile } from '../src/luna-tour/client-profile-coach'

let pass = 0, fail = 0
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n      → ${JSON.stringify(detail)?.slice(0, 200)}`}`)
  ok ? pass++ : fail++
}

/** 编造检测:这些词只要出现,就是 AI 在编(数据库里这些字段 100% 是空的)。 */
const FABRICATION = /朝向|南向|北向|东向|西向|采光|景观|海景|市景|楼层|高层|低层|中层|车位|停车位/

async function main() {
  // 找一个户型数据丰富的项目
  const { rows } = await pool.query(
    `SELECT p.id, p.project_name AS name, p.area, p.developer, COUNT(u.id)::int AS n
       FROM residential_projects p JOIN project_unit_types u ON u.project_id = p.id
      GROUP BY p.id HAVING COUNT(u.id) >= 4 ORDER BY COUNT(u.id) DESC LIMIT 1`
  )
  const proj = rows[0]
  if (!proj) { console.log('没有户型够多的项目,跳过'); process.exit(0) }
  console.log(`\n项目: ${proj.name} (${proj.area}) — ${proj.n} 个户型\n`)

  // ── 1) 户型取全特征(旧实现只取 5 个字段) ────────────────────────────────
  console.log('【1】户型要带上全部可用特征')
  const units = await projectUnits(proj.id)
  check('取到户型', units.length > 0, units.length)
  check('⭐ 带 features(旧实现丢了 —— AI 无米下锅)', units.some((u) => u.features.length > 0))
  check('带 bathrooms', units.some((u) => u.bathrooms != null))
  check('带 floor_plan_image', units.some((u) => u.floor_plan_image))
  const noPrice = units.filter((u) => u.price == null).length
  console.log(`   (${units.length} 个户型,其中 ${noPrice} 个无价 —— 旧实现会把它们**静默过滤掉**)`)

  // ── 2) 打分要真的用上画像 ───────────────────────────────────────────────
  console.log('\n【2】打分要真的用上客户画像(不是"最便宜的 8 个")')
  const family: ExtractedProfile = {
    goal: 'live', budget_max: 3_000_000, family_size: 4, has_children: true,
    has_maid: true, cooking: 'often', nationality: '中国大陆',
  }
  const investor: ExtractedProfile = {
    goal: 'invest', budget_max: 1_500_000, horizon: 'rent_long', payment: 'cash',
  }
  const sf = scoreUnits(units, family)
  const si = scoreUnits(units, investor)
  console.log('   一家四口+保姆+常做饭 → 主推:', sf[0]?.name, `(${sf[0]?.fit}分)`, sf[0]?.hard_fails.length ? `⚠️ ${sf[0].hard_fails}` : '')
  console.log('   投资客150万长期收租 → 主推:', si[0]?.name, `(${si[0]?.fit}分)`)
  check('⭐ 不同画像 → 不同排序(否则打分是摆设)', sf[0]?.id !== si[0]?.id || sf[0]?.fit !== si[0]?.fit,
    { family: sf[0]?.name, investor: si[0]?.name })
  check('超预算的会被标硬伤', si.some((u) => u.hard_fails.some((f) => /超预算/.test(f))) || si.every((u) => (u.price ?? 0) <= 1_500_000))

  // 请保姆 → 有女佣房的该排前面
  const maidUnits = units.filter((u) => u.features.some((f) => /maid/i.test(f)))
  if (maidUnits.length && maidUnits.length < units.length) {
    const topHasMaid = sf.slice(0, Math.max(1, Math.ceil(sf.length / 2))).some((u) => u.features.some((f) => /maid/i.test(f)))
    check('⭐ 请保姆 → 带女佣房的户型排前半', topHasMaid)
  }

  // ── 3) ⭐ AI 论证:两层 + 绝不编 ─────────────────────────────────────────
  console.log('\n【3】⭐ 两层论证 —— 而且绝不能编朝向/景观/楼层')
  const enriched = { ...proj, area_metrics: { rental_yield_pct: 6.2, price_growth_pct: 8.1 }, net: { net_annualized_pct: 9.4 } }
  const fit = await analyzeFit(family, enriched as any, sf)
  if (!fit) { check('AI 论证返回', false, 'null'); }
  else {
    console.log('\n   ── Layer 1 · 项目 × 客户 ──')
    console.log('   匹配度:', fit.project_fit)
    fit.project_why.forEach((w) => console.log('   ✓ ' + w))
    fit.project_tradeoffs.forEach((w) => console.log('   ⚠ ' + w))
    console.log('\n   ── Layer 2 · 户型 × 客户(特点对特点) ──')
    console.log('   主推:', fit.recommended_unit)
    fit.unit_why.forEach((w) => console.log('   ✓ ' + w))
    console.log('   为什么不推别的:')
    fit.unit_why_not.forEach((w) => console.log('   ✗ ' + w))

    check('Layer1: 给了匹配度', fit.project_fit != null)
    check('Layer1: 有「为什么适合」', fit.project_why.length >= 2)
    check('Layer1: ⭐ 有诚实的取舍(全是优点反而不可信)', fit.project_tradeoffs.length >= 1)
    check('Layer2: 选出主推户型', !!fit.recommended_unit)
    check('Layer2: 主推的是真实存在的户型(没编)', units.some((u) => fit.recommended_unit?.includes(u.name) || u.name.includes(fit.recommended_unit || '§')))
    check('Layer2: 特点对特点(逐条咬合)', fit.unit_why.length >= 2)
    check('Layer2: ⭐ 说清了为什么不推别的', fit.unit_why_not.length >= 1)

    // 🔴 最要命的一条
    const all = [...fit.project_why, ...fit.project_tradeoffs, ...fit.unit_why, ...fit.unit_why_not, fit.summary || ''].join(' ')
    const bad = all.match(FABRICATION)
    check('🔴 ⭐ 绝不提朝向/景观/楼层/车位(数据 100% 是空的,提了就是编)', !bad, bad ? `编造了「${bad[0]}」` : null)
  }

  console.log(`\n${fail === 0 ? '✅ 全部通过' : '❌ 有失败'}  ${pass} passed, ${fail} failed\n`)
  await pool.end()
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(async (e) => { console.error('测试炸了:', e); await pool.end().catch(() => {}); process.exit(1) })
