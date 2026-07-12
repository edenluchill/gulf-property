# Collab Live Tour —— 经纪单向视频（摄像头 / 沙盘直播）+ 成本转嫁 Spec

> 2026-07-12 · 状态：成本模型已定稿，待 owner 确认后实施
> 目标：live tour 中经纪可开摄像头（前置自拍 or 后置拍沙盘）增加信任；客户**只观看，不需要摄像头**。
> 成本**完全通过现有积分体系转嫁给经纪**，不新建额度体系。

---

## 0. TL;DR

- **能做**，后端 token 签发一行不改，约 2 天工作量
- 视频边际成本 **$0.004 / 观看者 / 分钟**（Agora 按**订阅**计费 → 经纪推流不花钱，只有客户观看才计）
- 计费 = **套餐内含免费额度（Pro 300 min/月）+ 超额 1 积分 / 观看者 / 分钟**
  → 典型用法下经纪**完全免费**（心理上不犹豫开摄像头），最坏情况**毛利 95%**
- **1 对多不禁止**，按人头计费 → 成本与积分线性锁死；**heartbeat 每 30s 实时结算，余额耗尽强制关视频**
  → 单个 Pro 经纪的绝对最大损失封顶 **$5.99/月**（占月费 12%）
- 免费额度存 `lt_subscription_plans.limits.video_minutes_month` → **不用新 env、不用动服务器 compose**
- ⚠️ 分辨率用 **480p**：降分辨率**不省你的钱**（Agora 无 SD 档，480p=720p 同价），但**省客户一半流量**（250MB → 110MB），客户全在手机上看
- ⚠️ 上一版 spec 的「会话结束时统一结算」**是纸糊的护栏**，已改为 heartbeat 实时结算，见 §3.5

---

## 1. 现状盘点（为什么可行）

现有 Agora 集成已是完整 RTC client，只是刻意只跑音频：

| 层 | 文件 | 现状 | 改动 |
|---|---|---|---|
| 前端 hook | `frontend/src/luna-tour/collab/useCollabVoice.ts` | join + publish mic；订阅时 `if (mediaType !== 'audio') return` **丢弃视频** | ✅ 改 |
| 前端 UI | `frontend/src/luna-tour/collab/CollabBar.tsx` | 通话胶囊（接听/静音/挂断/倒计时） | ✅ 加摄像头按钮 + 视频窗 |
| 后端 token | `backend/src/services/voiceRtc.ts` | `RtcRole.PUBLISHER`、`uid=0` 通配 | ➖ **不用改**（publisher 已可推视频） |
| 后端计费 | `backend/src/luna-tour/credits.ts` | `spend()` 只支持**每次固定成本** | ✅ 加 `spendUnits()` |
| 后端 REST | `backend/src/routes/voice-rtc.ts` | start / viewer-token / heartbeat / end | ✅ heartbeat 上报视频 viewer-minutes |
| DB | `lt_credit_ledger.credits` 是 integer | 能记任意数额 | ➖ 不用改 schema |

**客户不开摄像头是天然行为**：viewer 端只要不调 `createCameraVideoTrack()`，浏览器就不会向客户请求 camera 权限。这是 Agora 原生的单向视频场景。

---

## 2. Agora 真实计费规则（2026-07-12 核实）

来源：https://docs.agora.io/en/realtime-media/video/reference/pricing （标注 Updated 2026/07/02）+ billing-policies 页

### 2.1 ⚠️ 没有 SD 档，HD 是地板

| 档位 | 聚合分辨率阈值 | 单价 / 1000 min |
|---|---|---|
| 音频 | — | **$0.99** |
| **Video HD** | **≤ 921,600 px**（含 1280×720、640×480、360p） | **$3.99** |
| Video Full HD | 921,600 < r ≤ 2,073,600 | $8.99 |
| Video 2K | 2,073,600 < r ≤ 3,686,400 | $15.99 |
| Video 2K+ | > 3,686,400 | $35.99 |

