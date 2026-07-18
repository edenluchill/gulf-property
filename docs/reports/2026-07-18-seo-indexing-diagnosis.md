# SEO 索引诊断：为什么 Google 只收录了 4 个页面

日期：2026-07-18
触发：Google Search Console 显示 pinzos.com 已索引 4 页 / 未索引 2 页
（未索引原因：Page with redirect ×1、Crawled - currently not indexed ×1）

## 结论先行

**4 个页面不是故障，约等于这个站目前"公开可索引内容"的全部。**
技术层面有三处硬伤在压着它，但全部修完也只能从 4 涨到约 7 —— 因为没有内容可放。
真正的增量只能来自把 DLD 数据做成程序化页面，而那是个独立项目，且与当前
「激活率」瓶颈存在优先级冲突。

---

## 一、技术硬伤（实测取证）

### 1. sitemap 根本不存在（最致命）

```bash
curl -s -o /dev/null -w "%{http_code}" https://www.pinzos.com/sitemap.xml
# → 200

curl -s https://www.pinzos.com/sitemap.xml | head -3
# → <!doctype html>
#   <html lang="en">
#     <head>
```

SPA fallback 把所有未知路径吐成 index.html。Google 抓到 HTML 而非 XML → 等于零 sitemap。
`frontend/public/` 下确实没有该文件。

后果：Google 只能靠首页链接爬。而首页主体是地图应用，没有可爬的 `<a href>` 目录结构。

### 2. 裸域与 www 双 200，且全站无 canonical

```bash
curl -s -o /dev/null -w "%{http_code} redirect=%{redirect_url}" https://pinzos.com/
# → 200 redirect=（空）

curl -s https://www.pinzos.com/ | grep -i canonical
# → 无输出
```

`pinzos.com` 与 `www.pinzos.com` 对 Google 是两套重复内容。
GSC 里的 **"Page with redirect"** 即为此（Google 执行了 index.html 中的 JS 跳转）。

> 关联：`canonical-domain-session-split` 记忆条目中「边缘 301 待做」正是这一条。
> **它同时是"过一会回来要重登"的根因和 SEO 重复内容的根因，一处修两个问题。**

### 3. 各路由原始 HTML 完全同构

`frontend/index.html` 中 `<title>` / `description` / OG 全是静态默认值。
仅 5 个文件在客户端设置 `document.title`：

```
src/main.tsx
src/pages/AboutPage.tsx
src/pages/LegalPages.tsx
src/pages/PaymentPlanSharePage.tsx
src/pages/PricingPage.tsx
src/pages/ProjectDetailPage.tsx
```

Google 首轮抓取只看到空 `<div id="root">` 与同一个标题，需等渲染队列排到才能区分页面。
`/project/:id` 这类数百页面靠此路径基本爬不出来。

（已索引的 4 页极可能就是有 `document.title` 的那几个：`/`、`/about`、`/pricing`、法务页之一。）

---

## 二、根本问题：没有可索引的内容

清点 `frontend/src/App.tsx` 的 43 条路由：

| 类别 | 路由 | 是否应索引 |
|---|---|---|
| 公开内容页 | `/` `/about` `/pricing` `/privacy` `/terms` `/areas` `/transactions` | ✅ 应索引 |
| 分享短链 | `/v/:code` `/pp/:code` `/r/:code` `/cr/:code` `/i/:code` `/factsheet/:code` `/verify/:code` | ❌ 私密，不该索引 |
| 登录后应用 | `/agent/*` `/profile` `/luna/*` `/favorites` `/compare` `/report` | ❌ 无内容可爬 |
| 后台 | `/admin/*` `/developer/upload` `/langgraph/test` | ❌ |
| 动态详情 | `/project/:id` | ⚠️ 理论可索引，但需 SSR |

**公开可索引 ≈ 7 页。修完全部技术问题 = 4 → 7。不会带来流量。**

---

## 三、唯一有量的方向：程序化 SEO

手上有 231 个迪拜区域的真实 DLD 成交价 / 租金 / 回报率 —— 全网独一份，竞品编不出来。
「Dubai Marina 房价走势」「JVC 租金回报率」这类词有稳定搜索量，且是买家决策前的搜索意图。

