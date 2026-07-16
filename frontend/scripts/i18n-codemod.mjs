/**
 * i18n 三元 codemod —— 把 `zh ? '中' : '英'` 内联双语三元抽成 t('<ns>:key')。
 *
 * 用法: node scripts/i18n-codemod.mjs <file.tsx> <namespace> [--write]
 *   不带 --write = 干跑(只报告,不改文件/JSON)。带 --write = 真改。
 *
 * 安全原则(改代码工具,宁可少转不可弄坏):
 *  - 只碰**条件含 zh 判定**(zh / isZh / startsWith('zh'))的三元;
 *  - 只碰两个分支都是**字符串/无插值模板/单标识符插值模板**的;
 *  - **靠 CJK 字符判定哪个分支是中文**(不靠三元顺序,更稳);
 *  - 嵌套三元、复杂插值、两分支都/都不含 CJK → **跳过并报告**,人工处理;
 *  - JSON key 从英文串生成 camelCase + 去重;
 *  - 不自动加 useTranslation —— 若文件里没有 `t`,报告让人工接。
 */
import { Project, SyntaxKind } from 'ts-morph'
import fs from 'fs'
import path from 'path'

const [file, ns] = process.argv.slice(2)
const WRITE = process.argv.includes('--write')
if (!file || !ns) { console.log('用法: node scripts/i18n-codemod.mjs <file> <ns> [--write]'); process.exit(1) }

const hasCJK = (s) => /[一-鿿]/.test(s)
const CONDITION_RE = /\bisZh\b|(^|[^.\w])zh([^\w]|$)|startsWith\(\s*['"]zh['"]/

// en 串 → camelCase key
function slugKey(en, used) {
  let base = en.replace(/\{\{[^}]+\}\}/g, ' ').replace(/[^a-zA-Z0-9\s]/g, ' ').trim().split(/\s+/).slice(0, 4)
    .map((w, i) => i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()).join('')
  if (!base) base = 'k'
  if (base.length > 40) base = base.slice(0, 40)
  let k = base, i = 2
  while (used.has(k)) k = base + (i++)
  used.add(k)
  return k
}

// 取分支的 {文本, 插值vars} —— 字符串/无插值模板/单/多标识符插值模板
function extract(node) {
  const k = node.getKind()
  if (k === SyntaxKind.StringLiteral || k === SyntaxKind.NoSubstitutionTemplateLiteral) {
    return { text: node.getLiteralValue(), vars: {} }
  }
  if (k === SyntaxKind.TemplateExpression) {
    let text = node.getHead().getLiteralText()
    const vars = {}
    for (const span of node.getTemplateSpans()) {
      const expr = span.getExpression()
      let name = expr.getText().replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')
      if (!name || /^\d/.test(name)) name = 'v' + (Object.keys(vars).length + 1)
      // 复杂表达式(带调用/三元)不接
      if (/[()?]/.test(expr.getText())) return null
      vars[name] = expr.getText()
      text += `{{${name}}}` + span.getLiteral().getLiteralText()
    }
    return { text, vars }
  }
  return null
}

const project = new Project({ tsConfigFilePath: 'tsconfig.json', skipAddingFilesFromTsConfig: true })
const sf = project.addSourceFileAtPath(file)
const enJson = {}, zhJson = {}, used = new Set()
// 用已有 JSON 的 key 播种 used,避免生成的 key 覆盖既有 key(不同值)。
const enJp = path.join('src/i18n/locales/en', `${ns}.json`)
if (fs.existsSync(enJp)) Object.keys(JSON.parse(fs.readFileSync(enJp, 'utf8'))).forEach((k) => used.add(k))
let converted = 0
const skipped = []

for (const cond of sf.getDescendantsOfKind(SyntaxKind.ConditionalExpression)) {
  const condText = cond.getCondition().getText()
  if (!CONDITION_RE.test(condText)) continue
  const wt = cond.getWhenTrue(), wf = cond.getWhenFalse()
  // 嵌套三元跳过
  if (wt.getKind() === SyntaxKind.ConditionalExpression || wf.getKind() === SyntaxKind.ConditionalExpression) {
    skipped.push(`nested @L${cond.getStartLineNumber()}: ${cond.getText().slice(0, 60)}`); continue
  }
  const a = extract(wt), b = extract(wf)
  if (!a || !b) { skipped.push(`non-string @L${cond.getStartLineNumber()}: ${cond.getText().slice(0, 60)}`); continue }
  // CJK 定中英
  const aCJK = hasCJK(a.text), bCJK = hasCJK(b.text)
  if (aCJK === bCJK) { skipped.push(`ambiguous(CJK) @L${cond.getStartLineNumber()}: ${cond.getText().slice(0, 60)}`); continue }
  const zhSide = aCJK ? a : b, enSide = aCJK ? b : a
  const key = slugKey(enSide.text, used)
  enJson[key] = enSide.text
  zhJson[key] = zhSide.text
  const vars = { ...zhSide.vars, ...enSide.vars }
  const varStr = Object.keys(vars).length ? `, { ${Object.entries(vars).map(([n, e]) => n === e ? n : `${n}: ${e}`).join(', ')} }` : ''
  cond.replaceWithText(`t('${ns}:${key}'${varStr})`)
  converted++
}

// 只认"真的把 t 解构出来了" —— 光有 useTranslation(只取 i18n)不算。
const hasT = /const\s*\{[^}]*\bt\b[^}]*\}\s*=\s*useTranslation/.test(sf.getFullText())

console.log(`\n[${path.basename(file)}] ns=${ns}`)
console.log(`  转换: ${converted}  跳过: ${skipped.length}  ${hasT ? '✓ 有 t()' : "⚠ 需人工接(2 行):\n      const { t: tRaw, i18n } = useTranslation('" + ns + "')\n      const t = tRaw as (k: string, o?: Record<string, unknown>) => string\n      (并删掉不再用的 const zh=...)"}`)
skipped.slice(0, 12).forEach((s) => console.log(`    - 跳过 ${s}`))

if (WRITE && converted > 0) {
  sf.saveSync()
  for (const [lng, obj] of [['en', enJson], ['zh-CN', zhJson]]) {
    const jp = path.join('src/i18n/locales', lng, `${ns}.json`)
    const cur = fs.existsSync(jp) ? JSON.parse(fs.readFileSync(jp, 'utf8')) : {}
    fs.writeFileSync(jp, JSON.stringify({ ...cur, ...obj }, null, 2) + '\n')
  }
  console.log(`  ✅ 已写文件 + locales/{en,zh-CN}/${ns}.json (跑 i18n-translate.ts ${ns} 补 ar/ru/fr)`)
} else if (!WRITE) {
  console.log('  (干跑,未改。加 --write 落地)')
}