> **推翻上一版结论**：480p 和 720p **同价**（都落在 HD 档）。降分辨率**一分钱都省不下来**。
> → **直接推 720p**，画质白拿。只需守住别超过 921,600 px（即别上 1080p，那是 2.25 倍价钱）。

### 2.2 按「订阅」计费，不按「发布」

官方原文：*"Only audio usage is charged for publishing audio or video streams."*
你的费率由你**订阅了什么**决定，**不由你推了什么**决定。

**本场景（1 经纪 + 1 客户，只有经纪推视频）：**

| 参与者 | 订阅了什么 | 计费档 |
|---|---|---|
| 经纪 | 客户的音频 | **音频** $0.99/1000min |
| 客户 | 经纪的 **720p 视频** | **HD 视频** $3.99/1000min |

→ **1 个 video-user-minute + 1 个 audio-user-minute。不是 2 个 video。**

其他规则：
- 按 **user-minute** 计（N 用户 × M 分钟），**不是** per-stream 的 N×(N−1)×M
- 同时订阅音频+视频的用户，**只按视频计一次**，不双重计费
- 「聚合分辨率」= 该用户订阅的**所有**视频流 width×height 之和 → 多路视频会把用户**推高**档位（本场景只有 1 路，安全）
- 时长按秒记，按月汇总后除 60 **向上取整**（月级取整，误差 ≤1 min/月）

### 2.3 成本表

| 场景（30 分钟带看） | 计费构成 | 成本 |
|---|---|---|
| 纯语音，1 经纪 + 1 客户 | 60 audio-user-min | **$0.059** |
| 开视频，1 经纪 + 1 客户 | 30 video + 30 audio | **$0.149** |
| **视频的增量成本** | | **+$0.090**（= **$0.003/min**） |
| 开视频，1 经纪 + **3 客户** | 90 video + 30 audio | **$0.389** |

> **核心公式：视频边际成本 = 观看视频的客户数 × $0.00399 / 分钟**
> 经纪自己不产生视频费（他只订阅音频）。

### 2.4 ⚠️ 免费额度的陷阱（必须去 Console 确认）

Agora 在 **2025-08-29** 换了计费模型。**该日之后建的账号在「新模型」上**（你的 Agora 集成是 2026-06 建的 → 极可能是新模型）。

| | legacy 模型 | **新模型（你）** |
|---|---|---|
| 每月免费 | 10,000 **原始**分钟（音视频不分） | 10,000 **Standard** 分钟 |
| HD 视频换算 | 1:1 | **1 真实分钟 = 4 Standard 分钟** |
| **实际免费视频量** | 10,000 min | **仅 2,500 真实视频观看分钟** |

**两个必须知道的坑：**
1. 免费额度对视频只有名义值的 **1/4**。别按 10,000 做成本模型。
2. **一旦购买任何付费套餐，10,000 免费分钟立即作废**（官方 Caution：折扣已折进套餐价）。
3. 免费账号超额 → **第 2 天直接停服**（不是静默超额计费）。

**当前规模安全**：3 个付费经纪，免费额度绰绰有余。
**警戒线**：约 25 个活跃经纪 × 每人 100 视频分钟/月 → 开始出账单。

**行动项**：去 Agora Console 确认账号是 legacy 还是新模型 —— 这决定免费额度对视频值 4 倍还是 1 倍。

---

## 3. 成本转嫁设计（核心）

### 3.1 现有积分体系的经济学锚定

`lt_subscription_plans` 实况：

| 套餐 | 月费 USD | credits_month | cost_multiplier | **1 积分售价** |
|---|---|---|---|---|
| explore | $0 | 0 | 1.0 | — |
| rookie (Starter) | $25 | 200 | 1.0 | $0.125 |
| **agent (Pro)** | **$49** | **1200** | 1.0 | **$0.041** ← 主力锚 |
| founder (Agency) | $699 | 15000 | 0.6 | $0.028 |
| developer | $999 | 20000 | 0.6 | $0.030 |

