# GA4 接入 + Search Console + Project SEO 现状

日期：2026-07-30
触发：owner 问「我们网站接上 Google Analytics 了吗 / 教我怎么加 / project 的 SEO 能做好吸引 C 端吗 / GA 会导致中国无法访问吗」

---

## 一、接入前的现状

全站**没有任何第三方分析**：GA / GTM / PostHog / Plausible / Mixpanel / Hotjar / Clarity 一个都没有。
`index.html` 里也没有 `google-site-verification`。

有的是**自建埋点**，而且在用：
`frontend/src/lib/track.ts` → `POST /api/events` → `app_events` 表 → `/admin/analytics`。
事件白名单在 `backend/src/services/eventIngest.ts`，20+ 种类型，带 `visitor_id` / `user_email` / `session_id` / `path`。

**两套的分工（别想着合并）：**

| | 自建 | GA4 |
|---|---|---|
| 回答的问题 | **这个人**做了什么 | 人**从哪来** |
| 能按 email 串 | ✅ | ❌（免费版做不到用户级） |
| 能和订阅/额度/tour 表 join | ✅ | ❌ |
| referrer / 搜索词 / 广告渠道 | ❌ | ✅ |
| 墙内可用 | ✅ | ❌ |

GA 永远只能是补充 —— 墙内它加载不上，任何功能都不能依赖它。

---

## 二、GA 会不会让中国打不开？—— 实测

用 Playwright 把 `googletagmanager.com` 做成**黑洞**（接住请求永不回应），
这是墙的真实行为：不是干脆拒绝，而是丢包，浏览器一路等到超时。
（`index.html` 里 Google Fonts 那段注释记录过同类事故：阻塞 `<link>` 让 DOMContentLoaded 从 637ms 涨到 30.5 秒。）

打生产站 `https://www.pinzos.com/`：

| 场景 | FCP | DCL | load | 首屏 |
|---|---|---|---|---|
| 不挂 GA（基线） | 348ms | 531ms | 704ms | ✅ |
| GA `async` · 网络正常 | 232ms | 416ms | 597ms | ✅ |
| GA 阻塞 · 网络正常 | 360ms | 483ms | 607ms | ✅ |
| **GA `async` · 墙（丢包）** | **272ms** | **453ms** | 超时 | **✅ 正常** |
| **GA 漏 `async` · 墙（丢包）** | 超时 | 超时 | 超时 | **❌ 全白屏** |

**结论：`async` 写法在墙内完全没影响**，只有 `load` 事件挂着（用户看不见，也没有代码等它）。
**漏掉 `async` 就是整站白屏。**

> ⚠️ 探针写错过一次。第一版用 `document.createElement('script')` 注入，五个场景数字一模一样，
> 差点得出「怎么写都没事」。原因是**动态插入的 `<script>` 天生 async**，测不到阻塞写法。
> 必须把标签写进 HTML 源码再交给浏览器。脚本：`frontend/scripts/_probe-ga-china.mjs`。

---

## 三、GA4 实际接法（已完成，G-94R0GDSRHK）

### 3.1 `frontend/index.html`

位置在**规范域跳转之后**（Google 的说明写「紧跟 `<head>`」，照做会让裸域访问先加载一次 GA 再 301 跳走，多一次请求还多算一个会话）。

```js
(function () {
  var ID = 'G-94R0GDSRHK'
  // 带访问凭证的分享短链，一整个不加载 GA（见 3.3）
  if (/^\/(v|t|pp|r|cr|i|factsheet|verify)\//.test(location.pathname)) return
  window.dataLayer = window.dataLayer || []
  window.gtag = function () { window.dataLayer.push(arguments) }
  gtag('js', new Date())
  gtag('config', ID, { send_page_view: false })
  var s = document.createElement('script')
  s.async = true                       // ← 少这行 = 墙内白屏
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + ID
  document.head.appendChild(s)
})()
```

### 3.2 SPA 手动上报 —— `frontend/src/lib/ga.ts` + `App.tsx` 的 `RouteTracker`

`send_page_view: false` 是**故意的**。自动上报在 `pushState` 的瞬间触发，那时 Helmet 还没把
`<title>` 换掉 → **GA 里每一页都顶着上一页的标题**，而且这种错没人会发现。

改由 `gaPageView()` 在 `setTimeout(0)` 里发 —— Helmet 也是在 effect 里写 title 的，
effect 顺序取决于组件在树里的位置，不能假设我们排在它后面；甩到宏任务就保证是这一轮
commit 的所有 effect 都跑完之后。

**踩到的坑：GA4 认 `page_location`（完整 URL），不认 `page_path`。**
`page_path` 是 UA 时代的字段，GA4 的「Page path」维度是从 `page_location` 里切出来的。
第一版打码打在 `page_path` 上，实测 `dp` 根本不落地 —— 等于没打。

### 3.3 🔴 分享短链绝不进 GA

`/v/aB3xK9` 里那串就是**访问凭证**：谁拿到谁就能看这场带看（客户姓名、他家的报价）。
`robots.txt` 里这些路径全部 `Disallow`，分析上报没道理比爬虫更宽。

**只给 page_view 打码是不够的** —— GA4 的「增强测量」会自己发 `scroll` / `user_engagement`，
那些事件带的是浏览器里的**真实 URL**。探针实测抓到过：

```
③ /v/<code> : scroll dl=http://localhost/v/zzTOPSECRET99   ← 泄露
```

所以做了两道闸：
1. `index.html` 按路径守卫，命中就**根本不拉 gtag.js**（主力：这些页面永远是从外部链接整页打开的）
2. `ga.ts` 里用 `gtag('set', { page_location })` 兜住「站内路由跳进去」的情况

