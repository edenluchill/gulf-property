# Profile / 经纪工作台 大改造 Spec

> 建档 2026-07-09。来源:用户在 profile / 经纪台上一次性提出的一批问题。
> 原则(用户要求):**每个任务写清细节,慢慢做**。本文件是唯一真相源,做完一项勾一项。

---

## 背景:关键代码现状(改动前必读)

| 主题 | 现状 | 关键文件 |
|------|------|----------|
| Profile 外壳 | `/profile` 与 `/agent/*` 共用 `ProfileShell`(左侧栏 + 深色「经纪工作台」模块);`AgentLayout` 只剩审批门 | `frontend/src/pages/profile/ProfileShell.tsx`、`frontend/src/luna-tour/pages/AgentLayout.tsx` |
| 经纪台 tab | `AGENT_TABS`:工作台 `/agent` · 客户雷达 `/agent/clients` · AI导览 `/agent/tour` · 秒出提案 `/agent/report`;加 tab 改 `AGENT_TABS` + `App.tsx` 两处 | `ProfileShell.tsx:46-51`、`frontend/src/App.tsx:104-114` |
| 手机底部导航 | `xl:hidden` 固定底栏 `z-50`;tab:探索 / 分析(Sheet:成交+收藏)/ **经纪台** / 管理 / 我的。收藏埋在「分析」Sheet 里 | `frontend/src/components/MobileNav.tsx` |
| 积分/额度 | 单一文件 `credits.ts`;`FEATURES` 目录(reports=20/brochures=40/live_tours=60/luna_tours=100/payplan=5);**只有月度聚合 `lt_usage_counters.credits_used`,无逐笔流水** | `backend/src/luna-tour/credits.ts` |
| Luna Live token | 只在浏览器 localStorage `pinzos_luna_quota` 按迪拜日累计,**服务端完全没记** | `frontend/src/contexts/VoiceAssistantContext.tsx:694-705` |
| Sales Offer 报价单 | 表 `lt_payment_shares`(有 `agent_id`);列表接口 `GET /api/luna/agent/payplans`;**已在秒出提案页底部渲染** | `backend/src/db/lt-payment-shares.sql`、`agent-router.ts:449`、`AgentReport.tsx:136` |
| 项目报告 /r/ | 表 `lt_project_reports`(有 `agent_id`);列表接口 `GET /api/luna/agent/project-reports` **已存在但前端没渲染** | `agent-router.ts:471`、创建于 `ProjectDetailPage.tsx:177` |
| 客户报告 /cr/ | 表 `lt_client_reports`;列表 `GET /api/luna/agent/client-reports`;在秒出提案页 + 客户雷达渲染 | `agent-router.ts:420`、`AgentReport.tsx:29` |
| AI 导览 | 表 `lt_demo_sessions` + `lt_engagement_events`;列表 `GET /api/luna/agent/sessions` | `AgentTours.tsx` |
| Leads | 表 `leads` **无 `agent_id`**,全局,只 owner dashboard 可见;`leadEngine` 不做分配 | `backend/src/db/leads-schema.sql`、`services/leadEngine.ts` |
| 认证勋章 | `drawBadgeCard()` 画 1080×1350 深色渐变卡,名字取自 `user_metadata.full_name`,**不含头像**;付款成功自动弹 `RoleBadgeDialog`(celebrate) | `frontend/src/lib/roleBadge.ts`、`components/RoleBadgeDialog.tsx`、`AgentBilling.tsx:96` |
| Role 选择 | 一页四卡(买家/经纪/经纪公司/开发商),**不收名字/头像**;付费角色跳 `/agent/plans` 付款成功才落身份 | `frontend/src/pages/RoleSelectPage.tsx` |
| 经纪名片(可复用) | `AgentCardEditor` 已有头像上传 `POST /api/luna/agent/avatar`→R2 `agent-photos/{id}.ext`→`lt_agents.photo_url` + 资料保存 `POST /api/luna/agent/profile` | `frontend/src/components/AgentCardEditor.tsx`、`agent-router.ts:502/534` |

---

## 任务清单(按优先级)

