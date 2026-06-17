# 客户行为分析 + Lead 引擎 — 设计 Spec

> 创建日期:2026-06-17(2026-06-17 更新方向)
> 目标:① 记录客户在主应用的行为(搜索、Luna 对话、tutorial、浏览);② **把匿名行为变成能联系、能跟进的 lead**;③ 提供一个**只有所有者 email 能访问**的 dashboard。

> **方向决策(2026-06-17):**
> - Dashboard **自己写**(复用现有 `telemetry.ts` 模式,数据与 UI 全在自己掌控)。
> - **采集 + lead 引擎一起做** —— 采集是 lead 评分的基础,本来就连着。
> - **不存每条完整 Luna 逐句对话**:普通访客存摘要 + 意图,只对热 lead 留完整 transcript(隐私 + 存储 + 回报权衡)。
> - 核心认知:**"看 dashboard" 是回头看(低杠杆);真正生产 lead 的是「抓联系方式 + 意图评分 + 热 lead 实时提醒你跟进」(高杠杆)。** 见 §6。

---

## 1. 背景:现状

调查结论(详见对话):

| 行为 | 现状 |
|------|------|
| 主应用搜索 | ❌ 不记录,搜索 API 无状态,只有 `residential_projects.views_count` 总计数 |
| Luna 语音对话 | ⚠️ 有完整日志(`voice-debug.ts` 构建 messages/toolCalls/metrics),但**只在 dev 写 JSON 文件,生产禁用**,不关联用户 |
| Luna Tour 分享链接 | ✅ 完整事件追踪(`lt_engagement_events` 表 + `sendBeacon`),但仅覆盖经纪人分享 demo,非主 app |
| 主应用 tutorial / 浏览 | ❌ 前端无埋点 |

**地基齐全:** Supabase JWT 认证(`req.user.email`)、现成事件表结构(`lt_engagement_events`)、现成前端埋点范式(`frontend/src/luna-tour/telemetry.ts` 的 `sendBeacon`)、`requireAuth`/`requireAdmin` 中间件(`backend/src/middleware/auth.ts`)。

**本方案 = 把已有模式铺到主应用 + 持久化 Luna 对话 + 加 email 白名单 dashboard。不是从零造。**

---

## 2. 数据模型

### 2.1 `app_events` — 统一事件流

参照 `lt_engagement_events` 结构(`backend/src/db/luna-tour-schema.sql:210`)。

```sql
CREATE TABLE IF NOT EXISTS app_events (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  event_type   TEXT NOT NULL,            -- search | search_result_click | property_view
                                         -- | luna_open | luna_close | tutorial_step | page_view
  visitor_id   TEXT NOT NULL,            -- localStorage 匿名 UUID,永远有
  user_email   TEXT,                     -- 登录用户(可空)
  user_id      TEXT,                     -- Supabase user.id(可空)
  session_id   TEXT,                     -- 每次页面加载 / voice session
  project_id   UUID,                     -- 涉及具体项目时
  payload      JSONB DEFAULT '{}'::jsonb,-- 搜索词、筛选、tutorial step、dwell_ms 等
  path         TEXT,                     -- 页面 URL
  ua           TEXT,
  ip_hash      TEXT                       -- SHA256(ip),不存明文 IP
);

CREATE INDEX IF NOT EXISTS idx_app_events_created  ON app_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_events_type     ON app_events (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_events_email    ON app_events (user_email);
CREATE INDEX IF NOT EXISTS idx_app_events_visitor  ON app_events (visitor_id);
CREATE INDEX IF NOT EXISTS idx_app_events_payload  ON app_events USING gin (payload);
```

**payload 约定(各 event_type):**

| event_type | payload 字段 |
|-----------|-------------|
| `search` | `{ query, area, min_price, max_price, bedrooms, developer, status, result_count }` |
| `search_result_click` | `{ query, project_id, position }` |
| `property_view` | `{ project_id, source }` |
| `luna_open` / `luna_close` | `{ session_id, trigger }` |
| `tutorial_step` | `{ step, step_name, completed }` |
| `page_view` | `{ referrer }` |

### 2.2 `luna_sessions` — Luna 对话完整存档

复用 `voice-debug.ts` 已构建的 session 对象(行 163-196),整包存 jsonb + 抽几个可查询标量列。

