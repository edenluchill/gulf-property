/**
 * 遥测本身的开销 —— **它有没有拖累业务?**
 *
 * 高频路径是 collab 的 fanout(20Hz × 每个房间 × 每个参与者):
 * 1000 人同时带看 = 每秒 13,000 次扇出,每次扇出要打 3 个 counter + 1 个 histogram。
 * 如果单次埋点是微秒级,那就是每秒几十毫秒的开销 —— 不可接受。
 * 必须实测。
 *
 * 用法:cd backend && npx ts-node -T scripts/bench-telemetry.ts
 */
import { counter, histogram, gauge, peek, seriesCount } from '../src/telemetry'
import { drain, __reset } from '../src/telemetry/metrics'

const N = 1_000_000

function bench(label: string, fn: () => void, n = N): number {
  // 预热(让 JIT 优化生效,否则量的是解释执行)
  for (let i = 0; i < 10_000; i++) fn()
  const t0 = process.hrtime.bigint()
  for (let i = 0; i < n; i++) fn()
  const ns = Number(process.hrtime.bigint() - t0) / n
  console.log(`  ${label.padEnd(42)} ${ns.toFixed(0).padStart(4)} ns/次   (${(1e9 / ns / 1e6).toFixed(1)}M 次/秒)`)
  return ns
}

console.log('\n单次埋点的开销:\n')
__reset()

const nsCounterNoLabel = bench('counter(name).inc()  无 label', () => {
  counter('bench.plain').inc()
})
const nsCounterLabel = bench("counter(name, {a:'x'}).inc()  带 label", () => {
  counter('bench.labeled', { role: 'viewer' }).inc()
})
const nsHist = bench('histogram(name).observe(ms)', () => {
  histogram('bench.ms').observe(12)
})

// 对照组:业务本身在做的事(fanout 每帧都要 JSON.stringify)
const msg = { k: 'cam', t: Date.now(), c: [55.27, 25.2], z: 14, b: 0, p: 0, vw: 1180, vh: 800 }
const nsJson = bench('【对照】JSON.stringify(一帧 cam)', () => {
  JSON.stringify(msg)
}, 200_000)

console.log('\n──────────────────────────────────────────────────────────────')
console.log('\n真实场景:1000 人同时带看(250 房 × 4 人,20Hz)\n')

// 每次 fanout:3 个 counter + 1 个 histogram(见 collab-rooms.ts 的 fanout)
const perFanout = nsCounterNoLabel * 2 + nsHist + nsCounterNoLabel
const fanoutsPerSec = 250 * 20            // 250 个 presenter,每个 20Hz
const telemetryMsPerSec = (perFanout * fanoutsPerSec) / 1e6
const jsonMsPerSec = (nsJson * fanoutsPerSec) / 1e6

console.log(`  扇出次数        ${fanoutsPerSec}/秒`)
console.log(`  埋点开销        ${telemetryMsPerSec.toFixed(2)} ms/秒  = 单核的 ${(telemetryMsPerSec / 10).toFixed(3)}%`)
console.log(`  (对照)JSON 序列化 ${jsonMsPerSec.toFixed(2)} ms/秒  = 单核的 ${(jsonMsPerSec / 10).toFixed(3)}%`)
console.log(`\n  → 埋点是 JSON 序列化的 ${(telemetryMsPerSec / jsonMsPerSec).toFixed(2)} 倍`)

// 内存
const snap = drain()
console.log(`\n内存:${seriesCount()} 条 series(上限 500)· drain 出 ${snap.length} 条快照`)

const mem = process.memoryUsage()
console.log(`  进程 RSS ${Math.round(mem.rss / 1e6)}MB · heap ${Math.round(mem.heapUsed / 1e6)}MB`)

console.log(`\n判读:埋点开销如果 < 单核的 1%,就不用管;如果和 JSON 序列化同量级,那也无所谓`)
console.log(`     (因为业务本来就要 stringify 每一帧)。超过 5% 才需要优化。\n`)