### ✅ T1 — 修 Stripe 后退按钮一直转圈(P0,最快最值)

**问题**:点 Stripe 链接跳转后 → 浏览器后退 → 按钮永远 spin。
**根因**:后退命中 **bfcache**,整页 JS 堆(含 React state)被原样恢复,`busy` 仍是旧值;组件不重挂,`useState(null)` 初始值不再执行 → spinner 卡死。**无任何 `pageshow`/bfcache 重置逻辑**。

**中招的 3 个按钮**(同一根因,都经 `billingApi.ts` 的 `window.location.href`):
1. `frontend/src/pages/PricingPage.tsx:94-100`(`subscribe()` → `startCheckout`,spinner `busy===t.id` @434-438)
2. `frontend/src/luna-tour/pages/AgentBilling.tsx:80-84`(`upgrade()` → `startCheckout`,spinner @343-347)
3. `frontend/src/luna-tour/pages/AgentBilling.tsx:85-89`(`manage()` → `openPortal`,spinner @242-247)

`billingApi.ts:121/136` 成功时 `window.location.href = j.url` 后返回 `null`(无 error),所以调用方永不清 `busy`。

**方案**:加一个共享 hook,监听 `pageshow` 且 `e.persisted`(或 `visibilitychange` 回到可见)时重置 loading。
- 新建 `frontend/src/hooks/useResetOnBFCache.ts`:`useEffect` 注册 `window.addEventListener('pageshow', e => { if (e.persisted) reset() })`,组件卸载时移除。
- 在 `PricingPage`、`AgentBilling` 里传入 `() => setBusy(null)`。
- 兜底:也可在这两个组件 mount 时无条件 `setBusy(null)`(bfcache 不重挂,所以 mount 不够,必须靠 pageshow)。
- 验证:本地起前端,点升级→Stripe→浏览器后退→按钮应恢复可点。参考 `frontend/scripts/screenshot.mjs` / playwright。

**风险**:低。纯前端。
**部署**:前端 push 自动 Cloudflare Pages。

---

### T2 — 视觉体系统一「淡一点的深色」(P1)

**问题**(用户原话):到处 style 乱——一时白一时深色,很唐突。想要**淡一点的深色**,不要太突兀。

**现状诊断**:
- 经纪台工作台(`AgentOverview`)hero 卡用纯黑 `bg-slate-900` + 高饱和 emerald 渐变,和站点白底青调不一致。
- ProfileShell 左侧「经纪工作台」模块用 `from-slate-900 via-slate-800` 硬黑。
- 各页卡片有的 `ring-1 ring-slate-900/[0.06]` 有的 `border border-slate-200`,圆角 `rounded-xl`/`rounded-2xl` 混用。
- 勋章、认证卡是深蓝紫渐变;billing 是白底;客户雷达又不同。

**方案**:定一套 token,收敛「深色」为**柔和石板色**(不用纯黑/高饱和):
- 深色面:`bg-slate-800/95`~`slate-700`,或 `#1e2836` 一类带一点青灰的深色;避免 `slate-900` 纯黑。
- 强调色统一走站点青 `teal-500 #14b8a6` / `emerald`,收敛蓝/靛/紫的滥用(角色徽章保留角色色,但工作台 UI 统一青)。
- 卡片统一:白底 `rounded-2xl bg-white ring-1 ring-slate-900/[0.06] shadow-sm`;深色卡统一一个 helper class。
- 圆角:容器 `rounded-2xl`,内元素 `rounded-xl`,chip `rounded-full`。
- 建议抽一个 `frontend/src/luna-tour/ui/`(或复用 `components/ui/`)存共享卡片/区块组件(`Panel`、`StatCard`、`SectionHeader`),各 agent 页替换手写 class。
- 先出 1~2 个 tab 的样板(工作台 + 秒出提案),用户确认色调后再铺开。

**验证**:`frontend/scripts/screenshot.mjs` 出改前/改后对比图,414/1180/1440 + iPhone 三档。

---

### T3 — 手机导航重构:经纪台移进 Profile,中间放收藏(P1)

