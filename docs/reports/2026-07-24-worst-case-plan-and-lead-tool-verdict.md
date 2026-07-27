# 最坏打算：一个月后零付费怎么办 + 「lead 工具」方向裁决

**日期**：2026-07-24
**触发**：owner 提问——「假如 1 个月后根本没客户买账，该怎么做？做帮经纪寻找 lead 或者生成 lead 的工具？」
**前置修正**：`slavynchuk94@gmail.com` 的 past_due **不是真实付费意愿**，owner 确认是「绑一张坏卡试试」。
→ **至今为止，外部人用钱投票的记录为 0 票**（不是 1 票扣款失败）。

---

## 0. 结论

> **不推荐做「帮经纪找 lead / 生成 lead 的工具」。**
> 核心否决理由不是市场判断，是**上游供给为空**：30 天 1,429 个匿名会话里只有 15 个第二天回来过，
> 看过房源的会话平均只看 1.7 套。**这是路过流量，不是买家流量。**
> 既没有可卖的 lead，也没有可喂给生成器的原料。
>
> 一个月后若零付费，推荐顺序：**A 测开发商（两周，零代码）→ B 降维持态但不关 → C 补上「与陌生付费方对话」这个从未做过的动作**。

---

## 1. 为什么否决「lead 工具」

### 1.1 卖 lead ≠ 卖「找 lead 的工具」

| | 交付物 | 经纪的失败感受 |
|---|---|---|
| 卖 lead（Zillow 模式） | 一个会接电话的人 | 「这条不行」→ 换下一条 |
| **卖 lead 工具** | 一套帮你找人的软件 | **「一个月没接到电话 = 骗子」** |

lead 工具**仍然是工具**，只是把承诺换成了更难兑现的那个。已知事实：74 注册 / 0 付费，经纪不为工具付钱。
**把承诺提高不会改变这条，只会把「温和失败」升级成「愤怒 + 退款」。**

### 1.2 ⭐ 硬伤：没有 lead 供给（决定性）

生产库实查（2026-07-24，30 天窗口）：

| 指标 | 数字 | 含义 |
|---|---|---|
| 匿名会话 | 1,429 | 看起来像流量 |
| **第二天回来过的会话** | **15** | **99% 一次性** |
| 有房源浏览的会话 | 253 | — |
| 房源浏览总次数 | 429 | **平均 1.7 套/会话** |
| 有 ≥3 个事件的会话 | 461 | 深度也仅止于此 |
| `leads` 表 | 23 条（全部 06-30 后自动生成） | 非买家询盘 |
| `lt_clients` 全站客户总数 | **5**（4 个经纪录入） | CRM 实质未使用 |

> **真买家的行为特征是：会回来、会比价、会看十几套。**
> 看 1.7 套就走、永不回头 = 路过流量。

**结论：lead 工具的上游是空的。这不是产品质量问题，是原料不存在。**

### 1.3 品类结构性劣势

- 全行业退款率最高、生命周期最短的品类之一
- 在位者（Property Finder / Bayut）**本身就是 lead 供给方** → 你要在分发上与供给方正面竞争

---

## 2. 「lead 方向」里的两个变体

### 版本 A：自己成为 lead 源（Zillow 模式）— 否决

- 否决理由 1：上游供给不足（见 1.2）
- 否决理由 2：**owner 自己的判断成立**——培养买家 lead 需 3-5 年 + 资本，两人团队无现金流支撑
- 否决理由 3：**时机逆风**——二手成交同比 −42%，买家正在撤退，此时培养 C 端需求成本最高

### 版本 B：帮经纪激活「死联系人」— ⚠️ 唯一零供给依赖的可行变体

**核心优势：供给是经纪自带的。** 每个迪拜华人经纪微信里都有几百个半年以上未联系的购房意向客户。
**你不需要拥有 lead，只需要帮他重新触达自己的。**

- 复用资产：异步 tour 引擎 + 分享链接 + 预生成语音（全部现成）
- 改动范围：文案 + onboarding + 批量分享，**非新产品**
- **验证方式（三天，零代码）**：问 5 个经纪一句话——
  > 「你微信里有多少个超过半年没联系的购房意向客户？」
  - 普遍 200+ → 假设成立，可做
  - 普遍 20 → 不成立，放弃

