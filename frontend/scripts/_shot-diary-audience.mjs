/**
 * 受众分流跑分 —— 「买家绝不该看到经纪侧的更新」。
 *
 * 这条规则的失败方式很安静:分流写错了,页面照样渲染、不报错,只是买家多看/少看了
 * 一批条目 —— 除非有人一条条数,否则永远不会有人发现。所以这里**数数**:
 *
 *   ① 匿名访客(=买家视角)看到的条目数 === changelog.ts 里非 agent 的条数
 *   ② 匿名访客页面上一个「经纪专属」标记都没有
 *   ③ hero 上那个统计数字 === 屏幕上真实的条目数(数字和内容不能对不上)
 *   ④ 建议板拉回来的 requests 里没有 audience==='agent' 的
 *
 * 用真实数据当基准(从 changelog.ts 里数),不写死数字 —— 写死的话每加一条更新
 * 就得回来改一次,改烦了就会被注释掉。
 *
 *   node scripts/_shot-diary-audience.mjs [--base https://www.pinzos.com]
 */
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'

const BASE = (process.argv.find((a) => a.startsWith('--base=')) || '').split('=')[1]
  || 'https://www.pinzos.com'
const API = (process.argv.find((a) => a.startsWith('--api=')) || '').split('=')[1]
  || 'https://api.pinzos.com'

// 从数据文件直接数,不 import(那是 TS) —— 数 `audience: 'agent'` 出现几次
const src = readFileSync(new URL('../src/data/changelog.ts', import.meta.url), 'utf8')
const total = (src.match(/^\s{4}kind: /gm) || []).length
const agentOnly = (src.match(/^\s{4}audience: 'agent',/gm) || []).length
const buyerVisible = total - agentOnly

const results = []
const check = (name, ok, detail) => { results.push({ name, ok, detail }); }

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })

try {
  await page.goto(`${BASE}/changelog`, { waitUntil: 'networkidle', timeout: 60000 })
  await page.waitForSelector('[data-sec]', { timeout: 20000 })

  // ① 条目数 —— 每条是时间线里的一个 li
  const shown = await page.locator('[data-sec] > ul > li').count()
  check('匿名看到的条目数 = 非经纪条目数', shown === buyerVisible,
    `页面 ${shown} 条 / 数据里非经纪 ${buyerVisible} 条(总 ${total},经纪专属 ${agentOnly})`)

  // ② 一个「经纪专属」标记都不该有
  const chips = await page.getByText(/经纪专属|Agents only|Agents seulement|Только агентам|للوسطاء فقط/).count()
  check('匿名页面无「经纪专属」标记', chips === 0, `找到 ${chips} 个`)

  // ③ hero 统计数字要和屏幕上的条数一致(CountUp 动画结束后再读)
  await page.waitForTimeout(2000)
  const heroStat = await page.locator('section .tabular-nums').first().innerText()
  check('hero 统计数 = 屏幕条目数', Number(heroStat.replace(/\D/g, '')) === shown,
    `hero 写 ${heroStat.trim()} / 实际 ${shown} 条`)

  // ④ 建议板:匿名拉到的列表里不该有经纪侧的
  // ⚠️ 必须打 API 域名。www.pinzos.com 上的 /api/* 会落到 SPA fallback ——
  //    返回 200 + index.html,JSON.parse 直接炸(不是 404,查起来很懵)。
  const reqs = await page.evaluate(async (api) => {
    const r = await fetch(api).catch(() => null)
    if (!r || !r.ok) return null
    const txt = await r.text()
    try { return JSON.parse(txt).requests || [] } catch { return null }
  }, `${API}/api/feature-requests`)
  if (reqs === null) {
    check('建议列表按受众过滤', false, `接口没拉到:${API}/api/feature-requests`)
  } else {
    const leaked = reqs.filter((x) => x.audience === 'agent')
    check('建议列表按受众过滤', leaked.length === 0,
      `${reqs.length} 条里有 ${leaked.length} 条经纪侧`)
  }
} finally {
  await browser.close()
}

let bad = 0
for (const r of results) {
  if (!r.ok) bad++
  console.log(`${r.ok ? '✅' : '❌'} ${r.name} —— ${r.detail}`)
}
console.log(bad ? `\n${bad}/${results.length} 项没过` : `\n${results.length}/${results.length} 全过`)
process.exit(bad ? 1 : 0)
