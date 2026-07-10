/** Admin dashboard 重构验证:概览/客户/功能记录/订阅 四 tab 布局(mock owner + 端点)。 */
import { chromium } from 'playwright'

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: '1', email: 'lzp6529@gmail.com', exp: 9999999999, aud: 'authenticated' })}.f`
const session = {
  access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: 9999999999, refresh_token: 'f',
  user: { id: '1', aud: 'authenticated', role: 'authenticated', email: 'lzp6529@gmail.com', app_metadata: { provider: 'google' }, user_metadata: { full_name: 'Eden Lu' }, created_at: '2026-02-01T00:00:00Z' },
}

const J = (data) => ({ contentType: 'application/json', body: JSON.stringify({ success: true, data }) })
const routes = {
  '/overview': { overview: { events: 5321, visitors: 842, searches: 610, property_views: 2103, luna_opens: 190, luna_sessions: 34, leads_total: 3, leads_new: 1, favorites: 88, contacts: 12 }, daily: [{ day: '2026-07-01', visitors: 30, events: 120 }, { day: '2026-07-05', visitors: 55, events: 210 }, { day: '2026-07-09', visitors: 70, events: 300 }] },
  '/searches': { terms: [{ label: 'dubai marina', count: 40 }, { label: 'creek harbour', count: 22 }], projects: [{ id: 'p1', label: 'Binghatti Skyrise', count: 60 }, { id: 'p2', label: 'The Willows', count: 33 }], recent: [{ created_at: '2026-07-09T10:20:00', query: 'dubai marina 2br', kind: 'area' }] },
  '/luna': { sessions: 34, avg_duration_ms: 84000, avg_turns: 6, total_tool_calls: 120, error_sessions: 2 },
  '/tutorial': [{ step: 'open_map', visitors: 100 }, { step: 'first_search', visitors: 60 }],
  '/leads': [{ id: 1, created_at: '2026-07-09T09:00:00', visitor_id: 'v1', name: null, email: 'chen@x.com', phone: null, whatsapp: null, source: 'behavior', intent: {}, lead_score: 72, status: 'new', last_seen_at: '2026-07-09T09:00:00' }],
  '/timeseries': { event: 'search', granularity: 'day', points: [{ bucket: '2026-07-01', count: 20 }, { bucket: '2026-07-09', count: 45 }] },
  '/perf/alerts/active': { alerts: [] },
  '/subscribers': {
    subscribers: [
      { agent_id: 'a1', email: 'lzp6529@gmail.com', display_name: 'Eden Lu', role: 'agent', agent_since: '2026-02-01', plan_id: 'rookie', plan_name: 'Starter', status: 'trialing', paid: true, approval_status: 'approved', current_period_end: '2026-07-16', cancel_at_period_end: false, credits_month: 200, credits_used: 40, is_internal: true },
      { agent_id: 'a2', email: 'shelldubai26@gmail.com', display_name: 'Shell', role: 'agent', agent_since: '2026-06-01', plan_id: 'agent', plan_name: 'Agent', status: 'active', paid: false, approval_status: 'approved', current_period_end: '2126-06-27', cancel_at_period_end: false, credits_month: 1200, credits_used: 1120, is_internal: false },
      { agent_id: 'a3', email: 'david@chen.com', display_name: 'David Chen', role: 'agent', agent_since: '2026-07-02', plan_id: 'agent', plan_name: 'Agent', status: 'active', paid: true, approval_status: 'approved', current_period_end: '2026-08-02', cancel_at_period_end: false, credits_month: 1200, credits_used: 300, is_internal: false },
      { agent_id: 'a4', email: 'admin@yesir.ai', display_name: 'Yesir', role: 'agent', agent_since: '2026-07-05', plan_id: null, plan_name: null, status: 'none', paid: false, approval_status: 'pending', current_period_end: null, cancel_at_period_end: false, credits_month: 0, credits_used: 0, is_internal: false },
    ],
    summary: { total_accounts: 8, subscribed: 3, paid: 2, trialing: 1, comp: 1, pending_approval: 1 },
  },
  '/feature-log/tours': [{ id: 't1', title: 'Binghatti 私享导览', share_code: 'ab12', status: 'published', language: 'zh', total_ms: 92000, edited_by_agent: true, agent_email: 'david@chen.com', agent_name: 'David Chen', created_at: '2026-07-08T14:00:00' }],
  '/feature-log/sales-offers': [{ id: 's1', share_code: 'pp99', project_name: 'The Willows', unit_name: '2BR-A', bedrooms: 2, price: 1850000, original_price: 1950000, lang: 'zh', agent_name: 'David Chen', created_by_email: 'david@chen.com', view_count: 7, created_at: '2026-07-09T08:00:00' }],
  '/feature-log/reports': [{ id: 'r1', share_code: 'rc11', title: '陈先生 · 投资意向', status: 'published', kind: 'client', view_count: 3, agent_name: 'David Chen', created_at: '2026-07-07T12:00:00' }],
  '/visitors': [{ identity: 'chen@x.com', visitor_id: 'v1', user_email: 'chen@x.com', browser_count: 1, first_seen: '2026-07-01', last_seen: '2026-07-09', events: 40, views: 12, searches: 5, luna_opens: 2, favorites: 1, contacts: 0, distinct_projects: 6, score: 55, stage: 'warm' }],
  '/lost': [],
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.25 })
const page = await ctx.newPage()
await page.addInitScript(([s]) => { localStorage.setItem('pinzos-lang', 'zh-CN'); localStorage.setItem('pinzos-auth', JSON.stringify(s)) }, [session])
await page.route('**/api/admin/insights/**', (r) => {
  const path = new URL(r.request().url()).pathname.replace(/^.*\/api\/admin\/insights/, '')
  const key = Object.keys(routes).find((k) => path === k || path.startsWith(k))
  if (key) return r.fulfill(J(routes[key]))
  return r.fulfill(J({}))
})

await page.goto('http://localhost:5173/admin/analytics', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(3500)
await page.screenshot({ path: 'shots-compass/dash-overview.png' })

for (const [label, tabText] of [['subscriptions', '订阅'], ['features', '功能记录'], ['customers', '客户']]) {
  await page.locator(`nav button:has-text("${tabText}")`).first().click()
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `shots-compass/dash-${label}.png` })
}
await browser.close()
console.log('ok')