现有功能定价（`credits.ts` FEATURES）：reports 20 · brochures 40 · **live_tours 60** · luna_tours 100 · payplan 5

> 参照系：`live_tours` 收 60 积分 = **$2.45/场**，而一场纯语音带看的 Agora 成本才 **$0.06** → 现有加价率 **40 倍**。

### 3.2 ✅ 定价决策：套餐内含免费额度 + 超额扣积分

**（2026-07-12 owner 定，取代「纯扣积分」方案）**

```ts
// credits.ts —— 只有超出免费额度的部分才走这里
live_video: { label: '带看视频', labelEn: 'Live video', credits: 1, minPlan: 'agent' }
```

```jsonc
// lt_subscription_plans.limits 新增字段(套餐级参数,与 credits_month 同源)
{ "video_minutes_month": 300 }
```

- 计量单位 = **viewer-minute**（观看视频的客户数 × 分钟数，向上取整）
- 每月免费额度内 → **不扣积分**
- 超出后 → **1 积分 / viewer-minute**（售价 $0.041，成本 $0.004，毛利 90%）

#### 为什么免费额度是对的（心理学，不是经济学）

积分是硬通货，经纪心里有杆秤。「开摄像头要扣分」会让他**犹豫**。而视频的战略目的是
**促成交、提续费**，不是赚那几毛钱 → 必须让他**不假思索地开**。

#### 而这个额度他根本用不完 —— 这才是关键

经纪要开视频，**必须先建带看房间，那要花 60 积分**。视频总量早已被积分池锁死：

- agent 档 1200 积分 ÷ 60 = **最多 20 场带看/月**（还没算报告、楼书）
- 单场 token TTL 硬限 **30 分钟**
- → 理论天花板 = 20 × 30 = **600 viewer-min**，且要求他把全部积分烧在带看上、每场全程开摄像头

**300 分钟/月 覆盖「20 场带看 × 每场开 15 分钟视频」** —— 超充分。真实经纪只在展示沙盘时开几分钟。

> **额度看起来是限制，实际是「Pro 送你视频」的包装纸。**
> **超额扣积分只是防异常的安全阀**（忘关摄像头、10 人围观、恶意刷）。

### 3.3 各档免费额度

| 套餐 | 月费 | **免费视频分钟/月** | Agora 成本 | 占月费 |
|---|---|---|---|---|
| explore | $0 | 0 | — | — |
| rookie | $25 | 0（本来就无带看权限，minPlan=agent） | — | — |
| **agent** | **$49** | **300** | **$1.20** | **2.4%** |
| founder | $699 | 1,500 | $5.99 | 0.9% |
| developer | $999 | 600 | $2.39 | 0.24% |
| **⚠️ 免绑卡试用** | **$0** | **30**（单独常量，**不继承套餐**） | $0.12 | — |

> ⚠️ **额度必须按 viewer-minute 扣**，不能按 wall-clock 分钟 ——
> 否则「3 个客户围观 10 分钟」只扣 10 分钟，但成本是按人头涨的（3×），会绕过限制。

#### ⚠️ 洞 ①：免绑卡试用不能继承套餐的视频额度

`planFor()` 里试用返回的 `plan` **就是订阅行上的 `plan_id`**（DB 里确实存在 `agent / trialing` 的账号）。
若按套餐读 `video_minutes_month`，**试用用户会直接继承 Pro 的 300 分钟** —— 而试用是**零收入 + 免绑卡**
（memory: free-trial-no-card —— 刻意不绑卡，注册成本近乎为零）。

单个试用账号的最大白嫖：`300 免费($1.20) + 200 试用积分买 200 min($0.80)` = **$2.00**。
一个人无所谓，**但 100 个邮箱刷试用 = $200**。

