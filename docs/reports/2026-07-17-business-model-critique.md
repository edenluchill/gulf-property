# 商业模式评估：客户选择与单位经济

日期：2026-07-17
前置报告：`2026-07-17-usage-analysis-vs-saas-benchmarks.md`

---

## 0. 对前一份报告的重要更正

前一份报告称"`area_detail` 127 人 / 3295 次，地图是唯一被真实使用的功能，数据在为地图方向投票"。

**这个结论是错的**，因为 3295 次里 **2061 次来自 owner 自己的账号**（`lzp6529@gmail.com`）。

剔除自己人后的真实分布：

| 用户 | area_detail | 活跃天数 |
|---|---|---|
| shelldubai26@gmail.com | 292 | 17 |
| tczhulei2001@msn.com | 72 | 8 |
| nankefei@gmail.com | 38 | 1 |
| 其余全部 | <20 | 多数 1 天 |

匿名访客：992 个 identity，**日均地图停留 2.8 分钟**（免费额度 10 分钟/天，`map_gate_hit` 仅 12 人触发）。

**结论修正：深度使用过任何功能的外部用户 = 2 人。地图同样未被验证。**

> 教训：任何"哪个功能受欢迎"的判断，必须先排除 owner/demo/内部账号。
> 见 [[analytics-internal-exclusion]] —— 该规则已存在于聚合查询中，但临时分析查询忘了套用。

---

## 1. 商业模式是否错了

**严格答案：尚不可知，实验没跑过。**

49 个注册多数来自单次社群推送，992 个匿名访客平均停留 2.8 分钟。这是"未测试"，不是"已证伪"。n=2 不足以否定或肯定任何模式。

**但有一个不依赖更多数据的结构性问题：**

### 1.1 算术在 100% 转化下都不成立

```
现有 52 注册全部转付费 Agent：52 × $49 = $2,548/月
```

覆盖得起基础设施，但不构成生意。

达到 $10k MRR 所需：
- 需 ~204 个付费 Agent
- 按行业现实转化（激活 35% × 试用转付费 9% ≈ 3.2%）倒推 → **~6,500 个注册**
- 迪拜 RERA 持牌经纪总量约 2-3 万（⚠️ **此数字待核实**）
- 即需拿下全城 **20-30% 的经纪**

### 1.2 定价表里已经有答案

| 计划 | 月价 (USD) | 当前客户 |
|---|---|---|
| Starter (rookie) | $25 | 0 |
| **Agent** | **$49** | **1** |
| Agency (founder) | $699 | 0 |
| **Developer** | **$999** | **0** |

**1 个 Developer 客户 = 20 个 Agent 客户。**

全部工程投入押在单价最低、付费意愿最弱、决策最慢的一档上。单价 20 倍的两档至今零次销售对话。

个人经纪作为 SaaS 客户的已知结构性问题：付费意愿低、流失率高、工具预算通常由 brokerage 而非个人承担。

### 1.3 流量与收费错位

- 992 匿名访客（大概率买家/投资人）
- 49 注册经纪（收费对象）

**流量在买家侧，收费在经纪侧。**

这未必错（经纪确实是付钱方），但需明确选择：
- **A：卖工具给经纪** — 当前路径，单价低、市场容量有限
- **B：聚合买家，把 lead 卖给经纪/开发商** — Developer $999 实际上就是这条路

现在产品同时在做两件事，两边都不深。

---

## 2. 首页漏斗（绝对值最大漏点）

```
727 人落地 /
 → 87 人到 /map        (12%)
 → 49 注册
 → 2 个深度使用
```

匿名落地页分布（30 天）：

| path | pv | uniq |
|---|---|---|
| / | 1367 | 727 |
| /map | 197 | 87 |
| /transactions | 103 | 65 |
| /project/7b323ec3… | 94 | 48 |
| /login | 90 | 65 |
| /undefined | 40 | 40 |
| /about | 40 | 27 |
| /v/demo | 38 | 38 |

⚠️ `/undefined` 有 40 次 40 人 —— 存在路由 bug，需单独排查。

---

## 3. 付费墙从未被测试

- 匿名日均地图使用 2.8 分钟，免费额度 10 分钟/天
- `map_gate_hit` 仅 12 人触发过
- 30 天 `checkout_start` = 1 次

**免费额度相对真实使用深度过于宽松，付费墙实际上从未被触达。**
"地图不赚钱"的准确表述是"地图的收费机制从未被测试过" —— 地图本就包含在 $49 Agent 计划内。

---

## 4. 建议动作（按 ROI 排序）

### 4.1 深挖 shelldubai26（唯一真实用户）
17 天活跃、292 次区域查看、唯一建过 tour 的外部用户。
**不是做 15 分钟访谈，是跟着他工作半天** —— 看他真实工作流、在哪个时刻会想起这个产品、现在的替代方案是什么。
n=1，但这是目前唯一的真信号。

### 4.2 尝试销售 3 个 Developer 计划（零代码改动）
$999/月，成 1 单 = 现有全部收入的 20 倍。
开发商的预算规模与决策链和个人经纪完全不同。
**三次对话即可判断这条路的生死。当前投入产出比最高的动作。**

### 4.3 修首页 727 → 87
后续每段都在漏，但这一段漏掉的绝对人数最多。
同时修 `/undefined` 路由 bug。

### 4.4 停止新功能开发
产品目前"建得比卖得多"。Luna Tour 的运镜/字幕/抖动/i18n 服务的是 1 个用户。
在有 10 个真实付费用户前，每行新功能代码都在赌一个未验证的假设。

---

## 5. 明确不建议

**不要转向做地图产品。**

n=2 支撑不了任何产品方向转型。转向成本极高，而当前证据强度仅为"两个人用过"。
先完成 4.1 和 4.2，拿到真实信号再决定方向。

---

## 6. 待核实事项

- [ ] 迪拜 RERA 持牌经纪总数（本报告用 2-3 万做估算，未验证）
- [ ] `/undefined` 路由 bug 根因
- [ ] 992 匿名访客的流量来源（目前无 referrer 归因，无法判断是买家还是经纪）

---

## 复现查询

```bash
cd backend

# 剔除内部账号后的真实地图使用
npx ts-node -T scripts/db-query.ts "SELECT user_email, count(*) area_views, count(DISTINCT created_at::date) active_days FROM app_events WHERE event_type='area_detail' AND user_email IS NOT NULL GROUP BY 1 ORDER BY 2 DESC"

# 匿名地图使用深度
npx ts-node -T scripts/db-query.ts "SELECT count(DISTINCT identity_key) identities, round(avg(mins),1) avg_min_per_day, max(mins) max_min FROM (SELECT identity_key, day, count(*) mins FROM anon_map_usage GROUP BY 1,2) t"

# 首页漏斗
npx ts-node -T scripts/db-query.ts "SELECT path, count(*) n, count(DISTINCT visitor_id) uniq FROM app_events WHERE event_type='page_view' AND user_email IS NULL AND created_at>now()-interval '30 days' GROUP BY 1 ORDER BY 2 DESC LIMIT 15"

# 各计划付费情况
npx ts-node -T scripts/db-query.ts "SELECT status, source, count(*) FROM lt_subscriptions GROUP BY 1,2"
```