```sql
CREATE TABLE IF NOT EXISTS luna_sessions (
  id               BIGSERIAL PRIMARY KEY,
  session_id       TEXT UNIQUE NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  visitor_id       TEXT,
  user_email       TEXT,
  user_id          TEXT,
  started_at       TIMESTAMPTZ,
  ended_at         TIMESTAMPTZ,
  duration_ms      INTEGER,
  turn_count       INTEGER,         -- messages 数
  tool_call_count  INTEGER,
  had_error        BOOLEAN DEFAULT false,
  -- 完整存档:messages(逐句)、toolCalls、events、metrics
  transcript       JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_luna_sessions_created ON luna_sessions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_luna_sessions_email   ON luna_sessions (user_email);
```

> **隐私:** `transcript` 含客户逐句对话。访问锁死所有者 email。建议加保留期(见 §6)。

---

## 3. 访问控制 — 只有所有者 email 能看

新增中间件 `backend/src/middleware/requireOwner.ts`:

```ts
const OWNER_EMAILS = (process.env.OWNER_EMAILS || 'lzp6529@gmail.com')
  .split(',').map(s => s.trim().toLowerCase())

// requireAuth 之后链式使用
export function requireOwner(req, res, next) {
  const email = req.user?.email?.toLowerCase()
  if (!email || !OWNER_EMAILS.includes(email)) {
    return res.status(403).json({ error: 'forbidden' })
  }
  next()
}
```

- 所有 `/api/admin/analytics/*` 走 `requireAuth, requireOwner`。
- 前端 `/admin/analytics` 入口也只对白名单 email 显示 —— 但**安全以服务端为准**,前端隐藏只是体验。
- email 放环境变量 `OWNER_EMAILS`,以后加人不用改代码。

---

## 4. 后端接口

### 4.1 埋点采集(公开,optionalAuth)

```
POST /api/events
  body: { events: [ { event_type, visitor_id, session_id, project_id?, payload?, path? } ] }
  - optionalAuth:若有 token,补 user_email / user_id
  - 服务端补 ip_hash(SHA256)、ua、created_at
  - 批量插入 app_events,立即返回 204
```

支持批量(前端可攒几条一起发)。参照 `luna-tour/public-router.ts:58` 的即时 204 + 异步落库模式。

### 4.2 Luna 对话持久化

```
POST /api/events/voice-session
  body: <voice-debug.ts 构建的完整 session 对象>
  - 会话结束时前端 POST(sendBeacon / keepalive fetch)
  - 抽 duration/turn_count/tool_call_count,整包存 luna_sessions.transcript
  - 同时写一条 app_events(luna_close)
```

> 备选:也可在后端 `voice-chat.ts` 会话生命周期(行 76 断开清理处)直接落库,省一次前端请求。优先前端 POST,因为完整 transcript 在前端 SDK 侧最全。

### 4.3 Dashboard 查询(requireAuth + requireOwner)

```
GET /api/admin/analytics/overview?from&to      → 访客数、新老、事件总量、Luna 会话数
GET /api/admin/analytics/searches?from&to      → 搜索热词 top N、筛选条件分布、零结果搜索
GET /api/admin/analytics/luna?from&to          → 会话数/时长分布/轮次/tool 调用 top
GET /api/admin/analytics/tutorial?from&to      → 各 step 到达数(漏斗)
GET /api/admin/analytics/sessions?limit&offset → Luna 会话列表
GET /api/admin/analytics/sessions/:id          → 单次对话完整回看
```

---

## 5. 前端

### 5.1 埋点 helper(优雅设计:攒批,不是每次都打请求)

> **核心原则:不要每个客户动作都立刻发一次网络请求。** 前端在内存里攒一个队列,满足条件才批量 flush 一次。对服务器友好、对客户无感、也更省。

新建 `frontend/src/lib/track.ts`,抄 `luna-tour/telemetry.ts` 但加客户端缓冲:
- `visitor_id`:localStorage key `app-visitor-id`,无则生成 UUID
- `session_id`:sessionStorage,每次页面加载一个
- `trackEvent(type, payload)`:**只 push 进内存队列,不立即发送**(同步、零延迟、不阻塞 UI)
- **flush 触发条件**(满足任一即批量 POST `/api/events`):
  1. 队列攒满 N 条(如 10 条)
  2. 距上次 flush 超过 T 秒(如 10s,`setTimeout` 节流)
  3. 页面 `visibilitychange → hidden` / `pagehide`(用户要离开)→ 用 `navigator.sendBeacon` 一次性带走,保证不丢