✅ **修法**：试用视频额度走独立常量，**不读套餐**：

```ts
export const TRIAL_VIDEO_MINUTES = Number(process.env.TRIAL_VIDEO_MINUTES || 30)

async function videoQuotaOf(p: PlanCfg): Promise<number> {
  if (p.freeTrial) return TRIAL_VIDEO_MINUTES        // ⚠️ 绝不继承套餐额度
  return (await pool.query(`SELECT (limits->>'video_minutes_month')::int ...`)) ?? 0
}
```

30 分钟够试用者试出效果（看到摄像头对客户的说服力），又把白嫖面砍到 $0.12/账号。

#### 洞 ②：owner / UNLIMITED_EMAILS 白名单无刹车（**刻意不堵**）

`isUnlimited()` 的账号积分永远扣不完 → `stopVideo` 恒 `false` → **视频无刹车**。
兜底只有单场 30min TTL → 一场最多 6 人 × 30min = 180 viewer-min = **$0.72/场**。

**刻意不堵**：内部人可控，堵了反而妨碍演示。但代码里必须留注释，别哪天忘了。

### 3.4 ⚠️ 1 对多：成本按人头线性放大（真实风险）

**`collab-rooms.ts` 现在对房间人数没有任何上限** —— 拿到链接就能进。
经纪把 link 甩进一个 100 人微信群，100 人同时点开是完全可能发生的。

一场 30 分钟、全程开摄像头：

| 观看人数 | viewer-min | 视频成本 | 音频成本 | **合计** |
|---|---|---|---|---|
| 1 | 30 | $0.12 | $0.06 | **$0.18** |
| 5 | 150 | $0.60 | $0.18 | **$0.78** |
| 20 | 600 | $2.39 | $0.62 | **$3.01** |
| **100** | **3,000** | **$11.97** | $3.00 | **$14.97** ⚠️ 一场吃掉月费 30% |

> **1 对多不需要禁止** —— 成本与积分消耗是**线性锁死**的（按 viewer-minute 计），
> 多人围观只是「烧得更快」，不是「烧得更亏」。毛利恒定 90%。
> 但**必须能实时刹车**，见 §3.5。

### 3.5 三层护栏（关键在第 ② 层）

#### ① 软限：视频观看名额 6 人
服务端按加入顺序发「可看视频」授权（走 collab WS）。第 7 位及以后的客户
**只订阅音频** —— 照样能听经纪讲、跟着经纪的地图视角走，只是没有画面。
经纪端 UI 显示「视频观看 6/6 已满」。

> 客户端理论上可改代码绕过 → 所以这层是**软**的，真正的兜底是第 ②层。

#### ② 硬限：heartbeat 实时结算，余额耗尽 → 强制 unpublish 视频 ⭐

> **这是对上一版设计的关键修正。**
> 上一版写「会话结束时（`/end`）统一结算扣积分」—— **那是纸糊的护栏**：
> 100 人围观 30 分钟，钱早就花完了才发现，事后扣积分只是记账，拦不住任何东西。

正确做法：`heartbeat` **每 30 秒**上报当前视频观看人数，**服务端当场结算**：

```ts
POST /api/voice-rtc/heartbeat { sessionId, videoViewers }
→ { stopVideo: boolean, freeLeft: number, creditBalance: number }
```

`stopVideo: true` → 前端**立即 `unpublish` 视频轨**。视频轨一撤，所有人画面同时黑掉，
**Agora 当场停止计费**。语音不受影响，带看继续进行。

30 秒结算粒度下的最坏超支：100 人 × 30s = 50 viewer-min = **$0.20**。可忽略。

#### ③ 已有：单场 30 分钟 token TTL（不用做）

### 3.6 积分池 = 天然的成本封顶（最坏情况压力测试）

**场景 A —— 正常最坏（1 对 1，把额度和积分都榨干）**：

