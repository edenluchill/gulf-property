# 客户体验优化策略 + 隐患清单（亲历生产数据）

日期：2026-06-28　作者：Claude（基于生产真实数据 + 自审本轮改动）

这份不是空谈——我用生产数据真的"体验"了一遍当前客户状况，并批判性审查了本会话四轮改动有没有埋雷。

---

## A. 我看到的现状（真实数据快照）

- **数据污染**：app_events 共 1981 事件，其中 **1388（70%）来自 6 个内部测试号**（lzp6529 / shelldubai26），真实匿名访客只有 **593 事件 / 229 人**。
- **错误构成**：21 条 api_error 里 **11 条（52%）是 owner 自己 dashboard 的 `perf/alerts/active` 轮询 "Failed to fetch"**（status=null，网络层；服务器 curl 通，返 403）。area-insights 500（3 条）在 15:xx 修复后**未再出现**✅。
- **新能力未经真实验证**：favorite_toggle/contact_attempt 等新 intent 事件 **0 条**；api_calls 仅 **2 行**。埋点/归因上线了但还没被真实流量打过（且前端 X-Visitor-Id 注入需等 Cloudflare Pages 构建生效）。
- **leads 仍 0**。

---

## B. 隐患清单（坏东西，按严重度）

### 🔴 B1. 分析数据被内部测试号污染 70%　— ✅ 已修复（commit 13865ce, 2026-06-28）
> 已实现 internalVisitorIds() + 各聚合排除内部号。实测：事件 1981→560，访客榜从"全是测试号"变成真实客户（#c4ef81e7 等）。
dashboard 所有聚合（overview/visitors/lost/评分）都没排除 OWNER_EMAILS / 测试号。后果：指标、意向评分、流失名单、"最有价值客户"全失真。**这是做任何分析前必须先解决的前提。**
- 修法：analyticsQueries 各查询加 `WHERE user_email NOT IN (内部名单) AND visitor_id NOT IN (内部 visitor)`，或给 app_events/api_calls 加 `is_internal` 标记；内部名单复用 `OWNER_EMAILS` + 一张测试账号表/env。

### 🔴 B2. ad-blocker 可能正在吃掉客户端埋点　— ✅ 已修复（commit fc435d9, 2026-06-28）
> 路径去敏感词:埋点 `/api/events`→也挂 `/api/sync`,分析 `/api/admin/analytics`→也挂 `/api/admin/insights`(旧路径保留兼容)。前端切到干净路径。已验证新路径 204/403、旧路径仍可用。服务端 api_calls 归因本就不受拦截,是兜底。
`perf/alerts/active` 反复 "Failed to fetch"（网络层、非 500、服务器是通的），且全在 `/analytics/` 路径——**典型 ad-blocker / 隐私插件按 URL 含 "analytics" 拦截**。
- **关键推论**：同理 `trackEvent → /api/events` 等客户端埋点也很可能被部分用户的 blocker 吃掉 → 真实客户行为被**静默少计**（解释了真实数据为何稀疏）。
- 好消息：本轮新建的**服务端 `api_calls` 归因不经浏览器拦截**，天然兜底。
- 修法：①把承载分析的路径改成不含 `analytics/events/track` 等敏感词（如 `/api/insights-sink`、`/api/a/b`）或自有子域反代；②关键转化信号（contact/favorite）以**服务端**为权威来源（见 C3）；③owner dashboard 的 perf 轮询失败别再记进 api_error（自我噪音）。

### 🟡 B3. api_calls 无保留/清理策略
表会无限增长（每个写操作 + 关键读都写一行）。运维债。
- 修法：加定时清理（保留如 90 天），参照 perf_minute 的滚动清理；或按月分区。

### 🟡 B4. 新埋点 + API 归因尚未经真实数据验证
逻辑、type-check、单测、合成数据都过了，但真实占比 0~2 行。dashboard 新 KPI 暂时显示 0 属正常。
- 跟进：上线 1~2 天后回看 favorite_toggle/contact_attempt/api_calls 是否如期累积；不涨则排查（部署生效？ad-blocker？埋点点位？）。

### 🟡 B5. SUPABASE_JWT_SECRET 未配 → 鉴权提速未生效
当前生产仍每个受保护请求远程 `getUser` 一次。本地验签快路径要配 secret 才激活（设计已优雅降级，未配也正常）。
- 修法：两台服务器 compose env 加 `SUPABASE_JWT_SECRET`（Supabase dashboard→Settings→API→JWT Secret）。

### 🟢 B6. leads 仍 0
lead 引擎只接 Luna 语音留资，无被动转化。见 C5。

### ✅ B7.（自审通过）fetch 拦截器无破坏
SSE 走 `EventSource`（不经 window.fetch）；R2 上传是不同 origin（拦截器只碰 API_BASE_URL）；对本 API 的请求 `{...init, headers}` 保留 body/method/signal。确认安全。

---

## C. 优化策略（按优先级，均可执行）

### C1. 数据可信化（前提，先做）　— ✅ 已完成（13865ce）
排除内部号后再谈一切分析。改动小、马上见效。→ 解决 B1，并清掉 B2 的 `/admin/analytics/` 自我噪音错误。

### C2. 体验故障闭环（最高价值）
把"修 bug"和"挽回被 bug 赶走的人"连成环：
- 客户撞到 api_error/auth_failure → 实时告警（owner）。
- 「失去的客户·bug_hit」标签已能回溯"哪个故障赶走了哪些高意向客户"（area-insights 500 就是范例）。
- 修复后对受影响且留了联系方式的客户主动回访。
- 指标：bug_hit 流失数、故障 MTTR、回访转化率。

### C3. 数据韧性（承认 ad-blocker）　— ✅ 路径去敏感词已完成（fc435d9）
- 分析/埋点路径去敏感词（sync/insights），减少被拦。→ 已做。
- 关键转化信号（favorite）登录态已服务端权威（user_favorites）；contact 是外链点击无自然 API，靠 /api/sync 干净通道 + immediate flush。
- 仍可选：走自有子域 first-party 反代（更彻底，成本高，暂不做）。

### C4. 漏斗补全（针对 no_contact）
流失主因是"研究很深却从没联系"（no_contact）：
- 对深研究客户（多次 insights/property_view）在页面主动弹"一键 WhatsApp 问顾问"。
- 降低联系门槛（免填表单、直接唤起 WhatsApp）。
- 指标：深研究→contact 转化率、no_contact 流失占比下降。

### C5. 行为自动转 lead（闭合 leads=0）
用 contact_attempt / favorite / 深研究（api_calls research 信号）触发规则引擎自动建 lead，不再只依赖 Luna 语音。→ 解决 B6。

### C6. 激活已建但未生效的能力
- 配 SUPABASE_JWT_SECRET（B5）。
- api_calls 加保留清理（B3）。
- 1~2 天后验证新埋点真实累积（B4）。

---

## D. 建议执行顺序
1. **C1 数据可信化**（前提，小改） → 2. **B2/C3 ad-blocker 韧性 + 停止自我噪音** → 3. **C2 故障闭环告警** → 4. **C5 行为自动转 lead** → 5. **C4 漏斗引导** → 6. **C6 收尾**（secret/清理/验证）。