- 失败回退 `fetch(keepalive)`;全程 fire-and-forget
- **例外:高价值事件可立即 flush** —— 抓到联系方式 / 触发热 lead 这类(§6)不能等,单独走即时通道,避免攒批期间客户已离开导致 lead 丢失。

> 即:**普通行为攒批,关键转化即时。** 后端 `POST /api/events` 本就设计成接收 `events[]` 数组(§4.1),天然支持批量。

### 5.2 埋点位置

| 事件 | 位置 |
|------|------|
| `search` | 搜索提交处(`FilterPanel.tsx` / MapPage 搜索回调),带 result_count |
| `search_result_click` | 搜索结果点击进项目 |
| `property_view` | 项目详情打开 |
| `luna_open` / `luna_close` | Luna pill 按钮启动/关闭 |
| `voice-session` POST | Luna 会话结束(复用现有 debug session 对象) |
| `tutorial_step` | tutorial / luna-tour 各步骤切换 |
| `page_view` | 路由变化(React Router 监听) |

### 5.3 Dashboard 页面

`frontend/src/pages/AdminAnalytics.tsx`,路由 `/admin/analytics`:
- 路由守卫:登录用户 email ∈ 白名单才渲染,否则跳走(服务端再校验一次)
- 卡片:今日/7日/30日 访客、Luna 会话、搜索量
- 图表:每日访客趋势、搜索热词词云/榜、tutorial 漏斗、Luna 用量
- 表格:最近 Luna 会话列表 → 点开看完整对话回看(逐句 + tool calls)

---

## 6. Lead 引擎(核心 —— 真正生产 lead 的部分)

> 这是原方案缺的、也是最值钱的部分。行为采集(§2)是它的燃料。

### 6.1 思路
匿名 `visitor_id` 对成交毫无用处。Lead 引擎做三件事,把"行为"变成"能联系、值得跟进的人":
1. **抓联系方式**(visitor → 可联系的 lead)
2. **意图评分**(哪些 lead 是热的)
3. **热 lead 实时提醒你**(出现即推送,而不是等你打开 dashboard)

复用现成资产:Luna Tour 的 `lt_clients` + `lt_session_lead_scores`(`luna-tour-schema.sql:239`)已经是这个模式,这里把它铺到主 app。

### 6.2 `leads` 表

```sql
CREATE TABLE IF NOT EXISTS leads (
  id            BIGSERIAL PRIMARY KEY,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  visitor_id    TEXT UNIQUE,              -- 关联 app_events,可回填该访客全部历史行为
  name          TEXT,
  email         TEXT,
  phone         TEXT,
  whatsapp      TEXT,
  source        TEXT,                     -- luna | search_form | tutorial_cta
  intent        JSONB DEFAULT '{}'::jsonb,-- 推断:{ budget, areas[], bedrooms, project_ids[], asked_roi }
  lead_score    INTEGER DEFAULT 0,
  status        TEXT DEFAULT 'new',       -- new | contacted | qualified | lost
  alerted_at    TIMESTAMPTZ,              -- 已提醒所有者的时间(防重复提醒)
  last_seen_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_leads_score   ON leads (lead_score DESC);
CREATE INDEX IF NOT EXISTS idx_leads_visitor ON leads (visitor_id);
```

> 备选:直接复用 `lt_clients`。但 `lt_clients` 绑经纪人(agent_id),主 app 无经纪人概念,新建 `leads` 更干净。

### 6.3 抓联系方式
- **Luna 内自然索取**:给 Luna 加一个 tool `capture_contact`(写 `leads`),系统提示里引导"在客户表达兴趣后,自然地问要不要把详细资料发到 WhatsApp"。**价值最高的一步。**
- **表单兜底**:CTA(如"获取完整楼盘资料")弹轻量表单 → `POST /api/leads/contact`。
- 抓到后:`leads.visitor_id` 关联,该访客之前的全部 `app_events` 立刻可归因。

### 6.4 意图评分
对一个 visitor 的 `app_events` 算分(参照 `lt_session_lead_scores` 物化视图,低量可改为读时计算的 SQL 函数):