| | |
|---|---|
| 音频成本（20 场 × 30min × 2 人 = 1200 audio-user-min） | $1.19 |
| 视频成本（300 免费 viewer-min） | $1.20 |
| **合计成本** | **$2.39** |
| **毛利（收入 $49）** | **95.1%** ✅ |

**场景 B —— 恶意最坏（100 人围观、且绕过客户端限制）**：

```
300 免费分钟             → $1.20
+ 1200 积分 ÷ 1分/viewer-min → 1200 viewer-min → $4.79
──────────────────────────────────────────────────────
Pro 经纪的绝对最大 Agora 成本  $5.99   (占 $49 月费的 12%)  ✅
```

100 人围观时积分以 **100 分/分钟** 的速度烧 → 1200 积分 **12 分钟见底** →
第 ② 层护栏自动关视频。**他烧的是自己的积分，你的损失有硬封顶。**

**三道锁：免费额度封顶 · 积分池封顶 · heartbeat 实时刹车。** 四档全部安全。

### 3.5 典型经纪的真实账（agent $49 档）

| 用法 | 积分 | 视频分钟 |
|---|---|---|
| 10 场实时带看 | 600 | — |
| 每场开 10 分钟视频 × 1 客户 | **0（免费额度内）** | 100 / 300 |
| 20 份买家意向报告 | 400 | — |
| **合计** | **1000 / 1200** ✅ | **100 / 300** ✅ |

→ 典型用法下**视频完全免费**，且离额度上限还很远。这正是设计意图。

### 3.6 为什么**不**做独立的 daily-limit env 体系

上一版 spec 提议加 `voice_sessions.video_seconds` + `AGORA_AGENT_VIDEO_DAILY_SECONDS` env。**放弃**：

- 免费额度存 `lt_subscription_plans.limits`（套餐级，与 `credits_month` 同源）→ **不用新 env、不用动服务器 compose**
  （新 env 要手动加进 `/opt/pinzos/docker-compose.yml`，是已知踩坑点 —— memory: agent-approval-and-auth：.env 有值但 compose 没映射 = 等于没配）
- 日额度是**第三重限制**，只会让经纪困惑（「我积分和视频额度都还有，为什么开不了？」）
- §3.4 已证明最坏情况毛利 95% → 没有要防的风险

**保留的护栏**：① 现有单场 30min token TTL（已存在，不用做）② 月度免费额度 ③ 积分池

---

## 4. 实现

### 4.1 后端：`credits.ts` 加「免费额度 + 超额按量扣费」

现有 `spend()` 写死「每次固定成本」，且没有免费额度概念。新增两个函数：

```ts
/** 本月已用的视频 viewer-minutes(从 ledger 的 units 列累计,与积分是否实扣无关)。 */
async function videoMinutesUsed(billingId: string, p: PlanCfg): Promise<number>

/**
 * 视频用量结算:先吃套餐免费额度,超出部分才扣积分。
 * 返回 { freeUsed, billedUnits, credits },供 UI 展示「本次免费/扣了 N 分」。
 */
export async function settleVideoUsage(
  actorAgentId: string, viewerMinutes: number, ref?: SpendRef
): Promise<{ freeUsed: number; billedUnits: number; credits: number }> {
  const n = Math.max(0, Math.ceil(viewerMinutes))
  if (n === 0) return { freeUsed: 0, billedUnits: 0, credits: 0 }

  const unlimited = await isUnlimited(actorAgentId)
  const billingId = await billingAgentOf(actorAgentId)   // 席位成员 → founder 共享池 + 共享额度
  const p = await planFor(billingId)

  const freeQuota = await videoQuotaOf(p.plan)           // limits->>'video_minutes_month'
  const alreadyUsed = await videoMinutesUsed(billingId, p)
  const freeLeft = Math.max(0, freeQuota - alreadyUsed)

  const freeUsed = Math.min(n, freeLeft)
  const billedUnits = n - freeUsed
  // ⚠️ 折扣必须在总量上取整,不能逐单位取整
  //    (Math.round(1 * 0.6) = 1 → founder 的 40% 折扣会被整个吃掉)
  const credits = unlimited ? 0 : Math.round(FEATURES.live_video.credits * billedUnits * p.multiplier)

  // ledger 总是记一行(含 credits=0 的免费行),units 列记 viewer-minutes → 额度可回算
  // 然后 credits > 0 时 upsert lt_usage_counters(同 spend())
  return { freeUsed, billedUnits, credits }
}
```