**问题**(用户):手机版底栏为什么还有「经纪台」?应该在 profile 里。中间可以放 favorite。

**现状**:`MobileNav.tsx` 底栏 = 探索 / 分析(Sheet)/ **经纪台** / 管理 / 我的。收藏埋在「分析」Sheet。

**方案**:
- 底栏改为:探索 `/map` · **收藏 `/favorites`**(中间,`Heart` 图标已 import)· 管理(仅 admin/uploader)· 我的 `/profile`。
- **移除底栏「经纪台」入口**;经纪工作台完全通过「我的」→ ProfileShell 进入(手机端已有汉堡 Sheet 列出经纪工作台各 tab,见 `ProfileShell.tsx:239-261`)。
- 「分析」Sheet 现在只剩成交记录 → 可把成交并进底栏或保留一个精简入口;与用户确认。
- 买家分支(`isBuyer`)本就不显示经纪台,改动后逻辑更简单。
- 注意 grid 列数 `gridCols`(3/4/5)随 item 数变;`z-50` 底栏与 fixed 弹层 z 关系(弹层要 `z-[10000]`)。
- 「我的」tab 进去后,让经纪用户默认能一眼看到工作台入口(ProfileShell 手机端目前是「个人资料」为默认板块 + 菜单里有工作台,OK)。

**验证**:iPhone 12 Pro 尺寸截图,经纪 / 买家 / admin 三种角色各截一张。

---

### T4 — 逐笔积分流水 + 使用记录 tab(P2,数据层新建)

**问题**(用户):没有使用记录——用了 luna tour / live tour / 生成合同(报价单)都看不到,要能看 token/积分消耗记录。

**根因**:`spend()` 只累加月度聚合,**无逐笔流水**,历史不可追溯。

**方案**:
1. **新建流水表** `backend/src/db/credit-ledger.sql`:
   ```sql
   CREATE TABLE IF NOT EXISTS lt_credit_ledger (
     id          BIGSERIAL PRIMARY KEY,
     agent_id    UUID NOT NULL,              -- 计费归属(席位成员记 founder?见下)
     actor_agent_id UUID,                    -- 实际操作人(席位成员时 ≠ agent_id)
     feature     TEXT NOT NULL,              -- reports|brochures|live_tours|luna_tours|payplan
     credits     INTEGER NOT NULL,           -- 实扣(含折扣)
     ref_type    TEXT,                       -- payplan|project_report|client_report|tour|live
     ref_id      TEXT,                        -- share_code / session id,可点回原件
     ref_label   TEXT,                        -- 展示用(项目名/客户名)
     created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
   );
   CREATE INDEX idx_ledger_agent_time ON lt_credit_ledger(agent_id, created_at DESC);
   CREATE INDEX idx_ledger_actor_time ON lt_credit_ledger(actor_agent_id, created_at DESC);
   ```
   决策点(问用户/自定):流水按 **actor(实际操作人)** 展示(每个席位成员看自己的),但扣的是 `agent_id`(founder 池)。两个 id 都存。
2. **在 `spend()` 里写流水**(`credits.ts:134`):把 `spend()` 签名扩展为 `spend(agentId, feature, ref?: {type,id,label})`,UPSERT 聚合的同时 `INSERT` 一行 ledger(owner/无限白名单 `cost=0` 也记一行 `credits:0`,让"无限"用户也能看历史)。
   - 改所有 call site 传 ref:`agent-router.ts:164/367/410/777`、`collab.ts:238`、`langgraph-progress.ts:113`、`r2-upload.ts:182`、`public-router.ts:557`。
3. **列表接口** `GET /api/luna/agent/ledger?feature=&limit=`:按 actor 分页返回,含 `ref_type/ref_id/ref_label` 好回链。
4. **前端「使用记录」tab**:新 `AGENT_TABS` 一项(或并入 T5 的「记录」聚合页)。展示时间线:图标 + 功能名 + 消耗 + 关联对象(可点开 /pp /cr /r)+ 时间;顶部本月 used/limit 能量条(复用 `/usage`)。
   - **历史不可回填**——明确告知用户:只从上线时刻起记录。上线前的消耗无法补。

