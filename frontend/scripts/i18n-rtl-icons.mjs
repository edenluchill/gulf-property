/**
 * RTL 方向性图标 codemod —— 给导航类箭头补 `rtl:-scale-x-100`,阿语下自动镜像。
 *
 * 【为什么是 -scale-x-100 而不是 rotate-180】
 * 纯水平箭头(ChevronLeft/Right、ArrowLeft/Right)两种写法等效;但**斜箭头**不等效:
 *   ArrowUpRight + rotate-180  → 左**下**箭头 ✗(上下也被转了)
 *   ArrowUpRight + -scale-x-100 → 左**上**箭头 ✓(只镜像水平轴)
 * 统一用 -scale-x-100,一个规则覆盖所有方向。
 *
 * 【什么该翻,什么不该翻】
 * 判据是这个图标表达的是**方向**还是**物体**:
 *   ✓ 翻:导航/推进(下一步/返回/轮播/列表项 chevron/外链 ArrowUpRight/CTA)
 *   ✗ 不翻:图标代表**工具或物体**本身。本仓库唯一一例是
 *     CollabDrawToolbar 的 `<ToolBtn t="arrow" icon={<ArrowUpRight/>} label="箭头"/>`
 *     —— 那是"画箭头工具"的图示,不是指向,镜像它没有意义。见 EXCLUDE。
 *
 * 【豁免】同 i18n-rtl-position.mjs:元素上方 6 行内写 `rtl-keep` 即整个跳过。
 *
 * 幂等(已有 rtl:-scale-x-100 的不重复加)。
 * 用法: node scripts/i18n-rtl-icons.mjs <file...> [--write]
 */
import { Project, SyntaxKind } from 'ts-morph'
import path from 'path'

const args = process.argv.slice(2)
const WRITE = args.includes('--write')
const files = args.filter((a) => !a.startsWith('--'))
if (!files.length) { console.log('用法: node scripts/i18n-rtl-icons.mjs <file...> [--write]'); process.exit(1) }

const ICONS = new Set(['ChevronRight', 'ChevronLeft', 'ArrowRight', 'ArrowLeft', 'ArrowUpRight'])
const MIRROR = 'rtl:-scale-x-100'
// 图标代表工具/物体而非方向 → 不镜像。key = 文件名尾缀。
const EXCLUDE = ['CollabDrawToolbar.tsx']

function hasKeepMarker(el, sf) {
  const lines = sf.getFullText().split('\n')
  const line = el.getStartLineNumber()
  return lines.slice(Math.max(0, line - 7), line).some((l) => l.includes('rtl-keep'))
}

const project = new Project({ tsConfigFilePath: 'tsconfig.json', skipAddingFilesFromTsConfig: true })
let totalFiles = 0, totalIcons = 0, skipped = 0

for (const f of files) {
  if (EXCLUDE.some((e) => f.endsWith(e))) { console.log(`  ⊘ 跳过(工具图标,非方向) ${path.relative('.', f)}`); continue }
  let sf
  try { sf = project.addSourceFileAtPath(f) } catch { continue }
  let n = 0
  for (const el of sf.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)) {
    const tag = el.getTagNameNode().getText()
    if (!ICONS.has(tag)) continue
    if (hasKeepMarker(el, sf)) { skipped++; continue }
    const attr = el.getAttribute('className')
    if (!attr) {
      console.log(`  ⚠ ${path.relative('.', f)}:${el.getStartLineNumber()} <${tag}> 无 className,需手工加`)
      continue
    }
    const init = attr.getInitializer()
    if (!init) continue
    // 只处理 className="..." 字面量形式(本仓库全部如此;模板/表达式形式留给人工)
    if (init.getKind() !== SyntaxKind.StringLiteral) {
      console.log(`  ⚠ ${path.relative('.', f)}:${el.getStartLineNumber()} <${tag}> className 非字面量,需手工`)
      continue
    }
    const cur = init.getLiteralText()
    if (cur.split(/\s+/).includes(MIRROR)) continue   // 幂等
    init.setLiteralValue(`${cur} ${MIRROR}`.trim())
    n++
  }
  if (n > 0) {
    totalFiles++; totalIcons += n
    console.log(`  ${WRITE ? '✅' : '·'} ${n.toString().padStart(2)}  ${path.relative('.', f)}`)
    if (WRITE) sf.saveSync()
  }
}

console.log(`\n${WRITE ? '已镜像' : '将镜像'} ${totalIcons} 个图标 / ${totalFiles} 文件${skipped ? `;${skipped} 处 rtl-keep 豁免` : ''}`)
if (!WRITE) console.log('(加 --write 落地)')
