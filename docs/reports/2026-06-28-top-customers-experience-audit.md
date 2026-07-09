# Top Customers Experience Audit — 2026-06-28

数据窗口：`app_events` 2026-06-17 ~ 06-28（11 天，1977 事件）。来源表：`app_events`、`leads`、`luna_sessions`、`voice_sessions`。

## 1. 最有价值的 10 个客户（按参与度打分）

打分 = property_view×5 + luna_open×8 + search×4 + 总事件数。

| # | visitor (前8位) | 身份 | 页面 | 看房 | Luna | 搜索 | 会话 | api_error | 备注 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | ce2a07df | **内部** lzp6529（你） | 392 | 17 | 6 | 0 | 16 | 15 | 大多是 /admin 自测 |
| 2 | 2fb881e0 | **内部** lzp6529 | 321 | 26 | 3 | 0 | 43 | 1 | |
| 3 | 83be2c8e | **内部** lzp6529 | 312 | 14 | 7 | 0 | 31 | 0 | |
| 4 | 4f16ace7 | shelldubai26（同事/经纪) | 132 | 20 | 3 | 1 | 53 | 0 | 真高意向使用者 |
| 5 | 8ded682d | **真实匿名访客** | 65 | 13 | 0 | 0 | 8 | 0 | 没用 Luna |
| 6 | 63889ccb | 内部 lzp6529 | 63 | 2 | 6 | 0 | 4 | 0 | |
| 7 | ad391edd | **真实访客** | 15 | 0 | 0 | 9 | 1 | 0 | 纯靠搜索探索 |
| 8 | c4ef81e7 | **真实访客** | 10 | 3 | 1 | 0 | 1 | **3** | 撞到 500 bug |
| 9 | 508771a7 | 真实匿名 | 16 | 2 | 0 | 0 | 1 | 0 | |
| 10 | da18410e | 真实匿名 | 5 | 3 | 0 | 0 | 3 | 0 | |

**重要现实**：榜单前列被内部测试账号（`lzp6529@gmail.com`=你本人、`shelldubai26@gmail.com`）占据。真正的外部潜在客户量还很小（8ded682d、ad391edd、c4ef81e7…）。

## 2. 漏 track 的信息（缺口）

1. **`leads` 表 0 行** —— 有 lead 引擎但零产出。根因：前端**只在 Luna 语音助手收集到联系方式时**才建 lead（`/api/leads/contact`）。没有被动留资表单，也不会把高意向行为信号（重复看房、长会话）转成 lead。结果：53 次会话/20 次看房的 shelldubai26 这种高意向用户永远不进 lead 池。
2. **无转化/联系意图事件**：没有 `whatsapp_click` / `phone_click` / `contact_click` / `report_view` / `save_favorite` / `lightbox_open` / tour 互动。看得到客户「看了什么」，看不到「想不想联系」。
3. **无停留时长 / 滚动深度**：`page_view`、`property_view` 只记一次曝光，没有 dwell time，无法衡量单页兴趣深度（Luna/voice 有 duration，普通页没有）。
4. **`luna_open` / `search` 不带 project_id 上下文**（`property_view` 已带，127/127 ✅，可正常关联项目）。

> 建议优先级：①把 lead 捕获从「仅语音」扩成「高意向行为自动建 lead + WhatsApp/电话点击留资」；②加联系意图事件；③加 dwell time。这些是新功能，未实现，仅作建议。

## 3. 体验问题与修复

### ✅ 已修复：项目详情页 area-insights 返回 500（真实客户撞到）
- **现象**：visitor `c4ef81e7` 与 `0eae2413` 在 `/project/f11a4ae4…`（City of Arabia）反复触发 `GET /api/market/area-insights?areaId=466 → HTTP 500`。详情页「位置/区域行情」区块直接报错。
- **根因**：`projectInsights.ts` 的 **Tier 1（development）** 把 `area.id` 设成了 DLD 整数 `area_id`（`String(resolvedAreaId)` = "466"），而 Tier 2/3 用的是 `dubai_areas` 的 **uuid**。前端 `LocationTab` 拿这个 id 去打 area-insights，后端用整数和 uuid 列比较 → Postgres `invalid input syntax for type uuid` → 500。
- **修复**：
  1. `backend/src/services/projectInsights.ts` — Tier 1 改用 `areaMetrics?.area_id ?? null`（uuid），与 Tier 2/3 统一；无 rolling metrics 时回落 null（前端跳过请求，安全降级）。
  2. `backend/src/routes/market.ts` — area-insights 端点加 uuid 正则校验，非 uuid 返回 **400** 而非 500，杜绝整类「整数 → Postgres uuid 报错 → 500」。