- 规模：231 区 × 5 语言 ≈ 1000+ 个有真实数据的页面
- 技术前提：需 SSR 或构建期预渲染，纯 SPA 做不到
- 可行性：Cloudflare Pages Functions 这条路已验证可行（`functions/v/[code].ts`
  已用 HTMLRewriter 在边缘改写 OG 标签）
- 估时：3-5 天

---

## 四、建议与优先级冲突

### 建议做的（止血，约半小时）

1. 生成真正的 `public/sitemap.xml`（含上述 7 个公开页）
2. Cloudflare 边缘 301：`pinzos.com` → `www.pinzos.com`
   —— **本来就欠着，且顺带修登录丢 session**
3. 全站 `<link rel="canonical">`
4. 各路由独立 `<title>` / `description`
5. `robots.txt` 显式 `Disallow` 分享短链与后台路径

**明确预期：这些不会带来流量，只是把地基补平。**

### 建议先别做的（程序化 SEO）

参考 `activation-crisis-2026-07-17`：
**当前瓶颈是"试用后到首次价值"（52 注册 / 36 试用 / 仅 1 个真实外部用户建过 tour），
不是获客。** 现在把 3-5 天砸在引流上，引来的人大概率掉进同一个漏斗洞里。

先修漏斗，再开流量阀门。

---

---

## 实施记录（2026-07-18 当天完成）

提交：`bc7f42f`、`7ad59c4`、`c04bd6d`

### ✅ 已完成并线上验证

| 项 | 状态 | 验证 |
|---|---|---|
| 边缘 301 裸域→www | ✅ | `curl pinzos.com/about → 301 https://www.pinzos.com/about`，query 保留 |
| sitemap.xml | ✅ | `application/xml`，7 条 `<loc>`，命名空间正确 |
| canonical 全部指向 www | ✅ | seo-check.mjs 7/7 通过 |
| /areas /transactions 加 Helmet | ✅ | 有独立 title + description + canonical |
| /project/:id 加 canonical | ✅ | 钉死 www，不用 `window.location.origin` |
| robots.txt Disallow 分享短链/后台 | ✅ | 已生效（`*` 组会合并） |
| **robots.txt 放行 AI 爬虫** | ❌ **未生效** | 见下 |

### 施工中发现的两个既有 bug（不在原诊断里）

**1. 每页有两个 `<meta name="description">`**

index.html 的静态默认值 + 页面 Helmet 注入的，静态那份排在前面。Google 对重复
description 行为未定义，大概率取第一个 → **各页面精心写的 description 一直是废的**，
搜索结果里全站共用同一句泛泛介绍。

`curl` 看不出来（Helmet 是客户端注入的，静态 HTML 里只有一份），所以藏了很久。
是写 `scripts/seo-check.mjs` 做真渲染验证时才撞出来的。

修法：index.html 那份加 `data-rh="true"` 交给 react-helmet-async 认领 → 页面级
Helmet 变成**替换**而非追加。认领后必须保证任何路由都有人给值，否则 Helmet 会删掉它
→ 兜底组件 `src/components/DefaultSeo.tsx` 挂在 App 顶层。**两者是一对，别只改一边。**

**2. 首页此前根本没有 canonical**（它没有页面级 Helmet）—— 由 DefaultSeo 一并补上。

**3. ProjectDetailPage 的 og:image 兜底是相对路径** `/og-image.jpg`，爬虫会忽略。
index.html 里为此改过一次，这条兜底路径当时漏了。

### 新增工具

`frontend/scripts/seo-check.mjs` —— **改 SEO meta 后必跑**。
真渲染 7 个公开页，校验 title / description / canonical 齐全且指向规范域。

```bash
cd frontend && node scripts/seo-check.mjs        # 打生产
cd frontend && node scripts/seo-check.mjs http://localhost:5173
```

⚠️ 坑：**别用 `networkidle` 等首页**。首页是地图，瓦片一直在流，networkidle 永远不触发
→ 超时后固定 sleep 时 React 还没挂完 → 报「首页无 canonical」的假阴性（当天误报过一次）。
已改为等 Helmet 真的注入标签。

---

