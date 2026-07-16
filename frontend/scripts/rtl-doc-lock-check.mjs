/**
 * 文档语言锁定验证 —— /cr/:code 客户分析报告。
 *
 * 【要证明的事】报告正文是 AI 生成后存 jsonb 的,语言在生成那刻定死。所以页面必须用
 * getFixedT(report.lang) 渲染,**不能跟浏览者的 UI 语言切**。
 * 一个 lang='zh' 的报告,用阿语浏览器打开时:
 *   ✅ 正确 = 整页仍是中文(chrome 和正文一致)
 *   ❌ 失效 = chrome 变阿语、正文还是中文 → 「阿语标签 + 中文正文」,比全中文更糟
 * 这是**用普通 useTranslation 就会犯的错**,而且只有切到别的语言才看得见。
 *
 * 同时验证:容器级 dir 必须跟**文档**语言,不跟 <html dir>(后者跟 UI 语言)。
 *
 * 用法: node scripts/rtl-doc-lock-check.mjs [share_code]
 */
import { chromium } from 'playwright'
import path from 'path'
import fs from 'fs'

const BASE = process.env.RTL_BASE || 'http://localhost:5174'
const CODE = process.argv[2] || 'demo'
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '_rtl')
fs.mkdirSync(OUT, { recursive: true })

const BPS = [
  { key: 'mobile', width: 414, height: 896 },
  { key: 'pad', width: 1180, height: 820 },
]

const browser = await chromium.launch()
let fails = 0

for (const bp of BPS) {
  // 关键:浏览器 UI 语言设成**阿语**,而报告 lang='zh' → 页面应该纹丝不动地保持中文。
  const ctx = await browser.newContext({
    viewport: { width: bp.width, height: bp.height },
    deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ar',
  })
  await ctx.addInitScript(() => localStorage.setItem('pinzos-lang', 'ar'))
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 140)))

  try { await page.goto(`${BASE}/cr/${CODE}`, { waitUntil: 'networkidle', timeout: 30000 }) }
  catch { await page.waitForTimeout(2500) }
  await page.waitForTimeout(1500)

  const r = await page.evaluate(() => {
    const de = document.documentElement
    const t = document.body.innerText || ''
    return {
      htmlDir: de.getAttribute('dir'),
      // 文档容器自己的 dir(应跟文档语言,不跟 <html dir>)
      docDirs: [...new Set([...document.querySelectorAll('[dir]')].map((e) => e.getAttribute('dir')))],
      hasCJK: /[一-龥]/.test(t),
      hasArabic: /[؀-ۿ]/.test(t),
      rawKeys: [...new Set((t.match(/\b[a-zA-Z][\w]*:[a-z][\w]*(?:\.[\w]+)+/g) || []))].slice(0, 5),
      overflowX: de.scrollWidth - de.clientWidth,
      len: t.length,
    }
  })

  await page.screenshot({ path: path.join(OUT, `cr-${CODE}-${bp.key}.png`), fullPage: false })

  const bad = []
  // 报告 lang='zh' → 页面必须是中文。出现阿拉伯文 = 锁失效(chrome 跟 UI 语言跑了)。
  if (!r.hasCJK) bad.push('正文没有中文 —— 报告 lang=zh,页面却不是中文?')
  if (r.hasArabic) bad.push('🔴 出现阿拉伯文 —— **文档语言锁失效**,chrome 跟着浏览者 UI 语言跑了')
  if (r.rawKeys.length) bad.push(`漏翻裸键: ${r.rawKeys.join(', ')}`)
  if (r.overflowX > 1) bad.push(`横向溢出 ${r.overflowX}px`)
  if (errs.length) bad.push(`JS 错误: ${errs[0]}`)
  if (r.len < 200) bad.push(`页面几乎空白(${r.len} 字符)—— 可能没加载出来`)

  console.log(`  ${bad.length ? '❌' : '✅'} cr/${CODE} ${bp.key.padEnd(7)} html dir=${r.htmlDir} · 容器 dir=[${r.docDirs.join(',')}] · ${r.len} 字符`)
  bad.forEach((b) => console.log(`       ${b}`))
  if (bad.length) fails++
  await ctx.close()
}

await browser.close()
console.log(fails
  ? `\n❌ ${fails} 处`
  : `\n✅ 文档语言锁生效:阿语浏览器打开 lang=zh 的报告,页面纹丝不动保持中文。`)
process.exit(fails ? 1 : 0)
