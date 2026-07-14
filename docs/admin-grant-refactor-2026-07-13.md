# 后台「授予」改造:永久 comp → 一次性 30 天试用(2026-07-13)

## 为什么改

后台「订阅」tab 的「授予…」下拉,点一下就插一条 **100 年期**的 comp 订阅行
(`routes/agents.ts`,`now() + interval '100 years'`)。三个问题:

1. **发出去就收不回**。100 年 comp **没有任何过期清理** —— `freeTrialSweep` 和
   `credits.planFor` / `mapMeter.agentNeedsPlan` 里的即时过期谓词**都只作用于
   `source='free_trial'`**。comp 行不在任何清理路径上,等于永久免费。
2. **能反复发**。同一个人可以被授予无数次,没有任何"一人一次"的约束。
3. **审计查不了**。操作人只塞在 `reason` 的 `manual by xxx` 字符串里,不是列。

## 现在的行为

一个按钮:**「赠 30 天」**。每人**只能一次**、固定 **30 天 / 1200 分**(专业版满月额)。

- 走 **`source='free_trial'` 行** → 到期 `freeTrialSweep` 自动翻 `canceled`,
  钱的两道门(credits / mapMeter)另带即时过期谓词,不等 sweep。
- 发 **agent(Pro)档**:实时带看 / Luna 导览的 `minPlan` 就是 `agent`,
  发低了旗舰功能试不到,试用等于没试。
- **名额记账**:`lt_agents.trial_granted_at` / `trial_granted_by`。
  与自助领取戳 `free_trial_started_at` **刻意分开** —— 自助领过 7 天的人,
  后台仍应能再赠一次 30 天(今天这批经纪就是这种情况)。
- **审计**:`plan_change_log.actor_email`(新增一等列)+ action `trial_granted`。
  UI 上「已赠 7/13 · lzp6529」直接写在那一行,鼠标悬停看完整时间和操作人。
- **撤销不退还名额**。一人一次就是一次(真要退回,直接改 DB)。
- **已有付费 / 存量永久 comp → 拒绝赠送**,绝不覆盖人家的订阅。

## 存量怎么办

**永久 comp 行保留不动**(owner 决定):`shelldubai26@gmail.com`、`edenlu1995@gmail.com`,
到期 2126 年,是自己人/合伙人。只移除「再发永久」的能力。他们有生效订阅,
新逻辑会直接拒绝重复赠送。审计里旧的 `comp_granted` 标签改叫「手动赠送(旧·永久)」,
用琥珀色标出来 —— 一眼看得出哪些是历史遗留。

## 并发安全

防重复授予 = **原子占位**(和 `services/freeTrial.ts` 同款):

```sql
UPDATE lt_agents SET trial_granted_at = now(), trial_granted_by = $2
 WHERE id = $1 AND trial_granted_at IS NULL RETURNING id
```

单条语句 → 行锁天然互斥,并发双击只有一个拿得到行。**占位必须在所有业务检查之前**:
若先查「有没有生效订阅」再占位,并发时输家会撞到那个检查而不是「已赠送过」,
结果取决于线程时序。**占位后任何校验失败必须把戳退回去**,否则他占了名额却没拿到试用。

## 叫什么

**不叫「30 天」** —— 听着像随便送几天。叫 **「经纪 Pro 30 天免费套餐(1200 积分)」**:
它给的是完整一个月的专业版,实时带看 / Luna 导览全开。前端 `GRANT_NAME` / `GRANT_SHORT`
一处定义,按钮 / 确认弹窗 / 已赠标 / 审计记录同源。

## 列表 UI(2026-07-13 二次修)

- **列宽全部固定**。原来 credit 列左右横跳,根因**不是 credit 列自己** —— 是
  **操作列没定宽**:它的内容宽度随状态差很多(「赠 Pro 30 天」按钮 vs
  「已赠 … + 撤销」),把左边所有列一起推歪了。套餐/额度/到期/操作各自定宽后才齐。
  数字一律 `tabular-nums` + 定宽右对齐(1200 和 200 的行才对得上)。
- **手机版重做**。原来套餐/额度/到期在手机上**全部 `sm:hidden`** —— owner 在手机上
  根本看不到谁快用完积分、谁快到期,操作按钮还挤成一团。现在是两层卡片:
  第一层身份,第二层专门放套餐·额度·到期·操作,触摸目标加大。
- **赠送前必须确认**。赠送一次性、不可逆(撤销也不退名额),而列表里相邻行的按钮
  离得很近(手机上尤其容易点错人)。确认弹窗写清:赠给谁、邮箱、赠的是什么、
  一人一次不退还。弹窗 `createPortal` 到 body(铁律:祖先有 transform/backdrop-filter
  时 fixed 会相对祖先定位)。
- **已赠标带上完整信息**:赠了什么 + 谁赠的 + 何时,不用再去翻记录。

## 改动清单

| 文件 | 改动 |
|---|---|
| `backend/src/db/admin-grant-trial-migration.sql` | 新增 `lt_agents.trial_granted_at/by`、`plan_change_log.actor_email`;回填历史 |
| `backend/src/services/adminGrant.ts` | **新增** — 授予/撤销的单一入口 |
| `backend/src/routes/agents.ts` | `POST /:email/plan` 变薄;**删掉 100 年 comp 分支**;兼容旧前端(老的 `{plan:'founder'}` 一律当 grant_trial,绝不再发永久) |
| `backend/src/services/adminBizQueries.ts` | subscribers 带出 `trial_granted_at/by`;**顺手修**积分列显示(试用池是 `trial_credits`,不是套餐月额 —— 领 200 分的人原来被显示成 `0/1200`) |
| `backend/src/routes/billing.ts` | 审计查询带出 `actor_email` |
| `backend/scripts/verify-admin-grant.ts` | **新增** — 真库回归,27 项断言,自清理 |
| `backend/scripts/extend-trial.ts` | 命令行发试用也写 `trial_granted_at` 记账 |
| `frontend/.../AgentApprovals.tsx` | 下拉 → 「赠 30 天」按钮 / 「已赠 7/13 · 谁」/ 撤销;失败弹原因 |
| `frontend/src/lib/agentApi.ts` | `setAgentPlan` → `grantAgentTrial` + `revokeAgentGrant` |

## 回归测试

**改授予/订阅逻辑后必跑**(真库跑完整生命周期,自清理,不碰真实用户):

```bash
cd backend && npx ts-node -T scripts/verify-admin-grant.ts
```

覆盖 27 项:新人赠送成功(30天/1200/free_trial/plan=agent/记操作人/审计)、
再赠拒绝、**并发 5 次只 1 次成功**、已有 comp 拒绝且**名额退回**、
自助领过 7 天的人仍能赠 30 天(换掉旧行不并存)、撤销停订阅但**名额不退**。
