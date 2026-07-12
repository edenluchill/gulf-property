/**
 * 画像教练验证 —— 抽取准不准、**会不会编**、问题问得对不对。
 *
 * 最重要的一条:**没提到的字段必须省略,绝不能猜**。这份画像会拿去给客户生成报告,
 * 编一条就是在客户面前撒谎。
 *
 * 跑:  cd backend && npx ts-node -T scripts/test-profile-coach.ts
 */
import { coachProfile } from '../src/luna-tour/client-profile-coach'

let pass = 0, fail = 0
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n      → ${JSON.stringify(detail)}`}`)
  ok ? pass++ : fail++
}

async function main() {
  // ── 1) 基本抽取 ──────────────────────────────────────────────────────────
  console.log('\n【1】读懂经纪的笔记')
  const a = await coachProfile('陆先生，香港投资客，预算300万现金，一家四口有两个小孩，想地铁近，重视5年回报')
  console.log('   抽取:', JSON.stringify(a.extracted))
  check('认出投资', a.extracted.goal === 'invest' || a.extracted.goal === 'both', a.extracted.goal)
  check('认出 300万 = 3000000 AED', a.extracted.budget_max === 3000000 || a.extracted.budget_min === 3000000, a.extracted.budget_max)
  check('认出全款', a.extracted.payment === 'cash', a.extracted.payment)
  check('认出一家四口', a.extracted.family_size === 4, a.extracted.family_size)
  check('认出有小孩', a.extracted.has_children === true, a.extracted.has_children)
  check('认出香港', /香港|hong/i.test(String(a.extracted.nationality || '')), a.extracted.nationality)

  // ⭐ 最关键:笔记里**没说**收租还是转手 → 绝不能编
  check('⭐ 没说的 horizon 必须省略(不猜)', a.extracted.horizon == null, a.extracted.horizon)
  check('⭐ 没说的 has_maid 必须省略(不猜)', a.extracted.has_maid == null, a.extracted.has_maid)

  // ── 2) 问题按条件触发(不是一刀切) ────────────────────────────────────────
  console.log('\n【2】问题要跟这个客户有关')
  console.log('   问:', a.gaps.map((g) => g.question))
  check('最多问 3 条', a.gaps.length <= 3, a.gaps.length)
  check('每条都带可点选项(不用打字)', a.gaps.every((g) => g.options.length >= 2), a.gaps.map((g) => g.options.length))
  check('每条都说清代价(缺了做不了什么)', a.gaps.every((g) => !!g.why))
  // 投资客 + 一家四口 → 该问「收租还是转手」和/或「请保姆吗」
  const keys = a.gaps.map((g) => g.key)
  check('⭐ 投资客 → 问退出周期(决定 1房还是 2房)', keys.includes('horizon'), keys)

  // ── 3) 单身客不该被问「请保姆吗」 ───────────────────────────────────────
  console.log('\n【3】不相关的问题不该出现')
  const b = await coachProfile('王小姐，单身，自住，预算120万，第一次在迪拜买房')
  console.log('   问:', b.gaps.map((g) => g.question))
  const bKeys = b.gaps.map((g) => g.key)
  check('⭐ 单身 → 不问「请保姆吗」', !bKeys.includes('has_maid'), bKeys)
  check('⭐ 自住 → 不问「几年转手」', !bKeys.includes('horizon'), bKeys)
  check('认出自住', b.extracted.goal === 'live', b.extracted.goal)
  check('认出首次置业', b.extracted.first_time_buyer === true, b.extracted.first_time_buyer)

  // ── 4) 中国客户 + 自住 → 该问做饭(开放厨房是减分项) ─────────────────────
  console.log('\n【4】文化维度:开放厨房对中式炒菜是减分项')
  const c = await coachProfile('张先生，中国大陆来的，一家三口自住，预算250万，看中 JVC')
  console.log('   问:', c.gaps.map((g) => g.question))
  const cKeys = c.gaps.map((g) => g.key)
  check('⭐ 中国客户 + 自住 → 问做饭习惯', cKeys.includes('cooking'), cKeys)
  check('认出偏好区域 JVC', (c.extracted.preferred_areas || []).some((x) => /jvc/i.test(x)), c.extracted.preferred_areas)

  // ── 5) 空笔记 → 不炸,问最要命的 ────────────────────────────────────────
  console.log('\n【5】空笔记也要能用')
  const d = await coachProfile('')
  check('空输入不炸', Array.isArray(d.gaps))
  check('先问最要命的(自住还是投资)', d.gaps[0]?.key === 'goal', d.gaps[0]?.key)

  // ── 6) 已知的不再重复问 ─────────────────────────────────────────────────
  console.log('\n【6】问过的不再问')
  const e = await coachProfile('', { goal: 'invest', budget_max: 3000000, payment: 'cash', horizon: 'flip' })
  const eKeys = e.gaps.map((g) => g.key)
  check('已知 goal → 不再问', !eKeys.includes('goal'), eKeys)
  check('已知 horizon → 不再问', !eKeys.includes('horizon'), eKeys)

  console.log(`\n${fail === 0 ? '✅ 全部通过' : '❌ 有失败'}  ${pass} passed, ${fail} failed\n`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => { console.error('测试炸了:', e); process.exit(1) })
