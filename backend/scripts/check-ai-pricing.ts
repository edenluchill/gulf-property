/**
 * AI 单价巡检 —— **改模型 / 谈换 provider 前跑一遍**。
 *
 *   cd backend && npx ts-node -T scripts/check-ai-pricing.ts
 *
 * 干三件事:
 *   ① 列出**过期或没核对过**的单价(价格没有 API 能查,只能人肉对官网)
 *   ② 抓**在用的模型没有单价**的情况 —— 那种会静默回落到兜底价,
 *      成本看板上的数字就是编的
 *   ③ 抓代码里**绕过 pricing.ts 裸写数字**的地方(和 check-gemini-models.ts 同一个思路:
 *      单一真相源只有靠巡检才守得住)
 *
 * 退出码非 0 = 有需要人处理的东西。
 */
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'
import { PRICES, priceKeyOf, stalePrices } from '../src/services/ai/pricing'
import { FLASH, FLASH_LITE, PRO, LIVE_AUDIO, TTS_CHAIN } from '../src/services/ai/models'

const SRC = join(__dirname, '..', 'src')
const STALE_DAYS = 90

// 官方价目表 —— 核对的时候直接开这几个
const SOURCES: Record<string, string> = {
  google: 'https://ai.google.dev/gemini-api/docs/pricing',
  openai: 'https://openai.com/api/pricing/',
  anthropic: 'https://platform.claude.com/docs/en/pricing',
}

let problems = 0

// ── ① 过期 / 未核对 ─────────────────────────────────────────────────────────
const stale = stalePrices(STALE_DAYS)
if (stale.length) {
  console.log(`\n⚠️  ${stale.length} 条单价需要人工核对(>${STALE_DAYS} 天没核对,或从没核对过):\n`)
  for (const s of stale) {
    const provider = PRICES[s.key].provider
    console.log(
      `   ${s.verified ? '⏰' : '❓'} ${s.key.padEnd(52)} ` +
      `录于 ${s.asOf}(${s.ageDays} 天前)  → ${SOURCES[provider]}`
    )
  }
  console.log('\n   核对完改 pricing.ts 里的 asOf + verified。')
  problems += stale.length
} else {
  console.log('✅ 所有单价都在核对有效期内。')
}

// ── ② 在用的模型有没有单价 ──────────────────────────────────────────────────
const inUse = [FLASH, FLASH_LITE, PRO, LIVE_AUDIO, ...TTS_CHAIN]
const missing = inUse.filter((m) => !PRICES[priceKeyOf(m)])
if (missing.length) {
  console.log(`\n🔴 ${missing.length} 个**在用**的模型没有单价 —— 它们的成本会按兜底价算(= 编的):\n`)
  missing.forEach((m) => console.log(`   ${m}   ← 去 pricing.ts 加一行`))
  problems += missing.length * 10   // 这个比过期严重得多
} else {
  console.log('✅ 在用的模型都有单价。')
}

// ── ③ 有没有人绕过 pricing.ts 裸写单价 ──────────────────────────────────────
// 找「一眼像 per-1M 单价」的字面量:0.25 / 1.5 / 9.0 之类紧挨着 in/out/token 的写法。
const SUSPECT = /(\bin\b|\bout\b|per[_ ]?1?m|usd|price|cost)\s*[:=]\s*\d+(\.\d+)?/i
const SKIP = new Set(['pricing.ts'])

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue
      walk(p, out)
    } else if (name.endsWith('.ts') && !SKIP.has(name)) {
      out.push(p)
    }
  }
  return out
}

const hits: string[] = []
for (const file of walk(SRC)) {
  const text = readFileSync(file, 'utf8')
  // 只在明显和 AI 计费相关的文件里找 —— 否则整个后端到处是 price 字样(房价!)
  if (!/usageMetadata|tokenCount|usd_micro|costUsd/.test(text)) continue
  text.split('\n').forEach((line, i) => {
    if (line.trim().startsWith('*') || line.trim().startsWith('//')) return
    if (SUSPECT.test(line) && /\d+\.\d+/.test(line)) {
      hits.push(`   ${relative(SRC, file)}:${i + 1}  ${line.trim().slice(0, 90)}`)
    }
  })
}
if (hits.length) {
  console.log(`\n⚠️  可能有单价被裸写在计费相关的代码里(应该只在 pricing.ts):\n`)
  hits.forEach((h) => console.log(h))
  console.log('\n   如果是误报就忽略;如果真是单价,搬进 PRICES。')
} else {
  console.log('✅ 没发现绕过 pricing.ts 裸写的单价。')
}

console.log(
  problems
    ? `\n需要处理 ${problems} 项(见上)。\n`
    : '\n全部通过。\n'
)
process.exit(problems ? 1 : 0)
