# 登录韧性 + 错误监控 spec

> 2026-06-24 实现。解决"手机端有时莫名登录失败,落到 `/auth/callback#access_token=...` 的
> Authentication Error 页",并新增**失败登录 / 异常 API 调用**的采集 + 移动端友好的 Admin 监控。

## 1. 问题根因

手机回调 URL 形如 `https://www.pinzos.com/auth/callback#access_token=...&refresh_token=...`
(implicit/hash 流)。旧 `AuthCallback.tsx` 只 `await supabase.auth.getSession()`,问题:

1. **竞态**:`AuthContext` 在 app 根挂载时也调了一次 `getSession()`,与 `AuthCallback` 抢着消费
   URL hash。`detectSessionInUrl` 解析一次后即清掉,手机慢一拍时回调拿到空 / 解析抛异常。
2. **兜底文案**:截图里的 "An error occurred during authentication" 来自 `catch` 块,说明是
   **抛了异常**(典型:手机 storage 受限 / hash 解析失败),而非正常的 `error.message`。
3. **零上报**:失败完全不可见,客户静默流失。
4. 可能的诱因还包括 `www` 与 apex 源不一致 → PKCE `code_verifier` 跨源丢失。

## 2. 方案

### 2.1 让登录"更聪明"(`frontend/src/components/auth/AuthCallback.tsx` 重写)

显式分支,不再赌竞态:

1. provider 端错误(`?error` / `#error_description`)→ 直接显示 provider 的原因。
2. implicit/hash 流(`#access_token` + `refresh_token`)→ 主动 `setSession()`。
3. PKCE 流(`?code=`)→ `exchangeCodeForSession()`。
4. URL 里没东西(可能 AuthProvider 已消费 hash)→ 轮询 `getSession()` ~4s 赢竞态,而非秒失败。

失败时:采集完整诊断 + 上报,按钮从"返回首页"改为**"重新登录"**(一键重试原 provider,
provider 记在 `sessionStorage.authProvider`,由 `AuthContext` 在发起 OAuth 时写入)。

诊断字段(进 `payload`):`reason / message / provider / has_hash / has_code / storage_ok / origin`。

### 2.2 异常 API 采集(范围:网络失败 + 5xx + 超时/429)

`frontend/src/lib/errorCapture.ts` —— 全局 monkey-patch `window.fetch`,`installApiErrorCapture()`
在 `App.tsx` 随 `installTracking()` 一次性挂载。只对**自家 API host** 上报,只报:

- 网络失败(fetch reject:离线 / DNS / reset / CORS)
- 5xx
- 408 / 429

预期 4xx(401/403/404/校验)**不报**(正常业务流,会淹没信号)。自带节流(每签名/每分钟封顶
3 次、全局 30 次)防后端全挂时刷爆 ingest。绝不改变 fetch 行为、绝不抛进 app。

### 2.3 采集管道(复用现有,零新表)

- 事件统一进 `app_events`(`event_type` 自由文本)。后端 `eventIngest.ts` 的 `ALLOWED_EVENTS`
  新增 `auth_failure` / `api_error`;走已有的 fire-and-forget `/api/events`。
- `lib/track.ts` 新增 `trackError(type, payload)`——立即 flush(用户常即将离开)。

### 2.4 Admin 错误监控(移动端友好)

- 后端:`analyticsQueries.ts` 加 `getErrorOverview / getErrorGroups / getRecentErrors`;
  `admin-analytics.ts` 加 `GET /errors`(`optionalAuth + requireOwner` 双闸,只读)。
- 前端:`lib/analyticsApi.ts` 加 `fetchErrors`;新组件 `components/analytics/ErrorMonitor.tsx`
  (卡片列表非宽表,2 列 stat 网格,签名分组 + 最近事件 + 类型筛选);`AdminAnalytics.tsx`
  新增「错误监控」tab(`AlertTriangle` 图标)。

### 错误签名(分组逻辑)

- `auth_failure` → `reason`(或 `provider`)
- `api_error` → `METHOD endpoint → status`(path 已在前端去掉 query)

## 3. 部署

- **DB**:无需迁移(`app_events` 已存在,新事件类型只是白名单)。
- **后端**:`backend/quick-deploy.ps1`(additive、零风险:白名单 + 一个只读 owner-gated 路由)。
- **前端**:git push → Cloudflare Pages 自动 deploy(含 AuthCallback 重写,登录链路改动)。

## 4. 移除方式(完全解耦)

删 `errorCapture.ts` + `App.tsx` 里的 `installApiErrorCapture()` + `ErrorMonitor.tsx` +
`/errors` 路由 + 这两个 query 即可下线监控;AuthCallback 的韧性改动独立保留。

## 5. 涉及文件

后端:`services/eventIngest.ts`、`services/analyticsQueries.ts`、`routes/admin-analytics.ts`
前端:`components/auth/AuthCallback.tsx`、`contexts/AuthContext.tsx`、`lib/track.ts`、
`lib/errorCapture.ts`(新)、`lib/analyticsApi.ts`、`components/analytics/ErrorMonitor.tsx`(新)、
`pages/AdminAnalytics.tsx`、`App.tsx`、`i18n/locales/{en,zh-CN}/auth.json`

## 6. 第二轮(2026-06-24,用户反馈)

1. **错误监控 404**:首轮后端没部署成功(Docker 没开),`/errors` 路由在生产不存在 → 前端死转圈。
   修复 = 真正部署后端 + **自测**:`curl /errors` 返回 403(路由在,owner-gated)而非 404;用
   `db-query.ts` 跑分组 SQL 确认合法。教训:交付前必须自测线上端点。
2. **Dashboard 改版(desktop + mobile)**:
   - sticky header(标题 + 时间范围 segmented + 下划线 tab),范围控件不再悬在页中间。
   - KPI strip(独立访客/搜索/…)**只在概览 tab**,不再每个 tab 重复。
   - 下划线式 tab,移动端横向滚动(隐藏滚动条),`bg-slate-50` 现代化底色。
3. **访客明细同邮箱重复**:根因 = `getVisitors` 按 `visitor_id` 分组,同一登录用户多浏览器=多行。
   修复 = 按 `identity = COALESCE(user_email, visitor_id)` 合并,representative 取最近浏览器,
   多浏览器显示「N 设备」badge;drill-down 按 identity 取,`getVisitorDetail` 用
   `visitor_id = $1 OR user_email = $1` 合并整人历史。已用 prod 数据验证(lzp 3 设备 / shell 2 设备)。
