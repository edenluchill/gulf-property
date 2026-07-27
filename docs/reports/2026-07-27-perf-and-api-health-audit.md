# 全站性能 / 失败接口 / 体验异常巡检 —— 2026-07-27

范围：生产 API（api.pinzos.com）+ 生产前端（www.pinzos.com）+ 生产库。
口径：`api_calls`（7–30 天）、`perf_minute` / `perf_alerts` / `perf_slow_requests`（10 天）、
真实浏览器冒烟（`ui-smoke.mjs`）、i18n / SEO 巡检、生产 EXPLAIN。

---

## 0. 结论先说

**没有正在发生的故障。** 7 天内 **零 5xx**；Stripe 回调、登录、付费门全部正常。
真正找到并修掉的是四件「不报错但很烂」的事：

| # | 问题 | 影响 | 状态 |
|---|---|---|---|
| 1 | 带看意向报告每次打开都重算 AI | 经纪每次干等 **6–8 秒**，token 重复烧 | ✅ 已修并部署 |
| 2 | 租金按区筛选走坏计划 | p95 **1.7s**，1.27s 纯浪费 | ✅ 已修并部署 |
| 3 | 扫描器 404 刷爆错误率 | 面板显示 **89% 错误率**，监控失效 | ✅ 已修并部署 |
| 4 | 过期 chunk 兜底不带破缓存 | 微信 X5 客户可能**永远白屏** | ✅ 已修（前端） |

排除掉的假问题：429、Stripe 400、数据陈旧 —— 见 §5。

---

## 1. 带看意向报告：每次打开重算 AI（最严重）

`GET /api/admin/insights/collab/:code` 生产实测 **平均 6264ms、最慢 8202ms**，
是全站最慢的接口，也是 2026-07-24 那条 HIGH_LATENCY 告警的元凶。

根因：`services/collabReport.ts` 第 184 行 `report.ai = await generateNarrative(report)`
—— **同步等 Gemini，而且完全没有缓存**。同一场已经结束的带看，事件一个字都不会再变，
却每打开一次就重新生成一次：经纪每次点开干等 6 秒，token 也白烧一次。

修法：
- `collab_rooms` 加 `ai_report jsonb / ai_report_events int / ai_report_at timestamptz`
- 失效判据用 **`event_count`** 而非时间：带看还在进行 → 事件在涨 → 重算；结束 → 永久有效
- 写回 fire-and-forget（缓存写失败绝不能让经纪看不到报告）
- **带看一结束就先算好**（`precomputeCollabReport`，挂在主持人「结束」和房间 GC 两条路径上）
  —— 总成本不变（每场一次 Gemini），只是把 6 秒挪到没人等的时候

实测（`scripts/_verify-collab-cache.ts`，FUPSU 场）：

```
第一次(生成 + 写缓存): 7438ms
第二次(命中缓存):      1457ms      ← 这 1.4s 还是笔记本→远程库的往返，服务器上是几十毫秒
内容一致: PASS
```

> ⚠️ 第一版比对写的是 `JSON.stringify(a) === JSON.stringify(b)`，报了假红灯 ——
> **jsonb 不保留键顺序**。改成逐字段比对才是真判据。

## 2. 租金按区筛选：教科书式的坏计划

`GET /api/market/rent/summary` p95 **1679ms**（`/rent/projects` 1068ms）。
生产 EXPLAIN（BUSINESS BAY）：

```
Aggregate 1776ms
  └ BitmapAnd 1314ms
      ├ idx_rent_upper_area_name        192,587 行   31ms   ← 真正的选择性在这
      └ idx_rent_annual_amount        3,829,554 行 1275ms   ← 扫了 68% 的表，纯浪费
```

planner 为了 `usage_type='Residential' AND annual_amount>0 AND property_area>0`
这三条**几乎不筛任何东西**的谓词，去扫整个 `idx_rent_annual_amount` 建 bitmap，
只为和区域索引取交集。1.78s 里 1.27s 花在这上面。

修法（`src/db/fix-rent-summary-bitmapand.sql`，CONCURRENTLY 建在 5.6M 行 / 5.5GB 的生产表上）：
把那三条谓词写进**区域/项目索引自己的 partial WHERE**，一次索引扫描就够。

```
1776ms → 751ms     索引扫描 1314ms → 59ms，BitmapAnd 消失
```

外加把 `summary` 里 `stats` / `trend` 两条互不依赖的查询从**串行改并行**
（原来是把两次全表聚合的时间相加）。

> 已有的 `idx_rent_area_projlist` 看着像能用但不行：它带 `project_name IS NOT NULL
> AND <> ''`，只按区筛时会漏掉没有项目名的合约，**口径都变了**。

