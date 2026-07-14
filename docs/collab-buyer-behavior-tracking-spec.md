# 实时带看 · 买家行为采集 Spec(2026-07-10)

## 问题
实时带看(collab)是星型拓扑:**只有经纪(presenter)广播**镜头/选项目/Luna查询,买家跟随。
`collab_rooms.events` 存的 select/goto/mapAction **全是经纪操作**(`from` 不区分),买家自己的
独立操作**完全没采集**。意向报告因此把经纪带看当"带看行为",拿不到买家真实意向信号。
(诊断见对话 2026-07-10;事件分布实测 8TH9L:select×21/mapAction×13 全 from=null,chat=0。)

## 目标
采集**买家自己的操作**并与经纪操作严格区分,意向报告只把买家自主行为算意向:
- 点了哪个项目 / 打开哪个户型
- 点了哪个 area、area 信息看了多久
- 用了什么 filter(口径/期房现房/价格等)
- 点了什么 POI
- 每个对象的停留时长
- 聊天说了什么
- (free 模式下)自己把镜头移到哪

## 关键设计决策(待确认)
1. **买家能否独立操作?** 现状 viewer 默认 following,可切 free 自己浏览地图。但"点项目开户型/用
   filter/点 POI"这些交互 viewer 的 UI 当前是否开放?→ **需先确认 viewer 在带看中能独立点击/筛选**,
   否则要先放开 viewer 的这些交互(且不影响经纪主镜头/不广播给别人)。
2. **上报通道**:两选一——
   - (A) 复用 collab WS:买家操作发一条 `buyerAct` 消息 → 后端存进 collab_rooms.events(带 who/from=viewer)。
     好处:与现有 events 同源,report 直接用。坏处:改 collab 协议 + WS handler(核心,敏感)。
   - (B) 复用现有 track 埋点(app_events):买家操作打普通事件,payload 带 collab code + visitor_id。
     好处:不碰 collab 核心,风险低,且买家身份天然带。坏处:report 要 join app_events。
   → **倾向 (B)**:collab 核心敏感(内存多次踩坑),app_events 采集已成熟,买家 visitor_id 已有。
3. **归属**:每条买家事件带 (collab_code, visitor_id/connId, 对象, 时间戳),report 按买家聚合。

## 分期
- **P1 采集 + 归属 + report 区分**:买家在带看中的 点项目/点area/点POI/用filter/chat 打点(走 track,
  带 collab code),collabReport join 出"每个买家自己的操作",AI facts 分两栏「经纪带看」vs「买家A/B自主」,
  interest 只看买家自主信号。
- **P2 停留时长**:从买家事件时间戳派生每个项目/area/户型的停留时长(买家自己的,不是经纪带的)。
- **P3 filter/POI 细节 + free 模式镜头轨迹**:补齐筛选口径、POI、自由浏览路径。
- **前置**:若确认 viewer 当前不能独立点项目/filter → 先放开 viewer 交互(P0)。

## report 呈现
意向报告改为分栏:
- 「经纪带看了什么」(现有 presenter events,标注是经纪主导)
- 「买家 A 自己看了什么」「买家 B ...」(新:各买家自主操作 + 停留 + 提问)
- AI interest_level 只基于买家自主行为(点了/停留/问了),不再被经纪操作误导。

## Session 身份·安全·自定义链接(2026-07-10 追加需求)

### 现状(实测)
- 房间在内存(collab-rooms.ts)。`createRoom` 生成随机 code;但 `ensureRoomWithCode`/`getRoomByCode`
  让同一 code **长期有效、任何人可加入**,无一次性/过期/passcode/结束机制(只靠 GC)。
- 加入只传 `name`(客户填,没填=「访客」),无强身份。link = `pinzos.com/t/:code`(SHARE_BASE_URL)。
- `lt_agents` 无 handle/slug 列。

### 需求 1:客户不登录,经纪怎么认谁 → 能,不用登录
- 进带看弹轻量「你是谁」:名字必填,电话/WhatsApp 选填(**不强制登录**)。
- 每个 viewer = name + visitor_id(埋点身份,跨会话稳定) + 他自己的行为(见上买家行为采集)。
- 报告按买家分栏:「张三看了 X、停留 5 分、问了付款」→ 经纪据此跟进。
- 真·跟进(打电话/加微信)需联系方式 → 加入门选填 or 带看结束弹留资(转 lead,复用 [[behavior-to-lead-engine]])。

### 需求 2:每次独立 session,防偷听
组合(按性价比):
1. **每次「开始带看」新 code**,不复用旧 link(前端保证不 ensureRoomWithCode 旧码)。
2. **经纪「结束带看」→ 房间关闭**,旧 code 失效(再进提示「本次带看已结束」)。当前只靠 GC,加显式 end。
3. **在场名单 + 踢人**:经纪看到谁在房间(name/visitor),能踢掉不该在的人。
4. (可选加强)**4 位 passcode / 经纪审批进入**:陌生人拿到 link 也进不去,要经纪放行。
- 铁律:presenter 不在(没开带看)时旧 link 进不去。

### 需求 3:经纪自定义 handle 链接 `/t/:handle/:xxxxx`
- `lt_agents` 加 `handle` 列(唯一、小写 slug、正则校验),**先抢先得**,系统默认给一个(email 前缀),
  经纪可编辑(改名释放旧的、占用即不可用,唯一约束 + 409)。
- 路由 `/t/:handle/:code`(前端 map 路由 + 后端 SHARE_BASE_URL 拼 handle),**兼容旧 `/t/:code`**。
- 好处:品牌化链接 + link 自带经纪身份(辅助 session 归属)。handle ≠ session code(code 仍每次新生成)。

### 分期(整合买家行为 + session 改造)
- **S1 防偷听最小闭环**:每次开始带看新 code + 经纪显式结束即失效 + 在场名单/踢人。(安全最急)
- **S2 客户身份门**:进带看填名(+选填联系方式)→ 行为/报告归属到人 + 带看后留资转 lead。
- **S3 买家行为采集**(本文档主体 P1-P3):买家自主操作打点归属。
- **S4 经纪 handle 自定义链接**:handle 列 + /t/:handle/:code + 个人中心可编辑。
- 依赖:S2 是 S3 报告「按买家分栏」的前提(先有身份才能归属行为)。

## 关联
[[collaborative-tour-intent-engine]] [[voice-agora-cost-guards]] [[identity-context-and-api-attribution]]
(买家 visitor_id 归属) [[analytics-internal-exclusion]](经纪不算客户,同理买家行为要排经纪自己)
