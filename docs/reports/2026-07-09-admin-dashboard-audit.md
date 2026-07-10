# Admin Dashboard 全面审查报告(2026-07-09)

对 `/admin/analytics` 全部 12 个 tab 的前端组件 + 后端查询做只读审查。三路并行审查,结论高度一致。

## TL;DR — 一个根因,三个症状

**根因:`agents`(审批)、`lt_agents`(经纪身份/comp)、`lt_subscriptions`(付费/镜像 Stripe)、`user_profiles`(role)四张表靠 email 字符串松散拼接,没有单一真相源;所有面向"客户"的分析查询从未排除"注册经纪 / 已付费用户",部分查询连内部测试号都漏排。**

由此产生用户亲眼看到的三个问题:
1. 付费/注册经纪(admin@yesir.ai)被当成潜在买家 lead,躺进客户榜。
2. 审批 / 付费状态割裂,owner「看不到谁真付费了」。
3. "为什么还要授权" —— 其实系统已是"付费即用",admin@yesir.ai 只是**根本没付费**。

## 事实澄清(先纠正认知)

- **付款架构是对的**:Stripe = 钱的唯一真相源(卡/发票/订阅周期);自建 Postgres `lt_subscriptions` 只是 webhook 镜像,供 gating;Supabase 只管登录。行业标准三层。**当前是 Stripe 测试模式,没收过真钱。**
- **admin@yesir.ai 没付费**:`agents.status=pending`(decided_at=null)、`lt_subscriptions` 零记录、`plan_change_log` 零记录。有 stripe_customer_id 只说明他点过订阅按钮进过 checkout 但没完成付款。"待审核"是正确状态。
- **目前没有任何真实付费用户**:有订阅的 3 个都是 lzp6529(测试试用)、shelldubai26 + edenlu1995(手动赠送,stripe_subscription_id=null)。

---

## 问题清单(按主题归类,严重度标注)

### A. 客户数据被「经纪 / 内部号」污染 —— 最严重,贯穿多个 tab
根因:`analyticsQueries.ts` 的 `internalVisitorIds()` 只排除 owner + 硬编码 shelldubai26,**不排除注册经纪**;所有客户查询继承此洞。

| 严重度 | 位置 | 问题 |
|---|---|---|
| 高 | `leadEngine.ts` evaluateVisitor | **真正根因**:建 lead 前不查身份,给注册经纪也建 lead(admin@yesir.ai → lead id29 score87) |
| 高 | `analyticsQueries.ts:213` getLeads | 返回 leads 零过滤(既不排 internal 也不排经纪)→ LeadTable 显示经纪 |
| 高 | `analyticsQueries.ts:61` getOverview | leads_total/leads_new 子查询无排除 → 概览「热 Leads」KPI 含经纪/内部 |
| 高 | `analyticsQueries.ts:261` getVisitors | 排了 internal 但不排经纪 → 付费经纪当「独立访客」进访客明细 + 概览 KPI |
| 高 | `analyticsQueries.ts:498` getLostCustomers | 不排经纪 → 付费经纪被当「流失客户」让 owner 去挽回 |
| 中 | `analyticsQueries.ts:790` getErrorImpact | 排了 internal 不排经纪 → 经纪撞错误被当「待回访客户」 |
| 中 | `analyticsQueries.ts:20` INTERNAL_EMAILS | 漏了 edenlu1995(测试付费 agent,lead id67) |
| 中 | `analyticsQueries.ts:128` getRecentSearches | **连 internal 都没排** → 搜索 tab「最近搜索」feed 显示我们自己的搜索 |
| 中 | `analyticsQueries.ts:109` getTimeseries | **连 internal 都没排** → 搜索量趋势曲线虚高,与已排除的 getTopSearches 口径矛盾 |
| 低 | `analyticsQueries.ts:199` getTutorialFunnel | 无 internal 排除(影响小) |

### B. 审批 / 付费 / 身份 四表割裂 —— 用户困惑的根源
| 严重度 | 位置 | 问题 |
|---|---|---|
| 高 | `agents.ts:34` 付费自动准入 | 只在经纪**本人**访问 GET /me 时触发,且靠 email 明文匹配 lt_agents。付款后若他没再访问,agents.status 永远 pending，owner 后台看到的还是"待审核";email 大小写/别名不一致就漏批 |
| 高 | `agents.ts:59` 审批列表 | `paid` 靠 stripe_subscription_id 区分赠送 vs 付费,但排序只按 pending 置顶,**无独立"付费客户"视图**,真付费用户不突出 → "看不到已付费用户" |
| 中 | `AgentApprovals.tsx:277` 撤销审批 | 撤销只改 agents.status='rejected',不动 lt_subscriptions/comp → 状态割裂,credits.ts 仍按订阅放行,owner 以为关了实际没关 |
| 低 | `agents.ts:91` setAgentPlan | comp 授予 UPDATE+INSERT 非事务,并发双击插两条 active comp |