**⚠️ DB 改动**：`lt_credit_ledger` 加一列 `units integer`（记 viewer-minutes）。
免费行的 `credits = 0` 但 `units = 12` → 才能回算「本月免费额度用了多少」。
不加这列的话，免费用量在账本上是**隐形的**，额度永远算不准。

```sql
ALTER TABLE lt_credit_ledger ADD COLUMN units integer;   -- 计量型功能的用量(视频=viewer-minutes)
```

同时加 `checkVideoQuota(agentId)` 供开摄像头前预检 → 返回 `{ freeLeft, creditBalance, allowed }`。

### 4.2 后端：heartbeat 实时结算 + 刹车 ⭐

`useCollabVoice` 的 presenter heartbeat 已经是 30s 一次。扩展成**结算 + 授权**双向：

```ts
POST /api/voice-rtc/heartbeat { sessionId, videoViewers: number }   // 当前订阅视频的客户数
→ { stopVideo: boolean, freeLeft: number, creditBalance: number }
```

服务端每次 heartbeat：
1. 累加 `videoViewers × 30s` 进 `voice_sessions.video_viewer_seconds`
2. **当场结算**这 30 秒的量（先吃免费额度，超出扣积分）
3. 若免费额度和积分**都已耗尽** → 返回 `stopVideo: true`

前端收到 `stopVideo: true` → **立即 `unpublish` + `close()` 视频轨**，UI 提示
「视频额度已用完，语音继续」。**Agora 当场停止计费。**

> ⚠️ **不能等 `/end` 才结算** —— 那样 100 人围观 30 分钟，钱早花完了才发现，
> 事后扣积分只是记账，拦不住任何东西。结算必须跟着 heartbeat 走。

**ledger 写入策略**：为免 30s 一行刷爆账本，heartbeat 只更新
`voice_sessions.video_viewer_seconds` + `lt_usage_counters`（聚合），
**`/end` 时补写一行汇总 ledger**（`ref_type:'live'`、`ref_id: roomCode`、`units=总viewer-min`）：
- 额度内 →「带看视频 · 12 分钟 · **免费额度**」（credits=0, units=12）
- 超额 →「带看视频 · 36 分钟 · 扣 12 积分」（credits=12, units=36）

浏览器崩溃收不到 `/end` → 后台清扫按 `video_viewer_seconds` 补写。
**积分在 heartbeat 时已实扣，崩溃不会漏计费。**

```sql
ALTER TABLE voice_sessions ADD COLUMN video_viewer_seconds int NOT NULL DEFAULT 0;
ALTER TABLE voice_sessions ADD COLUMN video_credits_spent  int NOT NULL DEFAULT 0;  -- 已实扣,防重复结算
```

### 4.2b 后端：视频观看名额（软限，6 人）

collab WS 在 viewer 加入时按顺序发 `canWatchVideo: boolean`（前 6 个 true）。
`collab-rooms.ts` 的 `room.participants` 已有加入顺序，直接用。
经纪端 UI 显示「视频观看 6/6 已满」。第 7 位起只订阅音频。

### 4.3 前端：`useCollabVoice.ts`

**订阅端**（现第 111-117 行，把 audio-only 判断放开）：
```ts
client.on('user-published', async (user, mediaType) => {
  await client.subscribe(user, mediaType)
  if (mediaType === 'audio') user.audioTrack?.play()
  if (mediaType === 'video') setRemoteVideo(user.videoTrack ?? null)
})
client.on('user-unpublished', (_u, mediaType) => {
  if (mediaType === 'video') setRemoteVideo(null)   // 经纪关摄像头 → 收起视频窗
})
```

