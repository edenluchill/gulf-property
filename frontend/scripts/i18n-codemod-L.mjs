/**
 * i18n 辅助函数 codemod —— 把 `L('中', 'English')` 双语辅助调用抽成 t('<ns>:key')。
 *
 * luna-tour 大量用 `const L = (a, b) => (zh ? a : b)` 再 `L('中','En')` 遍地。
 * 三元 codemod 只认 ConditionalExpression,不认这种 CallExpression → 本脚本补上。
 *
 * 用法: node scripts/i18n-codemod-L.mjs <file.tsx> <namespace> [--name L] [--write]
 *   --name  辅助函数名(默认 L)。不带 --write = 干跑。
 *
 * 安全同三元 codemod:靠 CJK 判中英、只碰字符串/单标识符插值模板、复杂参数跳过并报告。
 * 第一个参数是中文分支还是英文分支不靠位置,靠 CJK(更稳,和三元 codemod 一致)。
 */
import { Project, SyntaxKind } from 'ts-morph'
import fs from 'fs'
import path from 'path'

const args = process.argv.slice(2)
const [file, ns] = args.filter((a) => !a.startsWith('--') && a !== argValue('--name'))
const WRITE = args.includes('--write')
const NAME = argValue('--name') || 'L'
function argValue(flag) { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null }
if (!file || !ns) { console.log('用法: node scripts/i18n-codemod-L.mjs <file> <ns> [--name L] [--write]'); process.exit(1) }

const hasCJK = (s) => /[一-鿿]/.test(s)

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
const enJp = path.join('src/i18n/locales/en', `${ns}.json`)
if (fs.existsSync(enJp)) Object.keys(JSON.parse(fs.readFileSync(enJp, 'utf8'))).forEach((k) => used.add(k))
let converted = 0
const skipped = []

for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
  const callee = call.getExpression()
  if (callee.getKind() !== SyntaxKind.Identifier || callee.getText() !== NAME) continue
  const callArgs = call.getArguments()
  if (callArgs.length !== 2) { skipped.push(`argc @L${call.getStartLineNumber()}: ${call.getText().slice(0, 60)}`); continue }
  const a = extract(callArgs[0]), b = extract(callArgs[1])
  if (!a || !b) { skipped.push(`non-string @L${call.getStartLineNumber()}: ${call.getText().slice(0, 60)}`); continue }
  const aCJK = hasCJK(a.text), bCJK = hasCJK(b.text)
  if (aCJK === bCJK) { skipped.push(`ambiguous(CJK) @L${call.getStartLineNumber()}: ${call.getText().slice(0, 60)}`); continue }
  const zhSide = aCJK ? a : b, enSide = aCJK ? b : a
  const key = slugKey(enSide.text, used)
  enJson[key] = enSide.text
  zhJson[key] = zhSide.text
  const vars = { ...zhSide.vars, ...enSide.vars }
  const varStr = Object.keys(vars).length ? `, { ${Object.entries(vars).map(([n, e]) => n === e ? n : `${n}: ${e}`).join(', ')} }` : ''
  call.replaceWithText(`t('${ns}:${key}'${varStr})`)
  converted++
}

const hasT = /const\s*\{[^}]*\bt\b[^}]*\}\s*=\s*useTranslation/.test(sf.getFullText())

console.log(`\n[${path.basename(file)}] ns=${ns} helper=${NAME}`)
console.log(`  转换: ${converted}  跳过: ${skipped.length}  ${hasT ? '✓ 有 t()' : '⚠ 需人工接 t + 删 const ' + NAME + '/zh'}`)
skipped.slice(0, 12).forEach((s) => console.log(`    - 跳过 ${s}`))

if (WRITE && converted > 0) {
  sf.saveSync()
  for (const [lng, obj] of [['en', enJson], ['zh-CN', zhJson]]) {
    const jp = path.join('src/i18n/locales', lng, `${ns}.json`)
    const cur = fs.existsSync(jp) ? JSON.parse(fs.readFileSync(jp, 'utf8')) : {}
    fs.writeFileSync(jp, JSON.stringify({ ...cur, ...obj }, null, 2) + '\n')
  }
  console.log(`  ✅ 已写文件 + locales/{en,zh-CN}/${ns}.json`)
} else if (!WRITE) {
  console.log('  (干跑,未改。加 --write 落地)')
}
