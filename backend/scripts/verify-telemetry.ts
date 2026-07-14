/**
 * 遥测系统回归测试 —— 改 telemetry/* 后必跑。
 *
 * 这套东西的价值全在「出事时能查」,所以它自己**绝不能出事**:
 * 不能吃内存、不能抛错进业务路径、数学不能错。
 *
 * 运行:cd backend && npx ts-node -T scripts/verify-telemetry.ts
 * (最后会往 metrics_minute 写几行再删掉,自清理)
 */
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(__dirname, '../.env') })

import pool from '../src/db/pool'
import { counter, gauge, histogram, peek, seriesCount } from '../src/telemetry'
import { drain, __reset } from '../src/telemetry/metrics'
import { funnel } from '../src/telemetry/funnel'
import { defineAlert, evaluateAlerts, __clearRules } from '../src/telemetry/alerts'
import { flushNow } from '../src/telemetry/flush'

let passed = 0, failed = 0
const ok = (c: boolean, label: string) => {
  if (c) { passed++; console.log(`  ✓ ${label}`) }
  else { failed++; console.error(`  ✗ ${label}`) }
}

async function run() {
  // ── ① counter / histogram / gauge 的数学 ────────────────────────────
  console.log('\n① 数学正确')
  __reset()
  counter('t.hits').inc()
  counter('t.hits').inc(4)
  const h = histogram('t.ms')
  ;[10, 20, 30, 40, 100].forEach((v) => h.observe(v))
  gauge('t.now', () => 42)

  const snap = drain()
  const c = snap.find((s) => s.name === 't.hits')
  const hi = snap.find((s) => s.name === 't.ms')
  const g = snap.find((s) => s.name === 't.now')
  ok(c?.count === 5, 'counter 累加(1 + 4 = 5)')
  ok(hi?.count === 5 && hi?.sum === 200, 'histogram 样本数与 sum')
  ok(hi?.min === 10 && hi?.max === 100, 'histogram min/max')
  ok(hi?.p50 === 30, `histogram p50 = 30(实际 ${hi?.p50})`)
  ok(g?.value === 42, 'gauge 是 pull 式,flush 时求值')

  // drain 后归零 —— 否则 counter 会被反复计入,曲线全是累计值
  const after = drain()
  ok(!after.find((s) => s.name === 't.hits'), 'drain 后 counter 归零(不重复计入)')
  ok(after.find((s) => s.name === 't.now')?.value === 42, 'gauge 不归零(它是瞬时值)')

  // ── ② label 身份稳定 ────────────────────────────────────────────────
  console.log('\n② label 顺序不影响 series 身份')
  __reset()
  counter('t.x', { a: '1', b: '2' }).inc()
  counter('t.x', { b: '2', a: '1' }).inc()
  ok(seriesCount() === 1, '同样的 label 换个顺序 → 还是同一条 series(不裂开)')
  ok(drain().find((s) => s.name === 't.x')?.count === 2, '两次都记到同一条')

  // ── ③ 内存有界(最重要:一个写错的 label 不能撑爆进程)──────────────
  console.log('\n③ 内存有界 —— 把 userId 当 label 灌 10 万条')
  __reset()
  for (let i = 0; i < 100_000; i++) counter('t.bad', { userId: String(i) }).inc()
  ok(seriesCount() <= 500, `series 数被护栏钳在 ${seriesCount()}(上限 500),没有无限增长`)
  const dropSnap = drain()
  ok(!!dropSnap.find((s) => s.name === 'telemetry.series.dropped'),
    '被丢掉的量自己上报为 telemetry.series.dropped(否则"指标莫名少了"永远查不出)')

  console.log('\n   histogram 样本也有上限')
  __reset()
  const big = histogram('t.big')
  for (let i = 0; i < 50_000; i++) big.observe(i)
  const bigSnap = drain().find((s) => s.name === 't.big')
  ok(bigSnap?.count === 50_000, 'count 仍然是真实的 50000(计数不丢)')
  ok((bigSnap?.max ?? 0) === 49_999, 'max 仍然准确')

  // ── ④ 遥测抛错绝不能带崩业务 ────────────────────────────────────────
  console.log('\n④ 遥测自己出错 → 业务照跑')
  __reset()
  let threw = false
  try {
    gauge('t.boom', () => { throw new Error('gauge 读函数炸了') })
    drain()                                   // drain 必须吞掉它
    histogram('t.nan').observe(NaN)           // 脏数据不进统计
    counter('t.ok').inc()
  } catch { threw = true }
  ok(!threw, '读函数抛错 / NaN 都被吞掉,不冒泡到调用方')
  const okSnap = drain()
  ok(okSnap.find((s) => s.name === 't.ok')?.count === 1, '坏 series 不影响其它 series')
  ok(!okSnap.find((s) => s.name === 't.nan'), 'NaN 不进统计(不然一条脏数据毁掉 p95)')

  // ── ⑤ 漏斗:白名单 + 转化 ───────────────────────────────────────────
  console.log('\n⑤ 漏斗')
  __reset()
  const f = funnel('t.flow', ['a', 'b'] as const)
  f.step('a'); f.step('a'); f.step('b')
  f.step('zzz')                                // 未声明的步骤
  const fs = drain().filter((s) => s.name === 'funnel.t.flow')
  ok(fs.length === 2, '只记了声明过的两步')
  ok(!fs.find((s) => s.labels.step === 'zzz'), '未声明的步骤被丢弃(label 基数护栏)')
  ok(fs.find((s) => s.labels.step === 'a')?.count === 2, 'a 步 2 次')

  // ── ⑥ flush 落库 + 幂等 ─────────────────────────────────────────────
  console.log('\n⑥ flush 落库(同一分钟重复 flush → 覆盖不重复插)')
  __reset()
  counter('t.verify.flush').inc(7)
  const n1 = await flushNow()
  ok(n1 >= 1, `写了 ${n1} 行`)
  counter('t.verify.flush').inc(3)
  await flushNow()                             // 同一分钟再 flush 一次
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n, max(count) AS last FROM metrics_minute WHERE name = 't.verify.flush'`
  )
  ok(rows[0].n === 1, '同一分钟只有一行(ON CONFLICT 覆盖,不是插两行)')
  ok(Number(rows[0].last) === 3, '覆盖成最新一次的值')

  // ── ⑦ 告警状态机 ───────────────────────────────────────────────────
  console.log('\n⑦ 告警状态机(突破 → 开事故 → 恢复 → 关闭)')
  __clearRules()
  let fake = 99
  defineAlert({
    kind: 'T_VERIFY_FAKE', severity: 'warn', threshold: 75,
    read: () => fake, breach: (v) => v > 75,
    message: (v) => `测试告警 ${v}`,
  })
  await evaluateAlerts()
  const open = await pool.query(`SELECT id FROM perf_alerts WHERE kind='T_VERIFY_FAKE' AND resolved_at IS NULL`)
  ok(open.rowCount === 1, '突破阈值 → 开了一条告警')

  await evaluateAlerts()                       // 再跑一次,不该重复开
  const dup = await pool.query(`SELECT count(*)::int AS n FROM perf_alerts WHERE kind='T_VERIFY_FAKE' AND resolved_at IS NULL`)
  ok(dup.rows[0].n === 1, '持续突破不重复开(只在状态跳变时发信,天然去抖)')

  fake = 10
  await evaluateAlerts()
  const resolved = await pool.query(`SELECT resolved_at FROM perf_alerts WHERE kind='T_VERIFY_FAKE' ORDER BY id DESC LIMIT 1`)
  ok(!!resolved.rows[0]?.resolved_at, '恢复 → 自动关闭(状态类告警可以自愈)')

  // 清理
  await pool.query(`DELETE FROM metrics_minute WHERE name LIKE 't.verify.%'`)
  await pool.query(`DELETE FROM perf_alerts WHERE kind = 'T_VERIFY_FAKE'`)
  console.log('\n🧹 已清理测试数据')

  console.log(`\n${failed === 0 ? '✅ 全过' : '❌ 有失败'}:${passed} 通过 / ${failed} 失败`)
  await pool.end()
  process.exit(failed === 0 ? 0 : 1)
}

run().catch(async (e) => { console.error('💥', e); await pool.end(); process.exit(1) })
