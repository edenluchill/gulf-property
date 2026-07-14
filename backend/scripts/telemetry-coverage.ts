/**
 * 遥测覆盖率扫描 —— **哪些地方还是盲的**。
 *
 * 功能太多、记不住,所以不靠人脑盘点。这个脚本客观地找出:
 *   ① **有风险的代码**:调外部服务(Stripe/Gemini/R2/Agora/邮件/HTTP)、或有
 *      「静默失败」的形状(空 catch / catch 里只 console / 提前 return)
 *   ② 但**没有任何遥测**(没 import telemetry)
 *
 * 静默失败的形状是重点 —— 5xx 会被 perfSink 立案,而
 * 「返回 200 但其实什么都没干」的路径**永远不会被发现**
 * (已经栽过三次:收钱没发货 / tour 语音假成功 / unknown tool,
 *  见 docs/reports/2026-07-13-feature-telemetry-audit.md)。
 *
 * 用法:cd backend && npx ts-node -T scripts/telemetry-coverage.ts
 *       npx ts-node -T scripts/telemetry-coverage.ts --all   # 连已覆盖的也列出来
 */
import { readFileSync, readdirSync, statSync } from 'fs'
import { resolve, join, relative, sep } from 'path'

const ROOT = resolve(__dirname, '../src')
const SHOW_ALL = process.argv.includes('--all')

/** 外部依赖 —— 会失败、会花钱、会拖慢。调了这些就该有遥测。 */
const RISKS: { key: string; re: RegExp; what: string }[] = [
  { key: 'gemini', re: /GoogleGenAI|GoogleGenerativeAI|generateContent|callGemini/, what: 'AI(花钱/会挂)' },
  { key: 'stripe', re: /stripe\.\w+\.(create|retrieve|update|list)|constructEvent/, what: 'Stripe(钱)' },
  { key: 'r2', re: /uploadBufferToR2|S3Client|PutObjectCommand|GetObjectCommand/, what: 'R2 存储' },
  { key: 'agora', re: /RtcTokenBuilder|agora/i, what: 'Agora(花钱)' },
  { key: 'email', re: /sendAlertEmail|resend|nodemailer/i, what: '邮件' },
  { key: 'http', re: /\bfetch\(|axios\.|apiFetch\(/, what: '外部 HTTP' },
  { key: 'supabase', re: /supabase\.|jwtVerify|createRemoteJWKSet/, what: '认证' },
]

/** 静默失败的形状 —— 最危险,因为 5xx 告警抓不到它们。 */
const SILENT: { key: string; re: RegExp; what: string }[] = [
  { key: 'empty_catch', re: /catch\s*(\([^)]*\))?\s*\{\s*(\/\*[^*]*\*\/)?\s*\}/, what: '空 catch(吞错)' },
  { key: 'catch_void', re: /\.catch\(\s*\(\s*\)\s*=>\s*\{?\s*\}?\s*\)/, what: '.catch(()=>{}) (吞错)' },
  { key: 'warn_return', re: /console\.warn[\s\S]{0,120}?\breturn\b/, what: 'console.warn + return(静默退出)' },
]

interface Hit {
  file: string
  risks: string[]
  silent: string[]
  hasTelemetry: boolean
  lines: number
  critical: boolean
}

/**
 * 分级 —— 不是所有空 catch 都值得埋。
 *
 * **该埋的**:花钱的(AI/Stripe/Agora/R2)、会静默失败伤客户的、异步/后台跑的
 * (客户看不到但会受伤)、以及监控系统自己(邮件挂了 = 所有告警失效)。
 *
 * **不用埋的**:纯读接口(HTTP 层的 perfSink 已经量了 p95 和 5xx)、
 * 一次性脚本、内部工具函数里那种「JSON.parse 失败就用默认值」的无害 catch。
 */
const NOT_WORTH = [
  'db/pool.ts',                    // catch 是连接池的重试兜底
  'db/import-', 'db/area-resolver',// 一次性导入/内部解析工具
  'middleware/perfMetrics.ts',     // 遥测自己(它的 catch 就是"绝不影响业务")
  'middleware/attribution.ts',     // 同上,采样归因
  'seed-demo', 'test-',            // 种子/测试
  'services/analyticsQueries.ts',  // 纯读(dashboard 查询)
  'routes/ai-projects.ts', 'routes/market.ts', 'routes/project-insights.ts',
  'routes/favorites.ts',           // 纯读/简单写,perfSink 的 5xx 立案已覆盖
  'lib/agent-identity.ts', 'middleware/requireOwner.ts',
  'langgraph/utils/', 'langgraph/core/',   // 内部纯函数(失败会冒泡到 withRetry,那里已埋)
]

const SKIP = ['telemetry', 'db' + sep + 'migrations', '.test.', 'types', '.d.ts']

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { walk(p, out); continue }
    if (!name.endsWith('.ts')) continue
    const rel = relative(ROOT, p)
    if (SKIP.some((s) => rel.includes(s))) continue
    out.push(p)
  }
  return out
}