| 信号 | 加分 |
|------|------|
| 高价搜索(如 >2M AED) | + |
| 打开 Luna | + |
| 问 ROI / 按揭 / 回报 | ++ |
| 多次 property_view | + |
| tutorial 完成 | + |
| 留了联系方式 | +++ |

输出 `lead_score`,写回 `leads`。

### 6.5 热 lead 呈现(决策 2026-06-17:先只在 dashboard 显示,不发邮件)
- **当前**:不做主动推送。热 lead 在 dashboard 的 lead 列表按 `lead_score` 倒序置顶呈现即可。
- 保留 `alerted_at` 字段为将来用;`leads.lead_score` 照常计算。
- **以后再说**:要主动提醒时,加一个可插拔的 `leadAlert` 服务(邮件 Resend/SMTP,或 WhatsApp/Twilio),由 score 越阈值触发。现在不写。

### 6.6 与 Luna 存档的关系
- 普通访客:`luna_sessions` 只存**摘要 + 抽取的意图**(时长/轮次/tool/推断预算区域),不存逐句。
- **热 lead**(有联系方式或高分):保留 `transcript` 完整逐句,方便你跟进前回看客户到底问了啥。

---

## 7. 隐私与保留期(待所有者拍板)

- Luna `transcript` 含客户逐句对话 → dashboard 入口锁死 email(§3)。
- 建议保留期:`app_events` 留 180 天、`luna_sessions` 留 90 天,定时任务清旧数据。表已留 `created_at`。
- **决策点:要不要加自动清理?** 默认建议加。

---

## 8. 分期落地(采集 + lead 连着做)

### Phase 1 — 采集地基(数据开始进库)
1. 建表 `app_events`(`backend/src/db/analytics-schema.sql`)
2. `requireOwner` 中间件
3. `POST /api/events` 接口(optionalAuth + ip_hash + **批量** events[] 插入)
4. 前端 `track.ts` helper —— **带缓冲攒批 + pagehide flush**(§5.1)
5. 埋点:search / search_result_click / property_view / tutorial_step / page_view
6. 验证:跑几次搜索,`db-query` 确认 app_events 有数据、且是批量进来的

### Phase 2 — Lead 引擎(把行为变成可联系的 lead)
1. 建表 `leads`(`backend/src/db/leads-schema.sql`)
2. 抓联系方式:`POST /api/leads/contact` + Luna `capture_contact` tool + CTA 表单兜底(**即时通道,不攒批**)
3. 意图评分:SQL 函数/视图算 `lead_score` 写回 `leads`
4. (不发邮件)热 lead 留给 dashboard 按分置顶呈现;`alerted_at` 字段预留
5. 验证:留个假联系方式 → 确认 lead 入库、评分、可在 lead 列表看到

### Phase 3 — Luna 对话存档
1. 建表 `luna_sessions`(普通访客存摘要+意图;热 lead 存完整 transcript)
2. `POST /api/events/voice-session` 持久化
3. 前端会话结束 POST + `luna_open`/`luna_close` 埋点
4. 对话回看接口

### Phase 4 — Dashboard UI(自己写)
1. `/api/admin/analytics/*` 查询接口
2. `AdminAnalytics.tsx` 页面 + 路由守卫(email 白名单)
3. 图表(访客趋势 / 搜索热词 / tutorial 漏斗 / Luna 用量)+ **lead 列表(按分排序)** + 对话回看
4. (可选)保留期清理定时任务(§7)

---

## 9. 涉及文件清单

**新增:**
- `backend/src/db/analytics-schema.sql`(app_events)
- `backend/src/db/leads-schema.sql`(leads)
- `backend/src/middleware/requireOwner.ts`
- `backend/src/routes/events.ts`(采集,批量 events[])
- `backend/src/routes/leads.ts`(抓联系方式 + 评分 + 提醒)
- `backend/src/routes/admin-analytics.ts`(dashboard 查询,薄路由)
- `frontend/src/lib/track.ts`(带缓冲攒批)
- `frontend/src/pages/AdminAnalytics.tsx`(页面,只组装)
- `frontend/src/components/analytics/*`(可复用图表/卡片/表格组件)
- ~~`backend/src/lib/leadAlert.ts`~~(以后做主动提醒时再加,现在不写)