**推流端（presenter only）**：
```ts
const cam = await AgoraRTC.createCameraVideoTrack({
  facingMode: facing,          // 'user' 自拍 / 'environment' 拍沙盘
  encoderConfig: '480p_1',     // 640×480。价格与 720p 完全相同(同属 HD 档),
                               // 但客户流量减半(30min: 250MB → 110MB)。客户全在
                               // 手机上看 240×180 小窗,720p 的像素落不到屏幕上。
                               // 客户点全屏细看沙盘时再动态 setEncoderConfiguration('720p_1')。
                               // ⚠️ 绝不上 1080p —— 越过 921,600px 阈值 = 2.25 倍价钱。
})
await client.publish([cam])
```

**⚠️ 前后置切换的坑**：
> ❌ 不要用 `cam.setDevice()` / `switchDevice()` 换 facingMode —— iOS Safari 上会**静默失败**（promise resolve 但画面不变）。
> ✅ 正确：`unpublish` → `close()` 旧 track → 用新 facingMode 重建 → `publish`。期间黑屏约 300ms，加 loading 遮罩。

**API 扩展**：
```ts
cameraOn: boolean
facing: 'user' | 'environment'
toggleCamera: () => void
flipCamera: () => void
remoteVideo: IRemoteVideoTrack | null   // viewer 挂视频窗
localVideo: ICameraVideoTrack | null    // presenter 本地预览
videoCreditsExhausted: boolean          // 积分不足 → 按钮置灰
```

### 4.4 前端：视频窗 UI

- **位置**：地图**右下角**悬浮画中画，可拖动、可收起为小气泡
- ⚠️ **必须避开**（memory: map-mobile-chrome-layout —— 右侧指标卡/工具卡/Luna 一律不碰）：右上指标卡、右缘 Luna 药丸
- **z-index**：`z-[2100]`（低于 CollabBar 的 `z-[2150]`，高于地图）
- **必须 `createPortal` 到 body**（铁律：transform/backdrop-filter 容器内的 fixed 元素会被裁）
- **尺寸**：桌面 240×180，移动 160×120；双击放大到 40vw
- **经纪端必须有本地预览** —— 否则不知道镜头对没对准沙盘

### 4.5 前端：CollabBar 按钮

在通话胶囊内、静音按钮旁：
- presenter + `status === 'live'` → 摄像头图标（`Video`/`VideoOff`）；开启后额外露出翻转图标（`SwitchCamera`）+ **实时积分消耗提示**（「视频 · 8 分钟 · 8 积分」）
- presenter + 积分不足 → 图标置灰，title「积分不足，无法开启视频（语音不受影响）」
- viewer → **不显示任何摄像头按钮**

---

## 5. 产品决策（已定）

| # | 决策 | 结论 |
|---|---|---|
| D1 | 视频依附于语音通话？ | ✅ **是**。经纪先接通语音，摄像头按钮才可用。客户不在频道里本来就收不到视频流 |
| D2 | 视频默认开还是关？ | ✅ **默认关**，经纪按需开。摄像头是信任加成，不是每场必开；默认开 = 白烧钱 |
| D3 | 客户能推视频吗？ | ✅ **不能**。UI 不给按钮即可（token 是 PUBLISHER 通配，理论上能绕，但自己人自己房间，不为此做角色化 token） |
| D4 | 分辨率 | ✅ **480p**（`encoderConfig: '480p_1'`）。降分辨率**不省你的钱**（无 SD 档，与 720p 同价），但**省客户一半流量**：720p 一场 30min ≈ 250MB，480p ≈ 110MB。客户全在手机上看 240×180 的小画中画，720p 的像素根本落不到屏幕上。客户点开全屏细看沙盘时再动态切 720p。**绝不上 1080p**（2.25 倍价） |
| D5 | 计费口径 | ✅ **套餐内含免费额度（Pro 300 min/月）+ 超额 1 积分/观看者/分钟**。按 **viewer-minute** 计（观看人数 × 分钟）。额度存 `limits.video_minutes_month`，超额走现有积分池。**不建独立的 daily-limit env 体系** |
| D6 | 1 对多怎么管 | ✅ **不禁止，按人头计费 + 实时刹车**。成本与积分线性锁死，多人只是烧得快不是烧得亏。护栏：① 视频观看名额 6 人（软）② **heartbeat 每 30s 实时结算，余额耗尽强制 unpublish 视频**（硬，见 §3.5）③ 单场 30min TTL（已有）。最坏损失封顶 **$5.99/经纪/月** |

