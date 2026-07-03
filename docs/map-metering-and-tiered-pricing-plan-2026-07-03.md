# 地图计量 + 三档经纪定价 + 买家免费体系 — 设计方案

日期:2026-07-03
状态:设计稿(待拍板后实施)
关联:`docs/stripe-billing-spec.md`、`backend/src/luna-tour/credits.ts`、`backend/src/routes/billing.ts`

---

## 0. 一句话

把地图从"免费公共品"变成**获客漏斗的顶部**:匿名限时 → 登录免费(买家,喂 lead 引擎)→ 经纪三档付费($25/$99/$699),lead 是买家数据的变现出口,形成飞轮。

```
匿名访客 ──10min/天──▶ 登录 ──选角色──▶ 买家(免费,行为被采集)
                                    └──▶ 经纪 ──▶ Starter $25 / Pro $99 / Founder $699
                                               ▲
                         买家行为 → leadEngine → lead 分发(付费经纪的核心价值)
```

**飞轮**:匿名门槛↑注册 → 买家池↑ → lead 质量/数量↑ → 经纪付费意愿↑ → 经纪用分享报告/导览拉来更多买家。

---

## 1. 匿名用户:地图每天 10 分钟

### 1.1 计量机制(防刷新、防清缓存)

**核心思路:服务端"活跃分钟桶"去重计数,不信任客户端计时器。**

新表:

```sql
CREATE TABLE anon_map_usage (
  identity_key text NOT NULL,          -- 'v:{visitor_id}' 或 'ip:{sha256(ip)}'
  day date NOT NULL,
  minute_bucket smallint NOT NULL,     -- 当天第 N 分钟 (0-1439)
  PRIMARY KEY (identity_key, day, minute_bucket)
);
```

两条写入路径,天然去重(同一分钟只算一次):

1. **心跳**(主路径):前端 MapPage 常驻 hook,仅当 `document.visibilityState === 'visible'` 且当前在地图路由时,每 30s `POST /api/usage/map-heartbeat`。服务端对 visitor_id 和 IP hash **各插一行**当前 minute_bucket,返回 `{ remainingMinutes }`。
2. **数据请求兜底**(防屏蔽心跳):在匿名请求打到核心地图数据端点(`/dubai/areas`、`area-insights`、`/projects` 地图态)时,同样 upsert 当前 minute_bucket。屏蔽心跳的人只要真的在用地图就仍会被计到。

**判定额度**:`used = max(count(visitor 桶), count(ip 桶))`,`remaining = 10 - used`。

- 刷新页面:visitor_id 在 localStorage,不变 → 计数继续。✅
- 清 localStorage/无痕:visitor_id 变了,但 **IP 桶**还在 → 仍被拦。✅
- 办公室共享 IP 误伤:IP 侧给 3 倍宽容(IP 桶 > 30 分钟才单独触发),正常 NAT 场景几乎不会误杀;真被误杀的引导语也是"登录免费继续",代价极低。
- 登录用户:完全豁免,中间件先查 `req.ctx.userId` 直接放行。
- **豁免路由**:`/r/:code`(经纪品牌报告)、`/t/:code`(tour 分享链)、`/v/:code` 不计量不拦截 —— 这些是经纪拉新买家的增长回路,拦了等于打自己。

**强制点在数据层,不在 UI 层**:额度用尽后,上述核心数据端点对匿名返回 `429 { code: 'map_quota_exhausted' }`。前端 overlay 只是体验层;开 devtools 绕过 UI 的人拿不到数据。

清理:`DELETE FROM anon_map_usage WHERE day < current_date - 7`(挂进现有定时任务或每日首次请求惰性清)。

### 1.2 体验(温和渐进,不是付费墙,是注册引导)

| 时点 | 表现 |
|---|---|
| 0–7 分钟 | 完全无感,不显示任何倒计时(倒计时制造焦虑) |
| ~8 分钟 | 左下角一条温和 toast:「喜欢这张地图?登录后可以不限时使用,还能收藏项目 ✨」可关闭,不再重复 |
| 10 分钟 | 地图轻微模糊(backdrop-blur)+ 居中卡片,**已加载的画面不清空**,保留"你刚才在看的东西还在那"的感觉 |

