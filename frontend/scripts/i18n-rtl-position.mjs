/**
 * RTL 定位 codemod —— left-/right- 绝对定位 → 逻辑属性 start-/end-。
 * 需要 Tailwind ≥3.3;本仓库 3.4.19 ✅
 *
 * ⚠️ 这一批**不是**机械转换。三类必须区分,否则会把本来正确的东西转坏:
 *
 *  1. 【居中,绝不转】`left-1/2` + `-translate-x-1/2` —— 这是水平居中的惯用法,
 *     不是"靠左"。RTL 下它本来就居中,转成 start-1/2 反而在 RTL 把元素推到右半边
 *     (start=right 时 start-1/2 + -translate-x-1/2 会算错)。原样保留。
 *  2. 【拉满,不必转】`left-0 right-0` 成对出现 = 横向撑满,方向无关。
 *     转了等价但制造 diff 噪音。原样保留(真要清理该用 inset-x-*)。
 *  3. 【该镜像,转】其余单边定位:下拉 right-0、关闭按钮 top-4 right-4、
 *     角标 -top-1 -right-1、轮播箭头 left-4/right-4、边缘遮罩 …
 *     → start-/end-,RTL 自动镜像。
 *
 * ⚠️ 转完仍需人眼:少数是**刻意锁物理边**(如跟随鼠标/GL canvas 坐标的浮层)。
 * 用 --report 先看分类结果,别闭眼 --write。
 *
 * 【豁免】同行或上一行写 `rtl-keep` 的字符串整个跳过。用于命令式定位:
 * 元素靠 JS 写 transform: translate(x,y),而 x 恒从容器**左**缘算(e.point/canvas 坐标),
 * 这时 left-0 必须保持物理左 —— 转成 start-0 在 RTL 会变 right:0,元素直接飞出屏幕。
 *
 * 另:`origin-top-right`(下拉展开原点)、`bg-gradient-to-l`(方向性渐变)
 * Tailwind 无逻辑属性,本脚本**不管**,需 rtl: 变体手动处理。
 *
 * 只改字符串字面量/模板内的 token(ts-morph),不碰注释。幂等。
 *
 * 用法: node scripts/i18n-rtl-position.mjs <file...> [--report] [--write]
 */
import { Project, SyntaxKind } from 'ts-morph'
import path from 'path'

const args = process.argv.slice(2)
const WRITE = args.includes('--write')
const REPORT = args.includes('--report')
const files = args.filter((a) => !a.startsWith('--'))
if (!files.length) { console.log('用法: node scripts/i18n-rtl-position.mjs <file...> [--report] [--write]'); process.exit(1) }

// 匹配 left-/right- 定位 token,保留变体前缀与负号。
// 值可为 0 / 4 / 1/2 / [6px] / full 等。
const POS_RE = /(^|[\s"'`{(])((?:[a-z0-9-]+:)*)(-?)(left|right)-((?:\[[^\]]*\])|(?:[a-z0-9.]+(?:\/[a-z0-9]+)?))/g

const stats = { centering: 0, fullBleed: 0, converted: 0, kept: 0 }
const skipped = []

/**
 * `rtl-keep` 豁免。不能只看"同行/上一行"—— className 往往离它所属的 JSX 注释好几行
 * (<div ref=... className=... 各占一行)。改为:定位到该字符串所属的 JSX 元素,
 * 从元素开标签**往上 6 行**到字符串本行这个窗口里找标记,这样紧贴元素上方的
 * {/* rtl-keep ... *\/} 注释能稳定命中,又不会误伤远处的兄弟元素。
 */
const JSX_KINDS = [SyntaxKind.JsxSelfClosingElement, SyntaxKind.JsxOpeningElement]
function hasKeepMarker(node, sf) {
  const lines = sf.getFullText().split('\n')
  const nodeLine = node.getStartLineNumber()
  let from = nodeLine
  for (let a = node.getParent(); a; a = a.getParent()) {
    if (JSX_KINDS.includes(a.getKind())) { from = a.getStartLineNumber(); break }
  }
  const start = Math.max(1, from - 6)
  return lines.slice(start - 1, nodeLine).some((l) => l.includes('rtl-keep'))
}

function classify(str, whole, variants, neg, side, val) {
  // 1. 居中惯用法:left-1/2 / right-1/2 且同串有 translate-x
  if (/^1\/2$/.test(val) && /-?translate-x-/.test(str)) return 'centering'
  // 2. 横向撑满:同串里 left-X 与 right-X 都在(同变体前缀)
  const other = side === 'left' ? 'right' : 'left'
  const pairRe = new RegExp(`(^|[\\s"'\`{(])${variants}${neg}${other}-${val.replace(/[.[\]/\\]/g, '\\$&')}(\\s|$|["'\`)}])`)
  if (pairRe.test(str)) return 'fullBleed'
  return 'convert'
}

function transform(text) {
  let n = 0
  const out = text.replace(POS_RE, (m, pre, variants, neg, side, val) => {
    const kind = classify(text, m, variants, neg, side, val)
    if (kind === 'centering') { stats.centering++; skipped.push(`居中  ${m.trim()}`); return m }
    if (kind === 'fullBleed') { stats.fullBleed++; skipped.push(`撑满  ${m.trim()}`); return m }
    stats.converted++; n++
    return `${pre}${variants}${neg}${side === 'left' ? 'start' : 'end'}-${val}`
  })
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
      if (!/-?(left|right)-/.test(cur)) continue
      if (hasKeepMarker(node, sf)) {
        stats.kept++
        skipped.push(`豁免  ${path.relative('.', f)}:${node.getStartLineNumber()} (rtl-keep)`)
        continue
      }
      if (kind === SyntaxKind.StringLiteral || kind === SyntaxKind.NoSubstitutionTemplateLiteral) {
        const { out, n } = transform(cur)
        if (n === 0 || out === cur) continue
        node.setLiteralValue(out)
        fileTokens += n
      } else {
        const raw = node.getText()
        const { out, n } = transform(raw)
        if (n === 0 || out === raw) continue
        node.replaceWithText(out)
        fileTokens += n
      }
    }
  }
  if (fileTokens > 0) {
    totalFiles++; totalTokens += fileTokens
    console.log(`  ${WRITE ? '✅' : '·'} ${fileTokens.toString().padStart(3)}  ${path.relative('.', f)}`)
    if (WRITE) sf.saveSync()
  }
}

console.log(`\n${WRITE ? '已转' : '将转'} ${stats.converted} token / ${totalFiles} 文件`)
console.log(`保留 ${stats.centering} 处居中(left-1/2+translate-x)、${stats.fullBleed} 处撑满(left-0 right-0 成对)、${stats.kept} 处 rtl-keep 豁免`)
if (REPORT && skipped.length) {
  console.log('\n--- 保留明细 ---')
  for (const s of [...new Set(skipped)]) console.log('  ' + s)
}
if (!WRITE) console.log('\n(加 --write 落地;先 --report 看分类)')