**注意**:payplan 现在 `cost 0`(?)需核对;`public-router.ts:557` 传 payplan。若真 0 分则流水记 0。

---

### T5 — 经纪台「记录/历史」聚合 + 补齐项目报告列表(P2)

**问题**(用户):Sales Offer 生成、项目报告等没地方看;每个的历史最好都有 tab。

**现状**:Sales Offer 列表在秒出提案页底部(用户没找到=可发现性差);项目报告列表接口 `agent-router.ts:471` **已存在但无 UI**;AI 导览有独立页。

**方案**(两种,选一,建议 A):
- **A. 新增「记录」tab(`/agent/history`)**,内部再分子 tab:使用记录(T4)/ 报价单 / 项目报告 / 客户报告 / AI 导览。把散落各处的列表收进来,`AgentReport` 只留生成器。
  - 项目报告子 tab 直接调已有 `GET /api/luna/agent/project-reports`(零后端改动)。
- **B.** 每类各自成 tab(tab 会很多,手机不友好)。

**统一列表行组件**:名称 + 类型 chip + 关键数(价格/浏览)+ 日期 + 复制链接 + 打开;过期灰标。风格随 T2。

---

### T6 — Luna Live token 服务端落库(P2,可选,较难)

**问题**:用户想看 token 消耗。Luna Live 的 token 目前只在浏览器 localStorage。

**方案**:前端在会话结束/pagehide 时把 `usageMetadata` delta 上报后端(`POST /api/voice/usage` 新端点),落 `luna_sessions` 新增 `token_count` 列或独立 `lt_token_usage` 表,按 agent 聚合。
- 依赖 `voice-session-boundary` 的会话模型(一通电话=一条记录),在 endSession 时上报总量。
- 优先级低于 T4(积分才是计费口径;token 是给用户看"用了多少 AI")。可先只在使用记录里显示"Luna 对话 N 分钟"由 session 时长推,不做精确 token。**与用户确认要不要精确 token。**

---

### T7 — Lead 分发到经纪 + 经纪 leads 页(P3,较大)

**问题**(用户):没有把 lead 推送给这个经纪的页面。
**现状**:`leads` 表无 `agent_id`;套餐却在卖「Lead 推送/优先/独占」;`lt_clients` CRM 是手工客户,和自动 `leads` 是两套。

**方案**(需先定分发规则——这是产品决策):
1. **加分配** `leads.assigned_agent_id`(+ `assigned_at`)。
2. **分发规则**(问用户):按套餐优先级轮询?按区域?先到先得?founder 独占?——`docs/` 里 map-metering spec 提过「lead分发规则未做」。**这一步必须先和用户敲定规则再写代码。**
3. **leadEngine** 建 lead 后触发分配(fire-and-forget)。
4. **经纪端页面** `/agent/leads`:展示分给我的 lead(联系方式 + 推断意向 + 行为时间线),可"接受/转客户(建 `lt_clients`)/忽略"。
5. 与客户雷达(`lt_clients`)的关系:lead 接受后落成 client。

**先决**:leads 表常年 0 行的历史根因见 `[[lead-capture-gap]]` / `[[behavior-to-lead-engine]]`(已闭合,现在会自动建 lead)。先确认生产有没有 lead 数据再做页面,否则做了也是空的。

---

### T8 — 勋章改「毕业证书/奖状」样式 + 头像(P4)

**问题**(用户原话):每次付完钱发朋友圈的太拉跨了,谁有欲望分享?能做成**奖状 / 大学毕业证书**那种吗?

**现状**:`drawBadgeCard()` 深色渐变竖卡,居中大 emoji + 称号 + 名字 + 日期,无头像。

