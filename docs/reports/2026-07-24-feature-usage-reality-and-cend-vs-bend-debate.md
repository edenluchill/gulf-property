# Feature 使用量真相 + C 端 vs B 端之争的裁决

**日期**：2026-07-24
**触发**：合伙人主张「推广方向错了，平台真正解决的是买家的信息碎片化问题，应该直接做 C 端宣传」；owner 反驳「那怎么赚钱？培养买家 lead 要几年，那是有资本的人干的事」
**数据口径**：生产库实时查询，已剔除内部账号（`lzp6529` / `shelldubai26` / `edenlu1995` / `admin@yesir.ai` / `demo-agent@luna.tour`）

---

## 0. 一句话结论

> **「使用量很差」这个前提不准确。真实情况是使用量在涨，但 100% 涨在不收钱的那一半。**
> 113 个不同的人在消费地图/区域数据，0 个人碰经纪生产工具，而收费产品 100% 在后者。
> 合伙人看对了「使用发生在哪」，看错了「钱从哪来」。owner 的反驳成立，且比他自己说的更硬。

---

## 1. 数据现状（30 天）

| 指标 | 数字 |
|---|---|
| 注册经纪总数 | **74**（近 7 天 +23，近 30 天 +70） |
| 有行为的外部登录用户 | **69** |
| 匿名访客会话 | **1,429**（4,789 事件） |
| `area_detail` 区域详情 | 登录 618 次 / **44 人**；匿名 825 次 / **189 会话** |
| `property_view` | 登录 137 / 34 人；匿名 429 / **252 会话** |
| `search` | 登录 131 / 17 人；匿名 81 / 46 会话 |
| **外部用户创建的 tour** | **0** |
| `report_action` | **1 次** |
| `luna_open` / `luna_close` | 21（18 人）/ 24（11 人） |
| `map_gate_hit` | 登录 89 / 17 人；匿名 107 / 25 会话 |
| `pricing_view` → `trial_start` | 86 / 60 人 → 56 / **52 人**（转化率极高，兴趣是真的） |

### 1.1 tour 创建明细（30 天，全部会话）

| 账号 | sessions | published | 身份 |
|---|---|---|---|
| `demo-agent@luna.tour` | 6 | 6 | 内部 demo |
| `lzp6529@gmail.com` | 2 | 1 | owner |
| `shelldubai26@gmail.com` | 1 | 1 | 合伙人 |

> **外部经纪创建的 tour 仍然是 0**（与 2026-07-18 结论一致，6 天无变化）。

### 1.2 订阅现状

| status | 数量 | 说明 |
|---|---|---|
| active | 3 | **全部是自己人**：`edenlu1995` / `shelldubai26` / `lzp6529` → **真实付费客户 = 0** |
| past_due | 1 | `slavynchuk94@gmail.com`，自 **2026-07-10** 起未处理（**14 天**） |
| trialing | 43 | 到期日分布在 2026-07-24 → 2026-08-23 |
| canceled | 12 | 到期日 07-17 → 07-24，**已到期 12 个，转化 0 个（0%）** |

### 1.3 近 14 天最活跃的外部用户（可直接联系）

| 邮箱 | 事件数 | 活跃天数 | 最后活跃 |
|---|---|---|---|
| `tczhulei2001@msn.com` | 293 | **12** | 2026-07-24 |
| `wanglinli994@gmail.com` | 167 | 3 | 2026-07-24 |
| `l13541347198@gmail.com` | 165 | 2 | 2026-07-17 |
| `elaine.zhu09@googlemail.com` | 153 | 8 | 2026-07-23 |
| `graceww1110@gmail.com` | 137 | 7 | 2026-07-21 |
| `slavynchuk94@gmail.com` | 83 | 10 | 2026-07-24 |

> ⚠️ 相比 2026-07-17 的快照（「深度使用的外部用户 = 2 人」），**外部活跃面明显扩大**：近 14 天有 20+ 个外部账号有实质行为，`tczhulei2001` 已连续 12 天。**获客与留存都在改善，改变的只是分母，不是变现。**

---

## 2. 使用分布的核心事实

```
        有使用的地方                    收钱的地方
   ┌──────────────────────┐      ┌──────────────────────┐
   │ 地图 / 区域数据       │      │ Luna Tour            │  ← 外部使用 0
   │ 房源浏览             │      │ 客户 CRM             │  ← 外部使用 ~0
   │ 搜索                 │      │ 报价单 / 买家报告     │  ← 30 天 1 次
   │ (44 登录 + 189 匿名)  │      │ 协作带看 / 语音       │  ← 外部使用 0
   └──────────────────────┘      └──────────────────────┘
            免费侧                          付费侧
```

**这不是两个问题，是同一个问题：产品的价值发生在消费者信息层，收费闸门装在经纪生产工具层。**

---

## 3. 对合伙人主张的逐条裁决

### ✅ 成立：「信息对买家有稀缺性，对经纪只是方便」
数据硬证实。所有自发行为集中在消费者侧信息层，经纪生产工具外部使用为零。

### ✅ 成立：「推广方向错了」——但错的不是渠道
错的是**收费位置与需求位置不重合**，不是「推给经纪 vs 推给买家」的宣发选择。