> 注：此变体在 `war-demand-collapse-and-model-repositioning` 中已提出，至今未验证。

---

## 3. 一个月后零付费的行动排序

### A. 优先：把「卖工具」换成「卖结果」，测开发商（两周内，零代码）

**为什么是它**：唯一**既有预算、又从未被测试**的一侧。期房首登同比 **+1.5%**（没跌），钱还在开发商渠道。

**执行方式（关键：不推销软件）**：
1. 用现成 DLD 数据做**一份具体项目的竞品定价报告**（实物，非 demo 账号）
2. 直接寄给 **3 个开发商销售总监**
3. 只问一句：这份东西每月更新，值不值 $999/月

**算术**：$999 × 3 = **$3,000/月** > 74 个经纪全部转付费（$2,548）的量级，且只需 3 次对话。

### B. A 也无反应：降到维持态，**但不要关**

- **DLD 数据管道是真资产且不过期**；战后市场恢复时重建成本很高
- 维持成本 = 服务器 + 数据同步任务；**停止一切功能开发**
- 性质：**保留期权，停止投入**

### C. 用省下的时间补上唯一缺失的能力

**与陌生付费方对话。**
这在迪拜（有合伙人、有数据、有产品）都没完成；换到零人脉的新行业**只会更难，不会更容易**。

### 明确不做

| 方向 | 否决理由 |
|---|---|
| lead 生成工具 | 上游供给为空（1.2） |
| C 端付费投放 | 该品类全球对买家免费 + 需求塌陷期逆风 |
| 任何新功能 | 24 张 `lt_*` 表，外部人只碰过地图和房源 |
| tour 改造成 C 端产品 | 服务的仍是腰斩的二手市场 |

---

## 4. 元判断（最重要的一条）

> 现有 3 个候选方向（C 端 / 经纪 lead / 开发商），**三个都只用代码试过，没有一个用嘴试过。**
>
> 一个月后的零付费结果，**不会**告诉你「该换方向」——
> 它告诉你的是：**过去三个月的验证方式本身是错的。**
> 写代码验证不了「谁愿意给钱」，只有对话能。

这与 `2026-07-18-solo-founder-next-project-decision.md` 第 12 节的结论完全一致：
> **真正的瓶颈不是选哪个市场，而是「从未和陌生客户对话」这个动作本身。换赛道解决不了它。**

---

## 5. 复现查询

```bash
cd backend

# ⭐ lead 供给质量判定（否决 lead 工具的决定性查询）
npx ts-node -T scripts/db-query.ts "SELECT count(*) FILTER (WHERE ev>=3) deep_sessions, count(*) FILTER (WHERE days>=2) returning_sessions, count(*) total FROM (SELECT session_id, count(*) ev, count(DISTINCT created_at::date) days FROM app_events WHERE user_email IS NULL AND created_at > now()-interval '30 days' GROUP BY 1) t"

# 匿名会话的房源浏览深度
npx ts-node -T scripts/db-query.ts "SELECT count(*) sessions_with_property, sum(pv) property_views FROM (SELECT session_id, count(*) FILTER (WHERE event_type='property_view') pv FROM app_events WHERE user_email IS NULL AND created_at > now()-interval '30 days' GROUP BY 1) t WHERE pv>0"

# CRM 实际使用量
npx ts-node -T scripts/db-query.ts "SELECT count(*) total, count(*) FILTER (WHERE created_at > now()-interval '30 days') new_30d, count(DISTINCT agent_id) agents FROM lt_clients"

# leads 表构成
npx ts-node -T scripts/db-query.ts "SELECT count(*) total, count(*) FILTER (WHERE created_at > now()-interval '30 days') new_30d, min(created_at)::date first, max(created_at)::date last FROM leads"
```

---

**相关**：`2026-07-24-feature-usage-reality-and-cend-vs-bend-debate.md`（同日，使用量分布）· `2026-07-18-market-reality-and-strategic-options.md`（市场口径）· `2026-07-18-solo-founder-next-project-decision.md`（元结论）