---

## 6. 测试要点

- **必须真机测**：headless 测不出 iOS Safari 的 facingMode 行为
- iPad（经纪主力设备，memory: sales-status-and-pin-labels）后置摄像头拍沙盘 → 客户手机能看到
- 经纪关摄像头 → 客户端视频窗自动收起（`user-unpublished`）
- 经纪切前后置 → 客户端画面中断 < 1s
- **客户端全程不弹摄像头权限**（验收硬指标）
- 积分不足 → 摄像头置灰但**语音通话不受影响**
- 多客户场景 → 扣费 = **观看人数 × 分钟数**（不是 wall-clock 分钟）
- **⭐ 刹车验证（必测）**：把某经纪的免费额度和积分调到接近 0 → 开视频 → **30 秒内视频自动关闭**，
  UI 提示「视频额度已用完」，而**语音通话不中断**、带看继续
- **⭐ 多人围观**：模拟 8 个 viewer 进房 → 第 7、8 位收不到视频（只有音频），经纪端显示「视频观看 6/6 已满」
- founder 席位成员开视频 → 扣的是 **founder 共享池**，且吃到 0.6 折扣
- 会话崩溃（关浏览器）→ heartbeat 已实扣的积分不丢、不重复扣（`video_credits_spent` 防重）

---

## 7. 工作量

| 项 | 估计 |
|---|---|
| DB migration（`ledger.units` + `voice_sessions.video_*` + 4 档 `video_minutes_month`） | 0.5h |
| `credits.ts` 加 `settleVideoUsage` + `checkVideoQuota` | 2h |
| **heartbeat 实时结算 + `stopVideo` 刹车 + 崩溃补结算** ⭐ | 2.5h |
| 视频观看名额 6 人（collab WS 发 `canWatchVideo`） | 1h |
| `useCollabVoice` 视频轨 + 前后置切换 + 收到 `stopVideo` 自动 unpublish | 3.5h |
| 视频窗 UI（拖动/收起/本地预览） | 3h |
| CollabBar 按钮 + 额度/积分/观看人数实时展示 | 1.5h |
| 真机测试（iPad + 手机 + **多人围观刹车验证**） | 2.5h |
| **合计** | **~16.5h / 2 天** |

## 8. 上线前 checklist

- [ ] **去 Agora Console 确认账号是 legacy 还是新计费模型**（决定免费额度对视频值 4 倍还是 1 倍，见 §2.4）
- [ ] 在 Agora Console 设**用量告警**（免费账号超额第 2 天直接停服，不能被动等）
- [ ] 4 档套餐的 `limits.video_minutes_month` 写进 DB（agent 300 / founder 1500 / developer 600 / 其余 0）
- [ ] `FEATURES.live_video` 加进 `featureCatalog()` → 价格页/台内消耗表自动渲染，且**文案要写「Pro 含 300 分钟/月，超出 1 积分/分钟」**
- [ ] 部署 API（`quick-deploy.ps1`）—— 无新 env，**不需要**动服务器 compose ✅