### ❌ 不成立：「所以应该做 C 端宣传」
1. **稀缺 ≠ 可收费**。全球该品类对买家一律免费（Zillow / Property Finder / Bayut），收入全部来自经纪端或开发商端。C 端流量的变现只有两条：卖 lead 给经纪（需规模）、卖数据给机构。他描述的是前者。
2. **owner 的反驳正确**：培养 C 端 lead 是 3-5 年、需资本的打法，两人团队无现金流支撑。
3. **时机逆风（合伙人未考虑）**：迪拜二手成交同比 **−42%**（5 月 −60%），战争导致。在买家撤退期培养买家需求，成本最高、见效最慢。
4. 他没有回答 owner 的问题。「C 端获客更难」是承认成本，不是变现方案。

---

## 4. 真正的分歧点：不是「推给谁」，是「谁有预算」

| 对象 | 有需求？ | 有预算？ | 已验证？ |
|---|---|---|---|
| **买家（C 端）** | ✅ 强（113 人自发消费） | ❌ **该品类从不向买家收费** | 需求已验证，付费意愿从未存在 |
| **二手经纪** | ⚠️ 弱（工具非必需） | ⚠️ 有，但在**「线索」科目**（AED 250–500/条）不在**「工具」科目**（$49/月 ≈ AED 180） | 74 注册 / 0 付费，已实质证伪 |
| **开发商** | ✅ 下行期市场情报需求上升 | ✅ **有，且期房市场同比 +1.5% 没跌** | **零次销售对话，从未测试** |

> **唯一「既有钱、又没被测过」的是开发商侧。**

---

## 5. 建议（全部零代码）

### 立即
1. **处理 `slavynchuk94@gmail.com` 的 past_due**（挂了 14 天）。唯一一个用钱投票的外部人，扣款失败无人跟进。

### 本周
2. **打电话给 4 个高频外部用户**：`tczhulei2001`（12 天在线）、`wanglinli994`、`elaine.zhu09`、`graceww1110`。
   **只问一个问题**：「你每天来看区域数据，是自己看，还是发给客户看？」
   - 答「发给客户」→ 合伙人对，产品该往内容/分享形态走
   - 答「自己看做功课」→ 这是经纪的**工作输入**，与 C 端无关，合伙人的推论不成立
   > 这一个问题的信息量 > 继续争论一周。

### 两周内
3. **完成 3 次开发商侧销售对话**（2026-07-18 已定，至今未执行）。

### 不要做
- ❌ C 端付费投放（在需求塌陷期培养需求，最贵的时点）
- ❌ 任何新功能（已有 24 张 `lt_*` 表；外部人碰过的只有地图和房源。功能数量从来不是瓶颈）
- ❌ 把 Luna Tour 改造成 C 端产品（服务的仍是腰斩的那半个市场）

---

## 6. 一个月内会自动出结果的信号

**43 个试用集中在 2026-08-23 前到期，首批 12 个已到期、转化 0%。**

- 若到期后付费仍为 0 → 不是「推给谁」的问题，而是产品对任何一侧都未达到「必须付钱」的强度
- 若出现 ≥2 个自发付费 → 看这些人用的是哪一侧，那才是真正的产品方向

**在这个信号出来之前，任何方向之争都是两个未验证假设在互相说服。**

---

## 7. 元观察（与 2026-07-18 结论一致，再次被证实）

> **owner 与合伙人至今都没有和任何一个陌生付费方完成过一次完整对话。**
> 真正的瓶颈不是选 C 端还是 B 端，而是「与陌生客户对话」这个动作本身从未发生。
> 换方向解决不了它。

---

## 8. 复现查询

```bash
cd backend

# 外部用户行为分布（必须剔除内部账号）
npx ts-node -T scripts/db-query.ts "SELECT event_type, count(*) ev, count(DISTINCT user_email) users FROM app_events WHERE created_at > now()-interval '30 days' AND user_email IS NOT NULL AND user_email NOT IN ('lzp6529@gmail.com','shelldubai26@gmail.com','edenlu1995@gmail.com','admin@yesir.ai','demo-agent@luna.tour') GROUP BY 1 ORDER BY 2 DESC"

# 匿名侧行为分布
npx ts-node -T scripts/db-query.ts "SELECT event_type, count(*) ev, count(DISTINCT session_id) sess FROM app_events WHERE created_at > now()-interval '30 days' AND user_email IS NULL GROUP BY 1 ORDER BY 2 DESC"

# tour 创建者（判断是否有外部用户）
npx ts-node -T scripts/db-query.ts "SELECT a.email, count(*) sessions, count(*) FILTER (WHERE s.is_published) published, max(s.created_at)::date last FROM lt_demo_sessions s JOIN lt_agents a ON a.id=s.agent_id WHERE s.created_at > now()-interval '30 days' GROUP BY 1 ORDER BY 2 DESC"

# 订阅与试用到期分布
npx ts-node -T scripts/db-query.ts "SELECT status, count(*) n, count(*) FILTER (WHERE current_period_end < now()) expired, min(current_period_end)::date earliest, max(current_period_end)::date latest FROM lt_subscriptions GROUP BY 1"

# 近 14 天最活跃用户（联系名单）
npx ts-node -T scripts/db-query.ts "SELECT user_email, count(*) ev, count(DISTINCT created_at::date) days, max(created_at)::date last FROM app_events WHERE user_email IS NOT NULL AND created_at > now()-interval '14 days' GROUP BY 1 ORDER BY 2 DESC LIMIT 25"
```

---

**相关**：`2026-07-18-market-reality-and-strategic-options.md`（市场口径与战争影响）· `2026-07-17-usage-analysis-vs-saas-benchmarks.md` · `2026-07-18-solo-founder-next-project-decision.md`