function analyze(p: string): Hit | null {
  const src = readFileSync(p, 'utf8')
  // 去掉块注释,免得注释里的示例代码被当成真调用
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '')
  const risks = RISKS.filter((r) => r.re.test(code)).map((r) => r.what)
  const silent = SILENT.filter((r) => r.re.test(code)).map((r) => r.what)
  if (!risks.length && !silent.length) return null
  const file = relative(ROOT, p).replace(/\\/g, '/')
  return {
    file,
    risks,
    silent,
    hasTelemetry: /from '.*telemetry'|require\(.*telemetry/.test(code),
    lines: src.split('\n').length,
    critical: !NOT_WORTH.some((n) => file.includes(n)),
  }
}

const all = walk(ROOT).map(analyze).filter(Boolean) as Hit[]
// 只对「值得埋」的算覆盖率 —— 否则百分比被一堆无害的 catch 稀释,只会制造焦虑
const hits = all.filter((h) => h.critical)
const skipped = all.filter((h) => !h.critical)
const blind = hits.filter((h) => !h.hasTelemetry)
const covered = hits.filter((h) => h.hasTelemetry)

// 排序:有静默失败形状的排最前(最危险),其次风险项多的
const score = (h: Hit) => h.silent.length * 10 + h.risks.length
blind.sort((a, b) => score(b) - score(a))

console.log(`\n遥测覆盖率:${covered.length}/${hits.length} 个**值得埋**的文件已埋点`
  + `(${Math.round((covered.length / hits.length) * 100)}%)`)
console.log(`(另有 ${skipped.length} 个有 catch 但不值得埋:纯读接口 / 一次性脚本 / 内部工具的无害 fallback)\n`)

console.log(`🔴 还是盲的(${blind.length} 个)—— 花钱的、会静默失败的、异步的,但零遥测:\n`)
for (const h of blind) {
  const tags = [...h.risks, ...h.silent.map((s) => `⚠️${s}`)].join(' · ')
  console.log(`  ${h.file.padEnd(46)} ${tags}`)
}

if (SHOW_ALL) {
  console.log(`\n✅ 已覆盖(${covered.length} 个):\n`)
  for (const h of covered) console.log(`  ${h.file}`)
}

console.log(`\n判读:`)
console.log(`  · 「⚠️空 catch / console.warn + return」最危险 —— 它们返回 200 但什么都没干,`)
console.log(`    5xx 告警**永远抓不到**(已栽过三次:收钱没发货/语音假成功/unknown tool)。`)
console.log(`  · 纯读接口(查 DB 返回数据)不埋也行 —— HTTP 层的 perfSink 已经量了 p95 和 5xx。`)
console.log(`  · 真正要埋的是:花钱的、会静默失败的、异步/后台的、客户看不到但会受伤的。\n`)
