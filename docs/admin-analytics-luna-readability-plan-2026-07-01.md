# Admin 分析可读性改造 · Phase 1(2026-07-01)

## 背景 / 诊断(已用两个探查 agent 核实)

**好消息:数据全采到了。** `luna_sessions.transcript`(JSONB)存的是整场会话的 `JSON.stringify`(≤1MB),含双向 `messages[]`、`toolCalls[]`(**含 params + result**)、`events[]`、`errors[]`、`metrics{}`。问题几乎都在展示层 + 两个采集小漏 + 语音识别本身质量。

| 用户痛点 | 根因 | 层 |
|---|---|---|
| 点客户行为看不到细节 / 点 Luna 不跳转 | `getVisitorDetail` 已返回 `lunaSessions`(`analyticsQueries.ts:346-350,481`),但 `VisitorDrawer` 没渲染;两视图 `visitor_id`/`session_id` 互不链接 | 前端 |
| 全是"匿名" / 想按 user id 区分 | ① 会话用 `navigator.sendBeacon` 上报(`debugLogger.ts:170`)带不了 Authorization → `user_email` 恒 NULL;② 前端只按 email 判匿名(`AdminAnalytics.tsx:365`),忽略了行里已有的 `visitor_id` | 后端查询 + 前端 |
| 对话细节看不到工具参数/结果 | params+result **在库里**(实测 `search_projects {developer:"Emaar"}→{count:0}`),`SessionViewer.tsx:87-93` 只画名字+耗时 | 前端 |
| 转录几乎没正常人话 | 人类侧是 Gemini Live `inputAudioTranscription`(`VoiceAssistantContext.tsx:970,636`),中文/中英混识别差,拼接逻辑本身是对的 | 上游,不可修 → 用 AI 摘要绕过 |
| dashboard 臃肿难分析 | 11 tab 挤 442 行单文件;列表无筛选/排序/按人归并/下钻 | IA(Phase 2)+ 本期加筛选/摘要 |

**关键洞察**:原始语音转录不可救,但"可分析"完全能实现——靠 **AI 中文摘要 + 工具参数/结果 + 互链**,把已有富数据翻译成人能读的东西。

## Phase 1 范围(5 项)

### 1. 工具参数/结果展示(纯前端)
`SessionViewer.tsx` 每个 tool call 除名字+耗时外,展示 `params` 和 `result`(折叠 JSON,`<details>` 或点击展开)、`error`。`analyticsApi.ts` 的 `toolCalls` 类型补 `result?: unknown`。data 已在 `detail.transcript.toolCalls`。

### 2. 客户 ⇄ Luna 互链(前端)
- `VisitorDrawer`(`Visitors.tsx`)渲染已加载的 `d.lunaSessions`:每条显示时间/时长/句数/工具数/摘要,点击 → 开 `SessionViewer`(在抽屉内嵌 modal,传 session_id 自取)。
- Luna 列表行 & 详情显示 `visitor` 短ID;可点击回跳访客(至少显示 shortId 做关联)。

### 3. 匿名 → 短ID + 抓登录身份(后端查询为主)
- **身份解析走服务端 join**(比改 beacon 稳,且能救历史匿名会话):`getLunaSessions`/`getLunaSession` 用 `COALESCE(ls.user_email, ae.email)`,`ae` = `LEFT JOIN LATERAL (SELECT email FROM app_events WHERE visitor_id=ls.visitor_id AND email IS NOT NULL ORDER BY created_at DESC LIMIT 1)`。**先确认 `app_events` 的 email 列名**(agent 说 `/identify` 把 email stamp 到 app_events;`events.ts:117`)。
- 前端:actor = `email || '#'+shortId(visitor_id)`(参照 `Visitors.tsx:81` 已有的 shortId 逻辑),不再一律"匿名"。
- (可选后续)采集侧把 `sendBeacon` 改 `fetch(keepalive:true)` 带 token —— 本期不做,服务端 join 已解决展示。