拦截卡片文案基调(禁"抱歉/无法",与系统提示词规范一致):

> **今天的免费探索先到这里 🗺️**
> 登录后即可继续 —— 完全免费:
> ✓ 地图不限时  ✓ 收藏项目跨设备同步  ✓ Luna 智能助手
> [ 用 Google 继续 ]  [ 邮箱登录 ]
> 小字:明天额度会刷新,你也可以明天再来

- 登录必须**一键回到刚才的地图状态**(记住 center/zoom/打开的弹窗,登录回跳后恢复)。这是"温和"的关键:门槛只有登录本身,零其他损失。
- 接 Google One Tap,把登录摩擦降到最低。

---

## 2. 登录后角色选择

### 2.1 数据

新表(不动 Supabase auth,不和 lt_agents 混):

```sql
CREATE TABLE user_profiles (
  user_id uuid PRIMARY KEY,            -- Supabase auth user id
  role text CHECK (role IN ('buyer','agent')),
  role_chosen_at timestamptz,
  created_at timestamptz DEFAULT now()
);
```

`GET /api/me/profile` 无 role → 前端弹角色选择。买家选定即写入;选经纪则进现有经纪 onboarding(lt_agents + 审批)。

### 2.2 体验:一屏两卡

> **你今天来,是想…**
>
> **🏠 我在找房 / 研究投资**(免费)
> 地图与市场数据不限时 · 收藏 · Luna 智能助手 · 5年回报分析
> 小字:部分专业经纪工具(客户管理、品牌报告、实时带看)不包含
>
> **💼 我是地产经纪**(专业工具,$25/月起,15天免费试用)
> 全部买家功能 + 客户 CRM · 品牌化报告 · Luna 导览 · 潜在客户推送

- 买家一键进入,零摩擦 —— **买家就是产品的燃料**(行为→leadEngine→lead),摩擦越低燃料越多。
- "功能比经纪少"的提醒用小字正面表述("不包含"而非"被限制"),同时也是给潜伏经纪的钩子。
- 选错可改:设置里「我是经纪 →」入口随时 promote(见 §5)。
- 经纪路径:填 RERA/BRN 号 + 姓名电话 → Starter 档**付款即自动开通**(轻验证),Pro/Founder 沿用现有人工审批(lead 分发资格必须审批,防脏号)。

---

## 3. 套餐重构:三档经纪

### 3.1 目录(lt_subscription_plans 加一行 + 调两行)

| plan id | 名字(建议) | 月价 | 年付(送2个月) | credits/月 | seats | 关键权益 |
|---|---|---|---|---|---|---|
| `explore` | 体验(未订阅经纪的默认态) | $0 | — | 0 | 1 | 只有买家级功能 |
| `rookie` | **Starter 启程版** | $25 | $250 | **200** | 1 | 地图/数据不限时 + 客户CRM + 买家报告/楼书解析(积分内)+ lead 尽力推送 |
| `agent` | **Pro 专业版**(现 $99 档) | $99 | $990 | 2500 | 1 | 全功能:+ 实时带看 + Luna 导览 + lead 优先推送 |
| `founder` | **Founder 创始版**(现 $699 档) | $699 | $6990 | **15000(团队共享池)** | **含3席** | 全 Pro 权益 ×0.6 积分折扣 + white label + 加席 $49/席/月 + lead 独占优先 |

命名建议:对外别用「菜鸟」(自贬感),用 Starter/启程;文档内 plan id 用 `rookie` 无妨。

**积分与功能门调整**(只动 `credits.ts` 一处):

```
reports    20分  minPlan: rookie   ← 从 agent 降,200分/月≈10份报告,够 Starter 尝到甜头
brochures  40分  minPlan: rookie   ← 同上,≈5次/月
live_tours 60分  minPlan: agent    ← 保持,Starter 无
luna_tours 100分 minPlan: agent    ← 保持,Starter 无
```