**改动:**
- `backend/src/index.ts`(挂载新路由)
- Luna 系统提示 + tools(加 `capture_contact`)
- 搜索 / 项目 / Luna / tutorial 相关前端组件(加 `trackEvent`)
- `backend/.env` + 部署环境:`OWNER_EMAILS`(+ 邮件渠道密钥)

**复用参考:**
- `backend/src/db/luna-tour-schema.sql:210`(事件表范式)
- `frontend/src/luna-tour/telemetry.ts`(sendBeacon 埋点)
- `backend/src/routes/voice-debug.ts:163`(session 对象结构)
- `backend/src/middleware/auth.ts`(requireAuth)
- `backend/src/luna-tour/public-router.ts:58`(即时 204 + 异步落库)

---

## 10. 部署注意
- 建表用 `cd backend && npx ts-node scripts/db-runner.ts src/db/analytics-schema.sql`(直写生产库,见 CLAUDE.md)
- 后端改动需 `cd backend; .\quick-deploy.ps1` 部署
- 前端 push 后 Cloudflare Pages 自动 deploy
- 新增 `OWNER_EMAILS` 环境变量需配到生产服务器

---

## 11. 存储选型:JSON vs 关系型(分析,2026-06-17)

**问题:这些数据存 JSON 是不是更好?**

把"存 JSON"拆成两种,结局完全不同:

| 方案 | 结论 | 原因 |
|------|------|------|
| ① JSON **文件**(像现有 `voice-debug-logs/*.json`) | ❌ 不行 | Docker 容器文件系统临时,redeploy 即丢(这正是 voice-debug 生产被禁的原因);无法聚合查询(算热词要读全部文件);无索引、无法 join |
| ② Postgres **JSONB 列** | ✅ 采用 | 持久;GIN 可索引;SQL 直接聚合;能 join 项目/lead;schema 灵活 |
| ③ 纯关系型(每字段一列) | ❌ 太僵 | 事件形状各异,拍平成几十个空列;每加字段都要 migration |

**最终:混合模式 = 几个固定真列 + 一个 `payload` JSONB。**
- **总会查/排序/索引的 → 真列**:`event_type`、`user_email`、`visitor_id`、`created_at`、`project_id`、`lead_score`、`status`。
- **每事件形状不同的可变部分 → JSONB**:搜索条件、tutorial step、推断意图。

这正是 spec 里 `app_events` / `leads` 已采用的设计,也是 **PostHog / Segment / Snowplow 底层的标准事件建模**(定型列 + properties JSON blob)。

**按数据形状各归各位:**

| 数据 | 存法 |
|------|------|
| 行为事件 | 真列 + `payload` JSONB |
| `leads` | 真列(name/email/score/status)+ `intent` JSONB |
| Luna 完整对话 transcript | 整段一个 JSONB(嵌套、几乎只整段回看,完美 JSON 场景) |

---

## 12. 代码结构(clean / 分离 / 可复用 —— 决策 2026-06-17)

原则:**薄路由 + 独立 service 层 + 可复用前端组件**,各司其职好测试好改。

**后端分层:**
```
routes/        薄 —— 只解析请求、调 service、返回响应
  events.ts            POST /api/events(批量落库)
  leads.ts             抓联系方式 + 触发评分
  admin-analytics.ts   dashboard 查询(过 requireOwner)
services/      业务逻辑,不碰 req/res,可单测、可被多处复用
  eventIngest.ts       校验 + ip_hash + 批量插入
  leadScoring.ts       由 app_events 算 lead_score
  analyticsQueries.ts  各 dashboard 指标的纯查询函数
middleware/
  requireOwner.ts      email 白名单(复用 requireAuth)
```

**前端分离:**
```
lib/track.ts                 采集 helper(攒批),全站复用
pages/AdminAnalytics.tsx     只负责取数 + 组装布局,不写图表细节
components/analytics/
  StatCard.tsx               可复用指标卡
  TrendChart.tsx             可复用趋势图
  TopList.tsx                可复用排行榜(热词/热门项目/热 lead 通用)
  Funnel.tsx                 tutorial 漏斗
  LeadTable.tsx / SessionViewer.tsx
```
图表组件只吃 props、不掺业务,搜索热词/热门项目/热 lead 都复用同一个 `TopList`。