### 4. 每场 AI 中文对话摘要(后端 + 前端)—— 本期核心
- **DB**:`luna_sessions` 加列 `summary text`、`summary_at timestamptz`。迁移文件 `backend/src/db/add-luna-session-summary.sql`(用户跑 db-runner)。
- **服务**:`backend/src/services/lunaSummary.ts` → `summarizeLunaSession(transcript): Promise<string|null>`。用 `@google/genai` Gemini Flash(`gemini-3-flash`),best-effort,失败返回 null。参照 `services/collabReport.ts` / `luna-tour/auto-report.ts` 的 Gemini 调用范式。
  - 输入:把 transcript 压成紧凑文本 —— 用户消息、Luna 消息、每个 toolCall 的 `name(params)→result`、errors。
  - Prompt(中文输出,2–4 句):**客户意图 / Luna 做了什么(调了什么工具、结果如何)/ 有没有帮上、有无问题**。明确要求:即使人类转录残缺,也要结合工具调用和 Luna 回复推断意图。
- **写入时生成**:`events.ts` upsert 后 fire-and-forget 调 summarize 并 `UPDATE ... SET summary=, summary_at=`(仅当 transcript 有内容)。→ 之后每场新会话自带摘要。
- **回填**:owner 触发端点 `POST /admin/analytics/sessions/backfill-summaries`(限量,如每次 ≤30 场无摘要的),给现有 26 场补摘要。
- **读取**:list 与 detail 查询都返回 `summary`;detail 打开时若 `summary` 为空则同步生成+缓存再返回。
- **前端**:列表行显示摘要(一行截断);详情顶部显示完整摘要;列表加"补全摘要"按钮触发 backfill。

### 5. Luna 列表筛选(后端参数 + 前端)
- `getLunaSessions` 接受 `errored`(仅出错)、`visitorId`、`q`(在 summary/transcript 文本里 ILIKE)、`tool`(用过某工具名)、`limit/offset`(已有 offset)。
- 前端:Luna tab 顶部加筛选 chips(仅出错 / 用了工具 / 搜索框 by summary|visitor),分页/加载更多。

## API 契约

- `GET /admin/analytics/sessions?limit&offset&errored&visitorId&q&tool` → `sessions[]`:
  `{ id, session_id, created_at, visitor_id, email:string|null, short_id, duration_ms, turn_count, tool_call_count, had_error, summary:string|null }`
- `GET /admin/analytics/sessions/:id` → 上述字段 + `transcript{messages,toolCalls[{name,params,result,duration,error}],errors,metrics}`;若 `summary` 空则生成+缓存后返回。
- `POST /admin/analytics/sessions/backfill-summaries` → `{ generated:number }`(owner,限 ≤30/次)。
- `GET /admin/analytics/visitors/:id` 已返回 `lunaSessions`:确保每条含 `session_id, created_at, duration_ms, turn_count, tool_call_count, had_error, summary`。

## 关键文件
- 采集/拼接:`frontend/src/contexts/VoiceAssistantContext.tsx`、`frontend/src/hooks/voice-assistant/debugLogger.ts`
- 写入:`backend/src/routes/events.ts:42-95`
- schema:`backend/src/db/luna-sessions-schema.sql`(+ 新迁移)
- 读取:`backend/src/services/analyticsQueries.ts:563-585`、`backend/src/routes/admin-analytics.ts:78-84`
- 展示:`frontend/src/components/analytics/SessionViewer.tsx`、`frontend/src/pages/AdminAnalytics.tsx:340-381`、`frontend/src/components/analytics/Visitors.tsx`、`frontend/src/lib/analyticsApi.ts`

## 部署
- 后端:`backend/quick-deploy.ps1`(我跑)。DB 迁移:`cd backend && npx ts-node scripts/db-runner.ts src/db/add-luna-session-summary.sql`(生产库,我跑)。
- 前端:push 自动 Cloudflare Pages。
- 环境:Gemini key 已在后端 env(`GEMINI_API_KEY`)。

## Phase 2(本期不做)
IA 重构:11 tab 按 客户分析 / 运营 / 系统 分组;Luna 列表按访客归并 rollup;导出。