用户说的「200 token」直接映射为现有 credits 体系的 200 分,零新概念。

**计费周期**:只留月付 + 年付(送2个月≈17% off)。代码已支持 `month/quarter/year` 三档,砍季付只需:不配 `STRIPE_PRICE_*_Q` env + 前端 PricingPage 去掉季付选项 + `billing.ts:212` 的 interval 默认值从 quarter 改成 month。

### 3.2 Founder 席位(共享积分池)

最小改动方案:**计费归属指针**,不建重量级 team 体系。

```sql
ALTER TABLE lt_agents ADD COLUMN billing_agent_id uuid REFERENCES lt_agents(id);
-- NULL = 自己付费;指向某 founder = 该 founder 的席位成员
```

- `credits.ts` 的 `planFor/spend/usedThisMonth` 开头加一步:`agentId = billing_agent_id ?? agentId`。三个函数各一行,积分池天然共享(都记在 founder 的 `lt_usage_counters` 上)。
- 席位管理:founder 台内「团队」页 → 邮箱邀请 → 受邀者登录后自动 `ensureAgent` + 写 `billing_agent_id`。上限 = 3 + 已购加席数。
- 加席计费:Stripe 上建 `STRIPE_PRICE_FOUNDER_SEAT`($49/月),用 subscription 第二个 line item 的 quantity 表示加席数,webhook 里读 quantity 写进 `lt_subscriptions.extra_seats`。
- 席位成员权限 = Pro 级功能(共享池扣费,享 founder 的 0.6x 折扣)。移除席位:`billing_agent_id` 置 NULL → 自动跌回 explore。

### 3.3 升降级 / 买家 promote

- 升降级:全部走现有 Stripe Billing Portal,零新代码(Portal 配置里把三个 price 都加进可切换列表)。降级到期生效,Stripe 自带。
- 买家 → 经纪:设置页入口 → 补经纪资料 → 订阅。`user_profiles.role` 更新为 agent,历史收藏/行为保留(反而成了这位经纪的"买家视角"资产)。
- 经纪 → 买家(退订):订阅到期跌回 explore,依然能以买家身份免费用地图 —— **不删门,留人**,流失经纪还是 DAU,还可能回来。

### 3.4 Lead 承诺的措辞与分发(重要)

「每月提供 lead」是 $25 档成立的核心理由,但**绝不能写成保证**:

- 对外话术:「符合你关注区域的潜在买家线索,**尽力推送**」(Starter)/「优先推送」(Pro)/「独占优先」(Founder)。
- 分发规则建议(leadEngine 已在产 lead):
  - 强信号 lead(contact/favorite 级)→ Founder 先挑 → Pro 轮询 → Starter 只拿溢出;
  - behavior 级 lead → Pro/Starter 轮询;
  - 匹配维度:经纪的关注区域(让经纪在台内勾选 focus areas,顺便又是一个数据点)。
- **先别在合同/页面写数字**(如"每月≥N条"),等 lead 产量稳定再说。当前 leads 表刚由 behavior-to-lead engine 喂起来,产能未知。

---

## 4. 收益与可行性评估

### 4.1 会不会明显增收?会,且结构性更好

现状:只有 $99/$699 两档 + 免费 explore,门槛太陡 —— 迪拜几万持牌经纪里,大量个体/新手经纪对 $99 犹豫,但 $25 买"最好的中文迪拜地图数据 + 可能的 lead"是低心理门槛(同类数据工具 Property Monitor/REIDIN 都是数百刀级)。

保守情景(12个月内):

| 档位 | 假设订户 | MRR |
|---|---|---|
| Starter $25 | 80 | $2,000 |
| Pro $99 | 15 | $1,485 |
| Founder $699 + 加席 | 2(各+2席) | $1,594 |
| **合计** | | **≈$5,000 MRR / $60k ARR** |

比数字更重要的三个结构性收益:

1. **Starter 是 Pro 的蓄水池**:200分/月刻意"够尝不够用"(10份报告或5次楼书),重度用户自然撞墙 → 402 升级提示已有现成机制(`creditError`)。
2. **买家免费不是成本,是资产**:每个买家的行为都在喂 leadEngine,lead 池越厚,三档经纪的付费理由越硬。免费买家的边际成本≈0(microCache 已把热点端点压下来了)。
3. **匿名限时是注册转化器**:现在匿名流量看完就走,一个身份都留不下;10分钟门 + 一键登录恢复现场,把"白嫖流量"变成可运营的买家池。

### 4.2 成本/风险

- 服务器:买家放量后 `/dubai/areas` 等已有 microCache;心跳端点极轻(一条 upsert)。真正的容量债还是既有的单实例问题(见 api-load-capacity),与本方案无关但放量会提前逼近 —— area-insights 缓存该排上了。
- 最大产品风险:**lead 供给跟不上承诺** → 措辞留余地(§3.4)+ 后台加"lead 分发看板"让你能看到每档实际拿到多少,兑现不了就先降低宣传权重。
- 10 分钟够不够"惊艳到愿意登录"?建议上线后看漏斗(app_events 已能测:匿名会话时长分布 vs 触墙率 vs 登录转化),不行再调到 15。数字做成 env(`ANON_MAP_MINUTES_PER_DAY`),改一下就行。

### 4.3 能不能做?——能,改动清单很收敛

| 模块 | 改动 | 量级 |
|---|---|---|
| 匿名计量 | 新表 + heartbeat 端点 + 数据端点薄中间件 + 前端 overlay/hook | 中 |
| 角色选择 | user_profiles 表 + /me/profile + 前端弹窗 | 小 |
| Starter 档 | plans 表加行 + credits.ts 两个 minPlan + Stripe price ×2 + PricingPage 加卡 + checkout 白名单加 'rookie' | 小 |
| 砍季付/年付折扣 | env + 前端选项 + interval 默认值 | 极小 |
| Founder 席位 | billing_agent_id 列 + credits.ts 三函数各一行 + 邀请页 + seat price/webhook | 中 |
| lead 分发规则 | leadEngine 出口加匹配/轮询 + 经纪 focus areas | 中(可后置) |

### 4.4 分期

- **P0(本周可做)**:匿名 10 分钟计量 + 温和 overlay + 登录恢复现场;角色选择弹窗 + user_profiles。→ 立刻开始积累买家注册。
- **P1**:Starter 档全链(plans/credits/Stripe/PricingPage)+ 砍季付 + Starter 付款自动开通。→ 开始收 $25。
- **P2**:Founder 席位 + 共享池 + 加席计费。
- **P3**:lead 分发规则 + 经纪 focus areas + lead 看板 → 之后才把 lead 写进营销页重点。

---

## 5. 额外建议(可选,不阻塞)

1. **买家侧留一个未来付费钩子**:买家免费,但"高级投资分析包"(如自定义组合回测、租金预警)将来可做 $9.9/月买家档 —— 现在不做,但埋点先分开记。
2. **Starter 15 天试用照给**(现有代码 `trial_period_days` 只给 agent 档,加上 rookie),试用需绑卡,转化率会好很多。
3. **年付默认高亮**:PricingPage 上默认选中年付并标"省2个月",月付作为次选项 —— 现金流和留存都更好。
4. **防降级薅 lead**:lead 推送资格跟当期套餐走(webhook 已镜像 status),past_due 即停推。
5. **内部测试号排除**:anon_map_usage 和 lead 分发都要沿用 internalVisitorIds 排除逻辑,别自己把自己拦在地图外。

## 6. 待你拍板的点

1. Starter 对外中文名(建议「启程版」,不用「菜鸟」)。
2. Founder 含席数(建议 3)与加席价(建议 $49/席/月)。
3. 匿名额度 10 分钟先上,做成 env 可调 —— OK?
4. Starter 是否付款即自动开通(建议是,轻验证 RERA 号),还是也走人工审批。