名单在**三处**出现，必须一致：`public/robots.txt` 的 Disallow、`index.html` 的正则、`ga.ts` 的 `SHARE_PREFIXES`。

### 3.4 验收

`frontend/scripts/_probe-ga-verify.mjs`（改 GA 片段或 `ga.ts` 之后必跑）。
拦 `google-analytics.com` 的上报，检查四件事。**生产构建**实测：

```
✅ 首屏发出指向 / 的 page_view(1 条)
✅ SPA 切换后指向 /transactions 的 page_view 只有 1 条
✅ 没有任何一条上报带着真实 code(漏了 0 条)
```

真实产物在墙内丢包下：`FCP=256ms · DCL=660ms · 首屏 ✅ 有内容`。

> **两个验证陷阱**（都踩过）：
> 1. **必须用 `npm run build` + `preview` 验，不能用 dev。** StrictMode 会把 effect 跑两遍，
>    dev 下首屏永远是 2 条 page_view —— 会被误读成 `send_page_view:false` 失效。
> 2. **别把上一页的滞留 beacon 算进当前轮。** GA 是批量延迟发送的，每一轮都会捎上一页
>    没发完的。判据要写成「dl 指向本轮目标页的 page_view 有几条」。

---

## 四、Search Console（未做，需要 owner 操作）

零脚本、零性能成本、零合规负担，回答的问题是自建埋点和 GA 都答不了的：
**Google 到底收录了多少页、什么词搜到我们、排第几**。

1. [search.google.com/search-console](https://search.google.com/search-console) → 添加资源 → 「网址前缀」→ `https://www.pinzos.com`
2. 验证方式选「HTML 标记」，拿到那行 `<meta name="google-site-verification" content="..." />`
3. **把 content 值发给我，我加进 `index.html`**（必须静态写死，不能走 Helmet —— Google 验证器不跑 JS）
4. push → CF Pages 部署完 → 回 GSC 点验证
5. 通过后在「站点地图」提交 `sitemap.xml`

---

## 五、Project 的 SEO —— 现状与判断

### 5.1 现状：project 页对搜索引擎等于不存在

```bash
curl https://www.pinzos.com/project/235ab5c1-...
→ <title>Pinzos - A New Way to Buy Off-Plan in Dubai</title>
```

53 个楼盘页，原始 HTML 里是**同一个标题、同一段 description**。
`ProjectDetailPage.tsx:392` 的 Helmet 是客户端注入的，要等 Google 渲染队列排到才看得见。

更要命的是**根本爬不到**：
- `sitemap.xml` 9 条 URL，**一个 project 都没有**
- 首页是地图应用，没有任何指向楼盘页的 `<a href>`

### 5.2 技术上可行，而且这条路已经跑通过

`frontend/functions/v/[code].ts` 就是用 Cloudflare 边缘的 HTMLRewriter 把分享链接的 OG 标签
改写成真实内容。同一套手法搬到 `/project/:id`（加 `functions/project/[id].ts`），
楼盘的 title / description / JSON-LD 就能进原始 HTML —— **不需要上 SSR 框架**。
再让 sitemap 在构建期把所有楼盘 URL 生成进去。估时约 1 天。

### 5.3 但吸引 C 端的杠杆不在楼盘页

100 个楼盘页去打「Dubai off-plan」这类头部词，对手是 Property Finder 和 Bayut ——
十万级房源 + 多年权重，这仗打不赢。楼盘名长尾词（"Sobha Hartland II price"）能拿到量，
但那是**一个楼盘一个词**，100 个楼盘就是 100 根小水管，而且**楼盘卖完词就死**。

**真正独有、竞品编不出来的资产是 231 个区的 DLD 成交数据。**
"JVC rental yield"、"Dubai Marina price trend" 这类词有稳定搜索量，是买家决策前的搜索意图，
而且**不会过期**。231 区 × 5 语言 ≈ 1000+ 个有真实数据的页面。
—— 这与 `docs/reports/2026-07-18-seo-indexing-diagnosis.md` 的结论一致，当时估 3–5 天。

同一份报告还写了一句现在依然成立的话：**先修漏斗，再开流量阀门**。
当时数据是 52 注册 / 36 试用 / 只有 1 个真实外部用户建过 tour。
引流是给漏斗灌水，漏斗有洞的话灌多少漏多少。参见 `activation-crisis-2026-07-17`。

---

## 六、建议顺序与状态

| # | 事项 | 估时 | 状态 |
|---|---|---|---|
| 1 | GA4 接入 | — | ✅ 已完成并验证 |
| 2 | Search Console | 半小时 | ⏸ 等 owner 拿验证码 |
| 3 | project 页边缘改写 + sitemap 构建期生成 | ~1 天 | ⏸ 未开始（本周楼盘上到 100，正好一起进） |
| 4 | 区域数据程序化页面（231 区 × 5 语言） | 3–5 天 | ⏸ 建议等激活率有起色再开 |

---

## 附：相关文件

- `frontend/index.html` —— GA 片段 + 分享短链守卫
- `frontend/src/lib/ga.ts` —— 全站唯一碰 gtag 的地方
- `frontend/src/App.tsx:62` `RouteTracker` —— 两套埋点的唯一触发点
- `frontend/scripts/_probe-ga-china.mjs` —— 墙内丢包影响实测（加任何第三方脚本前先跑）
- `frontend/scripts/_probe-ga-verify.mjs` —— GA 上报正确性 + 分享码防泄露
- `docs/reports/2026-07-18-seo-indexing-diagnosis.md` —— 上一轮 SEO 诊断