- **生产验证**（已部署 tag `20260628-151140`）：
  - `/insights` 现返回 `area.id=6d4f9f96-…`（uuid）✅
  - area-insights uuid → **HTTP 200**（City of Arabia 含 5550 条成交，数据正常）
  - area-insights 整数 466 → **HTTP 400**（不再 500）

### ⚠️ 已知未在本次处理（属更大改造，已有 proposal）
- **Luna 高延迟导致放弃**：22 个 Luna 会话中 7 个单轮（32% 开了就走）；voice 日志显示首响 5s、回复延迟 9–12s。见 memory `luna-experience-redesign`。
- **Lead 捕获缺口**：见上 §2.1。

## 4. 整体优化（第二轮：favorite 持久化 + 全埋点）✅ 已上线

> 触发：用户指出「favorite 登录后要存 db 然后要 merge，整体优化都要做」。对前端埋点系统 + favorite + 登录 merge 做了穷尽审计（两个 Explore agent）后实施。

### 4.1 埋点系统现状（审计结论）
- 前端 `lib/track.ts`（`trackEvent(type, payload, opts)`，batch 队列 + sendBeacon）→ `POST /api/events` → `eventIngest.ts`（白名单校验）。visitor_id 存 localStorage `app-visitor-id`。
- **app_events 的匿名→登录 merge 已存在**：`identifyVisitor()`（AuthContext 登录后调）→ `/api/events/identify` 把该 visitor_id 全部历史事件回填 user_email/user_id。
- 原白名单仅 9 个事件（page_view/property_view/search/luna_*/tutorial_step/auth_failure/api_error），**只有 view 级，无 intent 信号**。

### 4.2 favorite 现状（审计结论）
- 原本**纯 localStorage**（`pinzos-favorites`，v2 结构），无 DB 表、无 API、无 merge → 换设备/浏览器即丢，登录不同步，owner dashboard 看不到。

### 4.3 实施
1. **favorite 服务端持久化 + 登录 merge**
   - 新表 `user_favorites(user_id, project_id, unit_type_id, added_at)`，`unit_type_id=''` 表项目级，`UNIQUE(user_id,project_id,unit_type_id)` 幂等。
   - 新 `backend/src/routes/favorites.ts`：`GET /`（拉取，分组成 v2 wire shape）、`POST /`（加）、`DELETE /`（删，项目级删联带 unit）、`POST /merge`（登录时把本地匿名收藏幂等并入 + 返回统一集）。全 requireAuth。
   - `FavoritesContext`：登录(useAuth)触发 `mergeFavoritesOnLogin()` 并入并采用统一集；登录态下 toggle 双写服务端（best-effort）；登出 `clearFavorites()` 清本地防账号间泄漏。localStorage 仍是匿名/即时/离线来源。
2. **补全转化/意图埋点**（白名单前端+后端各加 8 个）：`favorite_toggle / contact_attempt / resource_download / report_action / share_action / image_view / area_detail / tab_switch`。插桩点：收藏(FavoritesContext)、联系经纪+Request Info(contact_attempt,immediate)、下载手册、生成报告、分享、看大图 lightbox、区域弹窗开关、详情页切 tab。

### 4.4 验证 & 部署
- 前后端 `tsc --noEmit` 0 error（除预存的 client-report-builder 无关报错）。
- favorites SQL 幂等/分组逻辑直连 DB 测过（重复 unit 去重、`''`+unit 行正确归并）。
- 后端已 `quick-deploy`（tag `20260628-153140`）；`/api/favorites` 无 auth → 401（已挂载+守卫）。
- 全部 commit `6899deb` 已 push main → 前端 Cloudflare Pages 自动部署。

### 4.5 仍未做（建议下一步）
- 把高意向**行为**自动转成 lead（现在 leads 仍只来自 Luna 语音留资）——有了 favorite_toggle/contact_attempt 信号后可做规则引擎。
- dwell time / 滚动深度；area-insights / luna_open 带更多上下文。
- owner dashboard 增加新事件类型 + api_calls 的可视化（转化漏斗 / 每客户请求轨迹）。

## 5. 统一身份+追踪中间件（第三轮）✅ 已上线

> 问题：原来"客户行为"只在前端显式 trackEvent 处产生，**成功的业务 API 调用不绑定任何客户**（请求里根本不带 visitor_id，后端也无归因中间件）。且 `requireAuth/requireAdmin/optionalAuth` 每次都远程 `supabaseAdmin.auth.getUser(token)` —— 每个受保护请求一次 Supabase 往返（含 /api/events 热路径）。

