/**
 * i18n 缺口扫描 —— 剩多少中文没迁,按「真漏网 / 有意保留」分桶。
 *
 * ⚠️ **别用 grep 数中文行数**:①注释里的中文会把数字虚高一个量级(实测 4599 → 真活 ~300);
 * ②非 UTF-8 locale 下 grep 按**字节范围**匹配,会把 `·` `→` `—` `㎡` `📍` 全算成中文。
 * 这个脚本剥注释 + 用 JS 的 UTF-8 正则,并按「文件有没有接 useTranslation」分桶 ——
 * 已接的多半是故意留的(枚举/数据表/单位),没接的才是真漏。
 *
 * 用法: cd <repo> && node frontend/scripts/i18n-gap-scan.mjs
 * (从仓库根跑,它自己走 frontend/src。)
 */
import fs from 'fs'
import path from 'path'
const CJK = /[一-龥]/
const walk = (d, out = []) => {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name)
    if (f.isDirectory()) walk(p, out)
    else if (/\.(tsx|ts)$/.test(f.name)) out.push(p)
  }
  return out
}
// 内部工具 = spec 决策#2 有意后置
const INTERNAL = /analytics|Admin|developer-upload|property-editor|RoutesEditor|UnifiedDubaiEditor|LangGraphTest/
const rows = []
for (const f of walk('frontend/src')) {
  const src = fs.readFileSync(f, 'utf8')
  if (INTERNAL.test(f)) continue
  let inB = false
  const hits = []
  src.split('\n').forEach((l, i) => {
    const t = l.trim()
    if (inB) { if (t.includes('*/')) inB = false; return }
    if (t.startsWith('/*') || t.startsWith('{/*')) { if (!t.includes('*/')) inB = true; return }
    if (t.startsWith('//') || t.startsWith('*')) return
    if (CJK.test(l.replace(/\/\/.*$/, ''))) hits.push([i + 1, t.slice(0, 60)])
  })
  if (!hits.length) continue
  const wired = /useTranslation|getFixedT/.test(src)
  rows.push({ f: f.split(path.sep).join('/'), n: hits.length, wired, sample: hits.slice(0, 2) })
}
const raw = rows.filter((r) => !r.wired).sort((a, b) => b.n - a.n)
const wired = rows.filter((r) => r.wired).sort((a, b) => b.n - a.n)
console.log('🔴 零 i18n + 有中文 —— 真漏网')
raw.forEach((r) => { console.log(String(r.n).padStart(4), r.f); r.sample.forEach((s) => console.log('        ', s[0] + ':', s[1])) })
console.log('   小计', raw.reduce((a, b) => a + b.n, 0), '行 /', raw.length, '文件\n')
console.log('🟡 已接 i18n 但仍有中文 —— 多半是故意保留(数据驱动/枚举/单位),需抽查')
wired.slice(0, 10).forEach((r) => console.log(String(r.n).padStart(4), r.f, '|', r.sample[0] ? r.sample[0][1].slice(0, 42) : ''))
console.log('   小计', wired.reduce((a, b) => a + b.n, 0), '行 /', wired.length, '文件')