**方案**:重画 `drawBadgeCard`(或新 `drawCertificate`)成横/竖版**证书**:
- 浅色/米色底(奖状质感)或深色+烫金边框二选一,和证书感匹配;金色 `#C9A227` 描边 + 内边框双线。
- 顶部:Pinzos logo + "OFFICIAL CERTIFICATION" / 「官方认证」花体标题。
- 中部:「兹认证」+ **持有人真实姓名(大号衬线)** + 角色称号(认证经纪人/经纪公司/开发商)。
- **加头像**:圆形头像嵌在证书上方(从 `lt_agents.photo_url` 拉;canvas 画外部图需 `crossOrigin='anonymous'` + R2 CORS 允许,注意 `toDataURL` 跨域污染——R2 已配 CORS)。
- 底部:认证编号(如 `PZ-2026-000123`)+ 认证日期 + 印章/徽记 + pinzos.com + 二维码(可选,指向该经纪 /r 或名片)。
- 保留一键保存 PNG;尺寸兼容朋友圈(竖 1080×1350)与 WhatsApp Status。
- 参考已有印刷级审美:`ProjectReportPage`(/r/:code)的青调白底 + `@media print` 印章质感。

**数据接线**:证书名字改从 `lt_agents.display_name`(经纪填的真名)读,不再用 Google metadata;头像从 `lt_agents.photo_url`。需 `RoleBadgeDialog` 先 `GET /api/luna/agent/profile` 拿 name+photo。

---

### T9 — Role 选择收集姓名 + 可选头像 → 颁发证书(P4)

**问题**(用户):经纪选经纪/公司/开发商后,应要填名字 + 可选上传头像,让我们颁发一个证书作为分享,是我们认证的。

**现状**:`RoleSelectPage` 选付费角色直接跳 plans 付款,不收任何信息。

**方案**:
- 在选中付费角色(agent/agency/developer)后,**先弹一步**「完善认证信息」:姓名(必填,预填 `display_name` 或 Google name)+ 头像(可选,复用 `POST /api/luna/agent/avatar` 的上传逻辑)。
- 保存进 `lt_agents.display_name` / `photo_url`(用已有 `POST /api/luna/agent/profile`)。
- 再进入付款流程;**付款成功后**颁发 T8 的证书(celebrate 弹窗),名字/头像即用户刚填的。
  - 注意现有约束:付费角色付款成功才落 role(webhook + 回跳)。收集姓名/头像可以在付款前做(写 `lt_agents` 无害),身份 role 仍付款后落。
- 非付费买家不走此流程。
- 边界:`ensureAgent()` 会用 Google name 初始化 `display_name`;这里让用户覆盖成正式名。

**顺序**:T8(证书生成器)先做,T9(收集入口)再接。

---

## 建议执行顺序

1. **T1**(Stripe spin bug)—— 独立、最快、真实客户会撞。先做。
2. **T2 + T3**(视觉统一 + 手机导航)—— 一起做,用户体感最强,先出样板给用户确认色调。
3. **T4 + T5**(流水表 + 记录 tab)—— 数据层 + UI,一次做透"使用记录"。
4. **T8 + T9**(证书 + 收集)—— 品牌向,一组。
5. **T7**(lead 分发)—— 需先敲产品规则,最大,放后。
6. **T6**(token 落库)—— 可选,最后或砍。

每做完一项:type-check → 截图/自测 → 后端跑 `backend/quick-deploy.ps1`(deploy 是我的活)→ 更新本文件勾选 + 记 memory。

---

## 已定决策(2026-07-09 用户拍板)

- **执行顺序**:先做 **T2+T3**(视觉统一 + 手机导航)。其余按 spec 顺序。
- **T2 深色调**:**柔和石板深(带青灰)**,约 `#1e2a35` 一类,不用纯黑 slate-900,和白底青调过渡自然。
- **T8 证书质感**:**浅色烫金奖状**——米白/象牙底 + 金色双描边 + 花体标题 + 圆形头像 + 认证编号 + 印章,像大学毕业证书/获奖证书。**先出真实生成图给用户看**再决定要不要深色版。

## 仍待拍板

- **T3**:「分析」Sheet 里的成交记录去留 / 放哪(做 T3 时一并问)。
- **T4**:流水按 actor(每个席位成员看自己)还是按 billing agent(整个 founder 池)展示。
- **T6**:要不要精确 token,还是用会话时长近似即可。
- **T7**:lead 分发规则(轮询 / 区域 / 套餐优先 / founder 独占)——**没这个没法写**。