### 5.1 设计原则（elegant + 零性能回退）
- **解析与强制分离**：全局 `attachContext` 只做**便宜**的身份解析，鉴权**强制**留给各端点声明式守卫。
- **attachContext 永不发网络**：能本地验签就验，不能就把 token 暂存（`req._deferredToken`），让需要鉴权的端点**懒**回退远程。匿名/公开端点一次远程都不付。
- **追踪在响应后、采样、批量、fire-and-forget**：`res.on('finish')`，对请求延迟影响为 0。

### 5.2 实施
1. **`middleware/context.ts`**（新）：零依赖本地 HS256 JWT 验签（Node `crypto`，拒 alg=none/过期/错签/非HS256→降级），全局 `attachContext` 解析 `X-Visitor-Id` + 本地验签用户 → `req.ctx`。**优雅降级**：配了 `SUPABASE_JWT_SECRET` 走本地（免网络）；没配自动回退远程 = 与原行为完全一致，零回退。
2. **`middleware/auth.ts`**（重构）：三守卫先读 `req.ctx`（本地已验→0 IO），否则远程回退。配 secret 后 `optionalAuth` 在 /api/events 热路径**零网络**。向后兼容（仍填 `req.user`/`req.isAdmin`）。
3. **`middleware/attribution.ts` + `api_calls` 表**（新）：采样记录"谁调了哪个业务 API"。规则：写操作(POST/PUT/PATCH/DELETE)全量 + 关键读白名单(项目详情/insights/market/compare)；跳过 /api/events、/health、perf 轮询、map-pins 等高频噪音。
4. **前端 `track.ts`**：一处全局 `fetch` 拦截器给所有本 API 请求注入 `X-Visitor-Id`（覆盖现有+未来所有调用点，零散改），在 `installTracking()` 启用。

### 5.3 验证 & 部署
- 本地 JWT 验签 5 例单测全过（有效/过期/错签/alg=none/垃圾）。前后端 tsc 0 error。
- 生产（tag `20260628-155834`）：favorites 无 auth→401（鉴权未坏）；项目详情读→200 **且**记入 api_calls(带 visitor_id/status/82ms)；map-pins→200 但**未记录**(采样正确跳过)。
- ⚠️ **要激活提速**：需在两台服务器 compose env 加 `SUPABASE_JWT_SECRET`（Supabase dashboard→Settings→API→JWT Secret）。未配也正常运行（走远程回退），只是没拿到本地验签的提速。

## 6. dashboard 接入新数据 + 失去的客户面板（第四轮）✅ 已上线

> 问题：前三轮采的数据（8 个 intent 事件 + api_calls）dashboard 还没消费；且无流失识别。用户要求：dashboard 好用、与 action event 重叠要智能识别、能分析行为/体验、识别失去的客户。

### 6.1 重叠的本质 → 智能折叠
两数据源是**不同抽象层**：`app_events`=意图层（做了什么），`api_calls`=请求层（取了什么数据）。重叠 OK，做**折叠**而非删：`getVisitorDetail` 的统一时间线以**意图事件为主轴**；2s 内有对应意图的 api 调用折叠掉；无对应的 business-read（insights/market/compare）作为**「隐性研究」**单独成行（`source=api`，淡色渲染）——这是 app_events 看不到的"沉默高强度研究"信号，并计入 `research` 评分。

### 6.2 实施
- **评分 intent 化**：`quickScore` 加权 contact(18)>favorite(8)>report(8)>research(1.5)；`stageFrom` 加 `lost`（曾 warm+ 但沉默 >30d）。
- **概览**：加「收藏」「尝试联系」两张 KPI。
- **访客明细**：新事件计入评分；时间线渲染 10 类新事件 + 淡色 api 研究行（智能折叠后的）。
- **失去的客户面板**（`getLostCustomers` + `/lost` 端点 + `LostCustomers.tsx` + 「流失」tab）：曾有意向但沉默 ≥7d，带原因标签 —— `bug_hit`（故障后流失，关联 api_error/auth_failure，⭐最该跟进）/ `no_contact`（研究深却没联系，漏斗断点）/ `cooling`。点行复用 VisitorDrawer 看明细。

### 6.3 验证 & 部署
- 前后端 tsc 0 error。真实数据测 `getLostCustomers` 识别出 8ded682d（score 30 / 沉默 10d / no_contact）。
- 后端已部署（tag `20260628-161530`）；`/lost`、`/overview` 端点 403（admin 守卫，已挂载）。commit `2e0db9d` push → 前端 Cloudflare Pages 自动部署。

### 6.4 完整闭环
四轮下来：采集（intent 事件 + api 归因）→ 绑定（visitor/user 全链路）→ 展示（统一时间线智能折叠 + 流失识别）。最初"修复客户遇到的问题"的 area-insights 500，现在能通过「失去的客户·bug_hit」自动暴露"哪个故障赶走了哪些高意向客户"。仍未做：行为自动转 lead（leads 仍只来自 Luna 语音）。