## ⚠️ 剩下一件事需要你手动做：Cloudflare 面板

**自建的 `public/robots.txt` 没能放行 AI 爬虫。** 实测线上生效的内容是：

```
User-agent: ClaudeBot        Disallow: /     ← Cloudflare 托管版，排在前面
User-agent: GPTBot           Disallow: /
...
User-agent: *                Allow: /        ← 我们的文件被追加在后
Disallow: /v/ …
```

robots.txt 的语义是**最具体的 User-agent 组胜出**，`ClaudeBot` 比 `*` 更具体
→ **Cloudflare 的阻断依然赢**。我们的 `Disallow: /v/` 等规则生效了（`*` 组会合并），
但放行 AI 的意图没实现。

**需要在 Cloudflare 面板关掉托管的 AI 爬虫阻断**（位置大致在域名下的
AI Crawl Control / Bots → "Block AI Scrapers and Crawlers"，或 managed robots.txt 设置）。
关掉后再 `curl https://www.pinzos.com/robots.txt` 复核。

这条是否要做取决于一个判断：**你愿不愿意让 AI 抓取你的 DLD 数据展示页**。
放行 = 有机会出现在 AI 答案里；不放行 = 保护数据但对 AI 隐身。
`public/llms.txt` 已经写好了，只在放行后才有意义。

---

## 五、附带发现：AI 爬虫被默认配置全挡

线上 `robots.txt` 是 Cloudflare 托管的默认版本，含：

```
User-agent: ClaudeBot      Disallow: /
User-agent: GPTBot         Disallow: /
User-agent: CCBot          Disallow: /
User-agent: Bytespider     Disallow: /
User-agent: meta-externalagent  Disallow: /
User-agent: Google-Extended     Disallow: /
```

### ⚠️ 更正（当天晚些时候）

**本报告初版在这里下了个过度的结论**：看到 `ClaudeBot / GPTBot Disallow` 就写成
"等于把自己从所有 AI 答案里删除"。**这是错的，写下来避免以后重犯。**

上面那份阻断清单里的全部是**训练类**爬虫。决定能否进入 AI 回答的是另一批：

| 类别 | 代表 UA | 作用 | 当前状态 |
|---|---|---|---|
| 训练爬虫 | ClaudeBot, GPTBot, CCBot, Google-Extended, Bytespider | 内容进模型权重 | 被挡 |
| **答案/搜索爬虫** | **OAI-SearchBot, ChatGPT-User, PerplexityBot, Claude-User, Claude-SearchBot** | **实时抓取来回答用户提问** | **本来就放行** |

也就是说现状是「AI 能实时抓你、但你的内容不进模型权重」—— 一个相当合理的默认值，
不是"AI 看不见你"。`llms.txt` 也并没有被挡在门外。

**教训：robots.txt 里看到 AI 相关 UA 被 Disallow，先分清训练类还是答案类，
别把两者混为一谈。** 对获客有直接意义的是后者。

### 结论：只需要改一个下拉

Cloudflare 面板 → pinzos.com → 右侧 **Manage AI bot access**：

| 下拉 | 现值 | 应改为 | 理由 |
|---|---|---|---|
| Block AI training bots | Block only on pages with ads | **不动** | 是网络层拦截规则，但只作用于有广告的页面 —— 站点没有广告，**它现在什么都没拦**，空转 |
| **Manage your robots.txt** | Set your preference to block training in robots.txt | **改为不托管** | **真正的元凶**：把 CF 指令插在我们文件前面，而 robots.txt 是「最具体的 UA 组胜出」→ CF 的 `ClaudeBot: Disallow` 永远压过我们的 `*: Allow` |

关掉托管后 `frontend/public/robots.txt` 成为唯一真相源。

### robots.txt 的一个致命写法（已在文件注释里标红）

🔴 **别为某个 AI 爬虫单开一组。** 一个爬虫只读它匹配到的**最具体那一组**。
一旦写了 `User-agent: GPTBot / Allow: /`，它就**完全不看 `*` 组** ——
下面那些 `Disallow: /v/ /pp/ …`（分享短链，内含真实客户名和报价）对它全部失效。
要放行就靠 `*` 组的 `Allow: /`，绝不单开。