## 进度日志

### ✅ T1(2026-07-09):新建 `frontend/src/hooks/useResetOnBFCache.ts`(pageshow+persisted 重置),接进 `AgentBilling`(升级+门户)与 `PricingPage`(订阅)。type-check 通过。待随前端批次 push 自动部署 + 真机点一次确认。

### ✅ T2(2026-07-09 完成,已上生产 commit 0a25c3c):
- tailwind 新增 `ink` 色板(`#1e2a35` 一类「柔和石板深带青灰」),见 `frontend/tailwind.config.js`。
- 新建共享基元 `frontend/src/luna-tour/ui/Panel.tsx`:`Panel`/`InkPanel`/`SectionHeader`/`StatCard`。
- `AgentOverview`(工作台)hero 从纯黑改 ink-800 + 青调;`ProfileShell` 左侧「经纪工作台」深色模块改 `ink-800`。
- `AgentClients`/`AgentTours`/`AgentReport` 主卡片统一 `ring-2xl`;纯黑控件(filter pill/按钮)改 ink。
- 桌面 `Header` 顶部「经纪台」高亮胶囊 `accentGrad` 从橙(amber/orange)改青(teal→cyan)。
- **注**:Founder/Agency 档卡的金色 `#E8C37E` 是套餐品牌色,刻意保留。

### ✅ T3(2026-07-09,已上生产 commit 0a25c3c):`MobileNav` 重写。底栏 = 探索 / **收藏** / 成交记录 / [管理(admin/uploader)] / 我的。移除底栏「经纪台」(工作台改从「我的」进);拆掉「分析」Sheet,收藏+成交提为一级 tab。
  - 决策(默认已定):成交记录保留为一级 tab(不再埋 Sheet)。如不想要可再砍。

### ✅ T4+T5(2026-07-10):逐笔积分流水 + 使用记录 tab + 补齐项目报告列表。
- **DB**:新建 `backend/src/db/credit-ledger.sql` → `lt_credit_ledger`(agent_id 计费归属 / actor_agent_id 操作人 / feature / credits / ref_type/ref_id/ref_label / created_at)。已在生产库建表。
- **credits.ts**:`spend(actor, feature, ref?)` 每次记一行流水(含 owner/无限的 0);签名向后兼容。
- **call sites 全带 ref**:project_report/client_report/tour/payplan/live/brochure(agent-router/public-router/collab/r2-upload/langgraph-progress)。
- **端点** `GET /api/luna/agent/ledger?feature=&limit=`:**席位成员只看自己(actor_agent_id=我);团队 owner(billing_agent_id IS NULL)看整个池(agent_id=我,带操作人名)**——用户定的规则。
- **前端**:新 `AgentUsage.tsx`(`/agent/usage`,**双语**),能量条 + 流水时间线 + feature 筛选 + owner 见操作人列 + 可点回 /r /cr /pp /tour。
- **tab**:ProfileShell `USAGE_TAB` **只在付费(active/trialing)后显示**(用户要求);路由常在。
- **T5**:AgentReport 补上「我的项目报告」列表(用已存在的 `/project-reports` 端点,零后端)。
- **注意**:历史不可回填,只从上线起记录。

---

### 🆕 T10 — 经纪台/profile 页面 i18n(硬编码中文,切 EN 仍中文)(用户 2026-07-10 报)
- **现象**:Header/侧栏是 i18n(英文正常),但 `AgentBilling`/`AgentOverview`/`AgentReport`/`AgentClients`/`AgentTours` 页面**正文全是硬编码中文**,切 EN 不变。截图见订阅页。
- **方案**:这些页当初只写中文。逐页把正文抽成 `L(zh,en)` 双语(参照 ProfileShell/AgentUsage 的 `L()` 模式,或走 i18n key)。工作量中等(AgentBilling 文案最多:套餐名/功能行/积分消耗表)。
- **新页已双语**:`AgentUsage` 从一开始就是双语,不欠新债。
- 优先级:P1(用户已撞到)。建议下一批做。
