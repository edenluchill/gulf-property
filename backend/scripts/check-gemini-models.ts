/**
 * Gemini 模型体检 —— 两件事:
 *   ① **活性**:models.ts 里定义的每个模型,真调一次,看还活着没
 *   ② **合规**:代码里有没有人绕过常量、裸写模型名(那就是漂移的起点)
 *
 * WHY:模型会被废弃/关停,而**调用方不会立刻知道**。项目里栽过两次:
 *   - 全站写着 `gemini-3-flash`(**404,不存在**)→ 每次调用先撞 404 再 fallback,
 *     整个项目的 AI 一直跑在 2.5 上,一个月没人发现。
 *   - PDF 楼书管线的 project-description-generator 用着 `gemini-3-pro-preview`
 *     (**已关停,直接 404**)→ 每传一份楼书那步都在失败,只有一行 console.warn。
 *
 * 现在模型名收口在 src/services/ai/models.ts,调用走 callGemini(带埋点+告警)。
 * 这个脚本是最后一道:发版前 / 每月跑一次。
 *
 * 用法:cd backend && npx ts-node -T scripts/check-gemini-models.ts
 */
import { config } from 'dotenv'
import { resolve, join } from 'path'
import { readFileSync, readdirSync, statSync } from 'fs'
config({ path: resolve(__dirname, '../.env') })

import { GoogleGenAI } from '@google/genai'
import { FLASH, FLASH_LITE, PRO, LIVE_AUDIO, BANNED } from '../src/services/ai/models'

const LIVE_ONLY = new Set([LIVE_AUDIO])

/** 扫 src/,找出**没走常量**的裸模型名(注释除外)。 */
function scanHardcoded(): { file: string; model: string }[] {
  const hits: { file: string; model: string }[] = []
  const root = resolve(__dirname, '../src')
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) { walk(p); continue }
      if (!name.endsWith('.ts')) continue
      if (p.includes('services' + require('path').sep + 'ai')) continue   // models.ts 本身允许
      const src = readFileSync(p, 'utf8')
      src.split('\n').forEach((line) => {
        const code = line.split('//')[0]                    // 去掉行尾注释
        if (code.trim().startsWith('*')) return             // 块注释正文
        const m = code.match(/['"`](gemini-[\w.\-]+)['"`]/)
        if (m) hits.push({ file: p.replace(root, 'src'), model: m[1] })
      })
    }
  }
  walk(root)
  return hits
}

async function run() {
  const key = process.env.GEMINI_API_KEY
  if (!key) { console.error('❌ 没有 GEMINI_API_KEY'); process.exit(1) }
  const ai = new GoogleGenAI({ apiKey: key })

  let bad = 0

  // ── ① 活性 ────────────────────────────────────────────────────────
  console.log('① 活性(models.ts 里定义的,真调一次):\n')
  for (const model of [FLASH, FLASH_LITE, PRO, LIVE_AUDIO]) {
    if (LIVE_ONLY.has(model)) {
      console.log(`  ⏭️  ${model.padEnd(46)} Live API 专用,generateContent 测不了`)
      continue
    }
    const t0 = Date.now()
    try {
      const r = await ai.models.generateContent({ model, contents: 'ping', config: { maxOutputTokens: 1 } })
      // 有的模型已关停但仍会 resolve → 回包的 modelVersion 才是**真正跑的那个**
      const actual = (r as unknown as { modelVersion?: string }).modelVersion
      const drift = actual && !model.startsWith(actual) && !actual.startsWith(model)
        ? ` ⚠️ 实际跑的是 ${actual}` : ''
      console.log(`  ✅ ${model.padEnd(46)} ${String(Date.now() - t0).padStart(5)}ms${drift}`)
      if (drift) bad++
    } catch (e) {
      bad++
      console.log(`  ❌ ${model.padEnd(46)} ${(e as Error).message.slice(0, 70)}`)
    }
  }

  // ── ② 合规 ────────────────────────────────────────────────────────
  console.log('\n② 合规(代码里不该再有裸写的模型名 —— 那是漂移的起点):\n')
  const hits = scanHardcoded()
  if (hits.length === 0) {
    console.log('  ✅ 没有裸写,全部走 services/ai/models.ts 的常量')
  } else {
    for (const h of hits) {
      const dead = BANNED.includes(h.model)
      if (dead) bad++
      console.log(`  ${dead ? '❌' : '⚠️ '} ${h.file}  →  '${h.model}'${dead ? '  【已废弃/404】' : ''}`)
    }
    console.log('\n  裸写的模型名改成 import { FLASH } from \'services/ai/models\'')
  }

  console.log(`\n${bad === 0 ? '✅ 全绿' : `❌ ${bad} 处有问题`}`)
  process.exit(bad === 0 ? 0 : 1)
}

run().catch((e) => { console.error('💥', e); process.exit(1) })
