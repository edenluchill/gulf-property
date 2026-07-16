/**
 * i18n AI 批翻脚本 —— 读 frontend 的 en/<ns>.json,用 Gemini 产 ar/ru/fr/<ns>.json。
 *
 * 用法:
 *   npx ts-node -T scripts/i18n-translate.ts compare invest        # 指定命名空间
 *   npx ts-node -T scripts/i18n-translate.ts --all                 # 所有有 en 的 ns
 *   npx ts-node -T scripts/i18n-translate.ts compare --langs ar,ru # 只翻部分语言
 *   npx ts-node -T scripts/i18n-translate.ts compare --force       # 覆盖已存在的
 *
 * 保证:key 结构不变、{{插值}} 占位符原样保留、AED/m²/DLD/项目名不译。
 * 缺的语言 JSON 会被创建;已存在的默认跳过(除非 --force)。
 */
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(__dirname, '../.env') }) // 必须在 import gemini 前加载 GEMINI_API_KEY
import * as fs from 'fs'
import * as path from 'path'
import { callGemini } from '../src/services/ai/gemini'

const LOCALES = path.resolve(__dirname, '../../frontend/src/i18n/locales')
const LANG_NAME: Record<string, string> = { ar: 'Arabic (العربية)', ru: 'Russian (Русский)', fr: 'French (Français)', zh: 'Simplified Chinese' }

const rawArgs = process.argv.slice(2)
const force = rawArgs.includes('--force')
// 解析 --langs ar,ru / --langs=ar,ru;把 flag 及其值都标记为"已消费"。
let langsArg = ''
const consumed = new Set<number>()
rawArgs.forEach((a, i) => {
  if (a === '--langs') { langsArg = rawArgs[i + 1] || ''; consumed.add(i); consumed.add(i + 1) }
  else if (a.startsWith('--langs=')) { langsArg = a.split('=')[1]; consumed.add(i) }
})
const targetLangs = (langsArg ? langsArg.split(',') : ['ar', 'ru', 'fr']).map((s) => s.trim()).filter(Boolean)

function namespaces(): string[] {
  if (rawArgs.includes('--all')) {
    return fs.readdirSync(path.join(LOCALES, 'en')).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''))
  }
  return rawArgs.filter((a, i) => !a.startsWith('--') && !consumed.has(i))
}

function prompt(enJson: string, lang: string): string {
  return `You are a professional localizer for a Dubai off-plan real-estate app.
Translate the JSON below from English into ${LANG_NAME[lang] || lang}.

RULES:
- Return ONLY a JSON object with the EXACT same keys and nesting. No prose, no markdown.
- Translate ONLY the string VALUES. Keep keys unchanged.
- Preserve every {{placeholder}} token EXACTLY (do not translate or reorder its name).
- Keep these untranslated: AED, m², ㎡, sqft, DLD, %, pp, numbers, and any project/developer names.
- Natural, concise, professional tone for property buyers. Keep it short (UI labels).
${lang === 'ar' ? '- Arabic: fluent MSA, right-to-left is handled by the app.\n' : ''}
JSON to translate:
${enJson}`
}

async function translateNs(ns: string, lang: string): Promise<void> {
  const enPath = path.join(LOCALES, 'en', `${ns}.json`)
  if (!fs.existsSync(enPath)) { console.log(`  ⚠ ${ns}: no en/${ns}.json, skip`); return }
  const outDir = path.join(LOCALES, lang)
  const outPath = path.join(outDir, `${ns}.json`)
  if (fs.existsSync(outPath) && !force) { console.log(`  · ${lang}/${ns}.json exists (use --force to overwrite)`); return }

  const enJson = fs.readFileSync(enPath, 'utf8')
  const { text, model, usd } = await callGemini({
    task: 'i18n.translate',
    contents: prompt(enJson, lang),
    config: { responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'low' } },
  })
  // 校验:必须是合法 JSON 且 key 集合与 en 一致(粗校验顶层 key)。
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { throw new Error(`${lang}/${ns}: Gemini returned non-JSON`) }
  const enKeys = Object.keys(JSON.parse(enJson)).sort().join(',')
  const outKeys = Object.keys(parsed as object).sort().join(',')
  if (enKeys !== outKeys) console.log(`  ⚠ ${lang}/${ns}: top-level keys differ (en=[${enKeys}] out=[${outKeys}]) — 请人工核对`)

  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(outPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8')
  console.log(`  ✅ ${lang}/${ns}.json  [${model}, $${usd.toFixed(4)}]`)
}

async function main() {
  const nsList = namespaces()
  if (nsList.length === 0) { console.log('用法: i18n-translate.ts <ns...> | --all  [--langs ar,ru,fr] [--force]'); process.exit(1) }
  console.log(`翻译 ns=[${nsList.join(', ')}] → langs=[${targetLangs.join(', ')}]${force ? ' (force)' : ''}`)
  for (const ns of nsList) {
    console.log(`\n[${ns}]`)
    for (const lang of targetLangs) {
      try { await translateNs(ns, lang) } catch (e) { console.log(`  ✗ ${lang}/${ns}: ${(e as Error).message}`) }
    }
  }
  console.log('\n完成。记得跑 tsc + 人工抽查(尤其 ar)。')
}
main()
