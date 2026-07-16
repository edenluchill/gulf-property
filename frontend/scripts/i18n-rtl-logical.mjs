/**
 * RTL codemod —— 把物理方向 Tailwind 类换成逻辑属性,让阿拉伯语(dir=rtl)自动镜像。
 * 需要 Tailwind ≥3.3(逻辑属性 + rtl:/ltr: 变体);本仓库 3.4.19 ✅
 *
 * 【默认:安全子集】只转**在 LTR 下渲染完全相同**的类(零回归,en/zh/ru/fr 一像素不变):
 *   ml-* → ms-*   mr-* → me-*   pl-* → ps-*   pr-* → pe-*
 *   text-left → text-start   text-right → text-end
 * 保留变体前缀(hover:/sm:/md:…)与负号(-ml-2 → -ms-2)、任意值(ml-[3px])。
 *
 * 【--phase2】追加同样零回归的第二批(边角/边框/间距):
 *   rounded-l→rounded-s  rounded-r→rounded-e   (含尺寸后缀 rounded-l-2xl→rounded-s-2xl)
 *   border-l→border-s    border-r→border-e     (含 border-l-2 / border-l-slate-200)
 *   space-x-N → space-x-N rtl:space-x-reverse  (LTR 下 rtl: 不生效 = 零回归)
 *
 * ⚠️ 仍不碰(需人工/视觉判断,留给 RTL 专项):
 *   left-/right- 绝对定位(部分是刻意锁边)、方向性图标(ChevronRight…)。
 *
 * 只改**字符串字面量/模板**内的 token(ts-morph),不碰注释、不碰非字符串代码。
 * 幂等:已转过的再跑一遍不会变。
 *
 * 用法: node scripts/i18n-rtl-logical.mjs <file-or-glob...> [--phase2] [--write]
 *   不带 --write = 干跑报告。
 */
import { Project, SyntaxKind } from 'ts-morph'
import path from 'path'

const args = process.argv.slice(2)
const WRITE = args.includes('--write')
const PHASE2 = args.includes('--phase2')
const files = args.filter((a) => !a.startsWith('--'))
if (!files.length) { console.log('用法: node scripts/i18n-rtl-logical.mjs <file...> [--phase2] [--write]'); process.exit(1) }

const MAP = { ml: 'ms', mr: 'me', pl: 'ps', pr: 'pe' }
// 边界(前):字符串开头/空白/引号/冒号(变体)/花括号。负号 - 单独在组里保留。
const MARGIN_RE = /(^|[\s"'`{(:])(-?)(ml|mr|pl|pr)-/g
const TEXT_RE = /(^|[\s"'`{(:])text-(left|right)\b/g
// --- phase2 ---
// rounded-l / rounded-l-2xl / rounded-r-full → s/e。后缀原样带上。
const ROUNDED_RE = /(^|[\s"'`{(:])rounded-(l|r)\b/g
// border-l / border-l-2 / border-l-slate-200 → s/e。
// 排除 border-r 后跟 ounded 之类不可能;\b 已够。
const BORDER_RE = /(^|[\s"'`{(:])border-(l|r)\b/g
// space-x-N(含变体前缀 sm:space-x-2)后补 rtl:space-x-reverse,同前缀。
// 已经有 rtl:space-x-reverse 的跳过(幂等)。
const SPACEX_RE = /(^|[\s"'`{(:])((?:[a-z0-9-]+:)*)space-x-([a-z0-9.]+)\b/g

function transform(text) {
  let n = 0
  let out = text.replace(MARGIN_RE, (_m, pre, neg, k) => { n++; return `${pre}${neg}${MAP[k]}-` })
  out = out.replace(TEXT_RE, (_m, pre, dir) => { n++; return `${pre}text-${dir === 'left' ? 'start' : 'end'}` })
  if (PHASE2) {
    out = out.replace(ROUNDED_RE, (_m, pre, d) => { n++; return `${pre}rounded-${d === 'l' ? 's' : 'e'}` })
    out = out.replace(BORDER_RE, (_m, pre, d) => { n++; return `${pre}border-${d === 'l' ? 's' : 'e'}` })
    out = out.replace(SPACEX_RE, (m, pre, variants, size) => {
      // 幂等:同串里已有**同变体前缀**的 reverse 就不再加。
      // 前置 (^|\s) 边界很关键:否则 variants='' 时会被 `sm:rtl:space-x-reverse` 误判为已存在。
      if (new RegExp(`(^|\\s)${variants}rtl:space-x-reverse\\b`).test(out)) return m
      n++
      return `${pre}${variants}space-x-${size} ${variants}rtl:space-x-reverse`
    })
  }
  return { out, n }
}

const project = new Project({ tsConfigFilePath: 'tsconfig.json', skipAddingFilesFromTsConfig: true })
let totalFiles = 0, totalTokens = 0

for (const f of files) {
  let sf
  try { sf = project.addSourceFileAtPath(f) } catch { console.log(`  ⚠ 跳过(读不到) ${f}`); continue }
  let fileTokens = 0
  const kinds = [SyntaxKind.StringLiteral, SyntaxKind.NoSubstitutionTemplateLiteral, SyntaxKind.TemplateHead, SyntaxKind.TemplateMiddle, SyntaxKind.TemplateTail]
  for (const kind of kinds) {
    for (const node of sf.getDescendantsOfKind(kind)) {
      const cur = node.getLiteralText ? node.getLiteralText() : node.getText()
      // 只处理看起来含目标 token 的,省得白改
      const PREFILTER = PHASE2
        ? /\b-?(ml|mr|pl|pr)-|\btext-(left|right)\b|\b(rounded|border)-[lr]\b|\bspace-x-/
        : /\b-?(ml|mr|pl|pr)-|\btext-(left|right)\b/
      if (!PREFILTER.test(cur)) continue
      const { out, n } = transform(cur)
      if (n === 0 || out === cur) continue
      // StringLiteral: 用 setLiteralValue;模板片段:替换 text(保留引号/反引号由节点管理)
      if (kind === SyntaxKind.StringLiteral || kind === SyntaxKind.NoSubstitutionTemplateLiteral) {
        node.setLiteralValue(out)
      } else {
        // 模板 head/middle/tail:直接替换节点原文里的 token(原文含 ` 或 ${ 边界,安全)
        const raw = node.getText()
        const { out: rawOut } = transform(raw)
        node.replaceWithText(rawOut)
      }
      fileTokens += n
    }
  }
  if (fileTokens > 0) {
    totalFiles++; totalTokens += fileTokens
    console.log(`  ${WRITE ? '✅' : '·'} ${fileTokens.toString().padStart(3)}  ${path.relative('.', f)}`)
    if (WRITE) sf.saveSync()
  }
}

console.log(`\n${WRITE ? '已改' : '将改'} ${totalTokens} token / ${totalFiles} 文件。${WRITE ? '' : '(加 --write 落地)'}`)
