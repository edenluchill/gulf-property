/** 验证带看意向报告的 AI 缓存:第一次生成,第二次必须秒回且内容一致。 */
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(__dirname, '../.env') })

import { getCollabReport } from '../src/services/collabReport'

const code = process.argv[2] || 'CKJDY'

async function timed(label: string) {
  const t = Date.now()
  const r = await getCollabReport(code)
  const ms = Date.now() - t
  console.log(`${label}: ${ms}ms  ai=${r?.ai ? '有' : '无'}  summary=${(r?.ai?.summary || '').slice(0, 40)}`)
  return { ms, ai: r?.ai }
}

;(async () => {
  const a = await timed('第一次(应生成 + 写缓存)')
  const b = await timed('第二次(应命中缓存)')
  const norm = (x: any) => x && JSON.stringify({ s: x.summary, i: x.interest_level, g: x.signals, f: x.follow_up })
  const same = norm(a.ai) === norm(b.ai)
  console.log(`\n内容一致: ${same ? 'PASS' : 'FAIL'}`)
  console.log(`提速: ${a.ms}ms → ${b.ms}ms  ${b.ms < a.ms / 3 ? 'PASS' : 'FAIL(没明显变快)'}`)
  process.exit(0)
})()
