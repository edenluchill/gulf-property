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

- **不影响本次 Google 索引问题**（Googlebot 未被挡；`Google-Extended` 只管 AI 训练不管搜索）
- 但目标客群正是"在 AI 里问迪拜买房"的人。这个默认配置等于把自己从所有 AI 答案里删除。
- `public/llms.txt` 已经写得很完整（面向 AI 的站点说明）—— **写了却被 robots 挡在门外，白费。**
- 这一条可能比 Google 排名更值得改，且改动成本极低。
