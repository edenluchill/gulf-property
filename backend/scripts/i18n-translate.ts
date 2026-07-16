/**
 * i18n AI 批翻脚本 —— 读 frontend 的 en/<ns>.json,用 Gemini 产 ar/ru/fr/<ns>.json。
 *
 * 用法:
 *   npx ts-node -T scripts/i18n-translate.ts compare invest        # 指定命名空间
 *   npx ts-node -T scripts/i18n-translate.ts --all                 # 所有有 en 的 ns
 *   npx ts-node -T scripts/i18n-translate.ts compare --langs ar,ru # 只翻部分语言
 *   npx ts-node -T scripts/i18n-translate.ts lunaTour --missing    # ⭐ 只翻缺的键,合并
 *   npx ts-node -T scripts/i18n-translate.ts compare --force       # 整文件重翻(覆盖)
 *
 * 保证:key 结构不变、{{插值}} 占位符原样保留、AED/m²/DLD/项目名不译。
 *
 * 【三种模式,别搞混】
 *   默认       目标文件已存在 → **整个跳过**(一个键都不加)
 *   --force    整个 ns 重翻覆盖 → 已校对过的译文会被**冲掉**(churn),大 ns 慎用
 *   --missing  ⭐ 只把 en 有、目标缺的键送去翻,再深合并回目标文件。
 *              已有译文一个字不动;成本只跟新增键数走。
 *              这是给**大 ns 加新键**的正解 —— 以前只能"新键塞进独立小 ns"来绕开,
 *              那是在绕工具缺陷,不是设计。
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
const missingOnly = rawArgs.includes('--missing')
// 解析 --langs ar,ru / --langs=ar,ru;把 flag 及其值都标记为"已消费"。
let langsArg = ''
const consumed = new Set<number>()
rawArgs.forEach((a, i) => {
  if (a === '--langs') { langsArg = rawArgs[i + 1] || ''; consumed.add(i); consumed.add(i + 1) }
  else if (a.startsWith('--langs=')) { langsArg = a.split('=')[1]; consumed.add(i) }
})
const targetLangs = (langsArg ? langsArg.split(',') : ['ar', 'ru', 'fr']).map((s) => s.trim()).filter(Boolean)

type Json = Record<string, any>

/** {a:{b:'x'}} → {'a.b':'x'}。locale 里 0 个键含点号(已核),故 '.' 做分隔符安全。 */
function flatten(o: Json, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(o)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(out, flatten(v, key))
    else out[key] = String(v)
  }
  return out
}

/** {'a.b':'x'} → {a:{b:'x'}} */
function unflatten(flat: Record<string, string>): Json {
  const out: Json = {}
  for (const [k, v] of Object.entries(flat)) {
    const parts = k.split('.')
    let cur = out
    for (let i = 0; i < parts.length - 1; i++) {
      if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {}
      cur = cur[parts[i]]
    }
    cur[parts[parts.length - 1]] = v
  }
  return out
}

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
  const exists = fs.existsSync(outPath)
  if (exists && !force && !missingOnly) {
    console.log(`  · ${lang}/${ns}.json exists (--missing 补缺键 / --force 整个重翻)`); return
  }

  // --missing:只把"en 有、目标缺"的键送去翻,翻完深合并。已有译文一个字不动。
  let enJson: string
  let existingFlat: Record<string, string> = {}
  if (missingOnly && exists) {
    const enFlat = flatten(JSON.parse(fs.readFileSync(enPath, 'utf8')))
    existingFlat = flatten(JSON.parse(fs.readFileSync(outPath, 'utf8')))
    const missing = Object.fromEntries(Object.entries(enFlat).filter(([k]) => !(k in existingFlat)))
    const n = Object.keys(missing).length
    if (n === 0) { console.log(`  · ${lang}/${ns}.json 已齐(0 缺键)`); return }
    console.log(`  ⟳ ${lang}/${ns}.json 缺 ${n} 键 → 只翻这些`)
    enJson = JSON.stringify(unflatten(missing), null, 2)
  } else {
    enJson = fs.readFileSync(enPath, 'utf8')
  }
  const { text, model, usd } = await callGemini({
    task: 'i18n.translate',
    contents: prompt(enJson, lang),
    config: { responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'low' } },
  })
  // 校验:必须是合法 JSON 且 key 集合与 en 一致(粗校验顶层 key)。
  // 偶尔模型会裹 ```json 围栏或加话 → 剥掉围栏、截到第一个 { 到最后一个 }。
  let parsed: unknown
  const cleaned = (() => {
    let s = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
    const a = s.indexOf('{'), b = s.lastIndexOf('}')
    return a >= 0 && b > a ? s.slice(a, b + 1) : s
  })()
  try { parsed = JSON.parse(cleaned) } catch { throw new Error(`${lang}/${ns}: Gemini returned non-JSON`) }
  // 校验对象 = 这轮**送去翻的那批**(--missing 下就是缺的那些键,不是整个 en)。
  const sentFlat = flatten(JSON.parse(enJson))
  const gotFlat = flatten(parsed as Json)
  const lost = Object.keys(sentFlat).filter((k) => !(k in gotFlat))
  const extra = Object.keys(gotFlat).filter((k) => !(k in sentFlat))
  if (lost.length) console.log(`  ⚠ ${lang}/${ns}: 模型漏了 ${lost.length} 键 (${lost.slice(0, 5).join(', ')}…) — 请人工核对`)
  if (extra.length) console.log(`  ⚠ ${lang}/${ns}: 模型多编了 ${extra.length} 键 (${extra.slice(0, 5).join(', ')}…) — 请人工核对`)

  // --missing:合并回原文件。**已有键优先**,模型即使把旧键也回了一遍也冲不掉译文。
  const finalJson = missingOnly && Object.keys(existingFlat).length
    ? unflatten({ ...gotFlat, ...existingFlat })
    : (parsed as Json)

  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(outPath, JSON.stringify(finalJson, null, 2) + '\n', 'utf8')
  console.log(`  ✅ ${lang}/${ns}.json  [${model}, $${usd.toFixed(4)}]`)
}

async function main() {
  const nsList = namespaces()
  if (nsList.length === 0) { console.log('用法: i18n-translate.ts <ns...> | --all  [--langs ar,ru,fr] [--missing|--force]'); process.exit(1) }
  if (force && missingOnly) { console.log('✗ --force 与 --missing 互斥:前者整个重翻覆盖,后者只补缺键。'); process.exit(1) }
  const mode = missingOnly ? ' (missing-only)' : force ? ' (force/整个重翻)' : ''
  console.log(`翻译 ns=[${nsList.join(', ')}] → langs=[${targetLangs.join(', ')}]${mode}`)
  for (const ns of nsList) {
    console.log(`\n[${ns}]`)
    for (const lang of targetLangs) {
      try { await translateNs(ns, lang) } catch (e) { console.log(`  ✗ ${lang}/${ns}: ${(e as Error).message}`) }
    }
  }
  console.log('\n完成。记得跑 tsc + 人工抽查(尤其 ar)。')
}
main()