## 3. 扫描器 404 把监控刷成 89% 错误率

`perf_minute` 显示 07-26 有 **13,726 个 4xx / 15,449 请求**，而 `api_calls` 当天只记了 62 个。
两个数字差 200 倍 —— 查服务器日志，是 13:07–13:31 一台扒密钥的扫描器：

```
GET /.env  /.git/config  /aws-credentials.json  /email/sendgrid_config.json  /wp-json/… → 404 0.3ms
```

≈11,900 个请求，100% 404，我们每个 0.3ms 就拒了，**服务毫发无损**。
但它把那天的错误率刷成 89%。一条每隔几天跳到 89% 的曲线只有两个结局：
要么吓一跳查一场空，要么学会无视它 —— 而后者会让**真的** 4xx 激增也没人看见。
**监控被噪音淹没，等于没有监控。**

修法（`middleware/perfMetrics.ts`）：`status === 404 && !path.startsWith('/api/')` 不进任何指标。
判据故意收得很紧：401/403/429 都是**我们的**语义，一条不排；自己的 `/api` 路由挂错了照常计入。

> ⚠️ 「是不是 /api 下」必须在**入口**算好存闭包 —— `res.on('finish')` 里 Express 可能已把
> `req.url` 剥成子路由相对路径（本项目栽过：一次 2665ms 上传顶爆告警，排除逻辑明明部署了却没生效）。
> 在回调里读 `req.path` 会把真实的 `/api` 404 误判成噪音，那就正好把真问题藏了。

线上对照实验：打 12 个非 `/api` 的 404 → 该分钟 `req=0, err4=0`。✅

## 4. 过期 chunk 兜底漏了微信 X5

`ui-smoke.mjs` 报「过期 chunk 被当成 HTML 发出去」（CF Pages SPA fallback 对缺失资源回
`200 text/html` → 模块 MIME 错误 → 白屏）。`main.tsx` 里已有强刷兜底，但发现**两条兜底不一致**：

- `index.html` 的 **CSS** 兜底：`location.replace(... _r=Date.now())` —— 专门为微信 X5 加的破缓存
- `main.tsx` 的 **chunk** 兜底：裸 `location.reload()` —— **不带**

同一个病、同一批浏览器。X5 无视 `no-cache`，裸 reload 很可能**还是拿那份缓存的旧 HTML**
→ 刷一次仍是旧 chunk 名 → 那把「只刷一次」的锁又不让刷第二次 → **客户永远停在白屏**。
已改成和 CSS 兜底一致（`_r` 一次性参数，启动成功后 `main.tsx` 已有的逻辑会从地址栏擦掉）。

**没做**：改 CF Pages 的 SPA fallback 本身。要让 `/assets/*` 缺失时回真 404 得动 `_redirects`，
而 CF Pages 里 `_redirects` 与静态资源的优先级如果判断错，会 **404 掉全站所有资源**。
客户侧的实际保护是上面那条兜底，已经补齐；这个配置改动风险/收益不划算，先记下。

## 5. 查了但**不是**问题的

| 现象 | 真相 |
|---|---|
| `/api/market/*` 大量 429 | 全是**匿名访客**撞地图限时额度（`map_quota_exhausted`），设计如此。无一例来自登录用户 |
| `/api/billing/webhook` 400 ×3 | 时间戳与扫描器同一分钟 —— 是扫描器 POST 上来签名验不过。**真实 Stripe 回调全 200** |
| `dld_transactions` 陈旧 61h | DLD **源头停发**，我们的同步 0.2h 前刚跑完。告警文案本身就写明了，改代码没用 |
| `/api/favorites/merge` 401 ×58（56 人） | 最后一次 2026-07-13，已修；近 7 天 357 次调用全部 200 / 23ms |
| 404 一大堆（`/wp-json` `/index.php`…） | 扫描机器人，见 §3 |

## 6. 其余体检

- **i18n**：2089 个引用键 × 5 语言全部解析命中 ✅
- **SEO**：7 页 title / canonical / description 全通过 ✅
- **UI 冒烟**：19 项 18 通过（唯一一项即 §4，已处理客户侧）
- **DB**：pool_waiting 全程 0，10 天内 slow_query 个位数，无连接压力
- **容量**：日请求量 2k–15k，与 memory 里「不需要扩容」的结论一致

## 7. 还没覆盖（诚实交代）

- **经纪台需要登录，UI 冒烟覆盖不到** —— 而上次白屏事故正好出在那里。要覆盖得先有一条给自动化用的登录通道。
- **CollabVideo 画中画**未纳入底部浮层几何验收（可拖自由浮窗）。
- `/api/luna/agent/profile` 平均 379ms、`/api/collab/rooms` 262ms —— 不算慢，没动。