### C. 评分 / 口径问题
| 严重度 | 位置 | 问题 |
|---|---|---|
| 中 | `analyticsQueries.ts:235` quickScore | `hasContact: !!user_email` → 任何**登录用户**即 +25 且判为"有联系方式"(哪怕从没尝试联系)→ 普遍高估为 warm+,排序失真 |
| 中 | `agentRuns.ts:59` getAgentClientsOverview | 用 `SUM(lead_score)` 当热度 → 随会话数无限累加虚高(200+ 无意义),应取 MAX/最近/衰减 |
| 中 | `collabReport.ts:56` getCollabSessions | 列表无过滤,内部自测 + 空房(event_count=0)全列出,与其它 tab 口径不一致 |
| 低 | `Visitors.tsx:30` vs `analyticsQueries.ts:575` | 短码:前端取 visitor_id 前 8 位,后端取后 6 位 → 同一访客在访客明细 vs Luna 显示两个码,易误判两人 |

### D. 错误监控污染
| 严重度 | 位置 | 问题 |
|---|---|---|
| 高 | `analyticsQueries.ts:681/725/759` getErrorOverview/Groups/RecentErrors | 只剔除 /admin/analytics/ 自噪声,**没排 internalVisitorIds**(而同文件 getErrorImpact 排了)→ 我们自己的 auth_failure/api_error 灌进计数/分组/最近事件,违反项目既定规则 |

### E. 测试模式 / 结算安全
| 严重度 | 位置 | 问题 |
|---|---|---|
| 中 | `revenueShare.ts:148` + `admin-analytics.ts:168` 标记已结算 | 无 livemode 守卫,测试模式也能把某月锁成结算快照写进 revenue_settlements → 切 Live 后测试快照污染对账账本 |
| 低 | `revenueShare.ts:84` livemode 判定 | 取首笔 balance transaction 的 livemode;零交易时恒 null → 测试模式徽章判不出来。应从账户/密钥判定 |

### F. UX 小问题
| 严重度 | 位置 | 问题 |
|---|---|---|
| 低 | `AgentClientsOverview.tsx:10` / `AgentRuns.tsx:27` | days 参数被 `_days` 弃用,顶部 7/30/90 天切换在「经纪客户」「看护」两 tab 静默无效 |

---

## 正向确认(这些是对的,别动)
- **分成对账金额口径正确**:纯从 Stripe `balanceTransactions.list` 拉实收净额(revenueShare.ts:86),不是按套餐价估算;手动赠送(stripe_subscription_id=null)不产生 balance transaction、试用未扣款,**都不会计入营收**。
- **owner gate 完整**:requireOwner(路由)+ isOwnerEmail(前端)+ 服务端 token 校验三重。
- **Luna 匿名归因逻辑对**:session 的 EMAIL_JOIN 用 app_events 兜底救了 sendBeacon 导致的 user_email=NULL。
- ⚠️ 一处提示:requireOwner 在 Supabase 配置时也放行 isAdminEmail → 分成对账(财务)/error-impact(客户 PII)API 层对任意 admin 可达,与前端"仅 owner 可见"文案不符。当前 API 未配 Supabase,走 secret 兜底,暂非活跃泄露。

---

## 修复计划(建议优先级)

### P0 — 客户数据可信度(最该先做,你最不满的)
1. 新增统一「客户身份过滤」:排除 internal + **注册经纪**(在 lt_agents 中 / agents.status=approved / 有订阅 / user_profiles.role≠buyer)。做成一个可复用的 SQL 片段或 visitor_id 集合。
2. 所有客户查询套用:getLeads / getVisitors / getOverview(leads)/ getLostCustomers / getErrorImpact / getRecentSearches / getTimeseries / getError*。
3. **leadEngine 源头**:evaluateVisitor 落库前查身份,经纪直接 return(不再建 lead)。
4. 清理现有脏数据:删掉经纪的 lead 行(admin@yesir.ai、edenlu1995 等)。
5. 补 edenlu1995 进 INTERNAL_EMAILS。

### P1 — 审批 / 付费清晰化(需产品决策)
- **决策点:审批门去留**。系统已是"付费自动准入",审批门只挡未付费者。建议:移除/弱化审批门,改成付费与否都能进经纪台(功能仍被 credits/plan gating),降低转化摩擦 + 消除困惑。
- 付费自动准入改由 billing webhook 可靠触发(不依赖经纪访问 /me),用 auth_user_id 关联而非 email。
- 审批 tab 加独立「付费 / 订阅客户」视图,真付费用户置顶。

### P2 — 评分 / 口径 / 错误监控 / 结算安全
- quickScore hasContact 要求真实 contact_attempt 信号。
- 错误监控三查询加 internal 排除。
- getAgentClientsOverview 热度改 MAX/衰减。
- collab 列表过滤内部 + 空房。
- 结算加 livemode 守卫;测试徽章从密钥判定。

### P3 — UX
- 经纪客户 / 看护 tab 接时间范围或标注"全量"。
- setAgentPlan 包事务。
- 短码前后端统一。

---

*生成:2026-07-09 三路并行只读审查(访客/数据 · Luna/经纪审批 · 分成/运营)。*
