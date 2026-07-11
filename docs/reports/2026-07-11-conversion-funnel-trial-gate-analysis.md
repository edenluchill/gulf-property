# 转化漏斗分析：「试用必须绑卡」是不是挡死经纪的元凶？

日期：2026-07-11
数据源：生产库（app_events / user_profiles / lt_agents / lt_subscriptions / plan_change_log / api_calls / anon_map_usage）
口径：过去 30 天，已排除内部号（lzp6529@gmail.com / lzp6529@hotmail.com / shelldubai26 / edenlu1995 / realtorgptapp / demo-agent / tczhulei2001）

## 结论先说

**老板的假设不成立。绑卡门槛没挡死经纪——因为压根没有经纪走到那扇门前。**

过去 30 天 716 个独立访客，只有 **12 个人看见过定价页**。而这 12 个人里有 2~3 个开了试用——定价页→试用的转化率约 **20%，这是个健康的数字**。

真正的断点在漏斗最顶端：**716 → 36 个点开登录页（5%）**。绑卡是漏斗第 7 层的事，我们在第 2 层就漏光了。

## 主漏斗（30 天）

| 步骤 | 独立访客 | 相对上一步 | 相对总量 |
|---|---|---|---|
| 独立访客 | 716 | — | 100% |
| 落地首页 `/` | 520 | 73% | 73% |
| 打开地图 `/map` | 69 | 13% | 9.6% |
| 看到经纪入口 `/agent/join` | 27 | — | 3.8% |
| 打开登录页 `/login` | 36 | — | **5.0%** |
| 真的走了 OAuth `/auth/callback` | 18 | 50% | 2.5% |
| 到达选角色页 `/choose-role` | 22 | — | 3.1% |
| **看见定价页** | **12** | — | **1.7%** |
| 到达 billing 页 | 6 | 50% | 0.8% |
| **开出试用订阅** | **2~3** | **~20%** | **0.3%** |

`/agent/join` 这条支线单独看：**27 人看了经纪落地页 → 只有 5 人去了定价页 → 2 人到 billing**。经纪落地页到定价页掉了 81%。

## 注册与角色（user_profiles，全表仅 11 行）

| 角色 | 总计 | 近 30 天 | 近 7 天 |
|---|---|---|---|
| buyer | 6 | 6 | 6 |
| agent | 5 | 5 | 1 |
| agency / developer | **0** | 0 | 0 |

剔除内部号后，30 天内**真实外部注册只有 4 人**：3 个 buyer（elaine.zhu09、w1367750325、nankefei）+ **1 个 agent（slavynchuk94@gmail.com）**。

agency / developer 角色**开天辟地没有一个人选过**。

## 订阅现状（lt_subscriptions 全表 5 行）

| 邮箱 | plan | status | 绑了 Stripe | created_at | 性质 |
|---|---|---|---|---|---|
| realtorgptapp@gmail.com | rookie | trialing | 是 | 2026-07-10 | 疑似内部小号 |
| **slavynchuk94@gmail.com** | rookie | trialing | 是 | 2026-07-10 | **唯一真实外部试用** |
| lzp6529@gmail.com | rookie | trialing | 是 | 2026-07-09 | 我自己的测试 |
| shelldubai26@gmail.com | agent | active | 否 | 2026-06-27 | 手动 comp |
| edenlu1995@gmail.com | agent | active | 否 | 2026-06-27 | 手动 comp |

**关键事实：30 天内唯一一个选了 agent 角色的真实外部用户（slavynchuk94），当天就开了试用。agent 角色 → 试用的转化率是 1/1 = 100%。**

绑卡没有挡住他。我们只是没有第二个他。

`plan_change_log` 近 90 天只有 3 条，全是 `trial_started`，无一条 downgrade / cancel / 试用中断 —— **没有任何人在绑卡页放弃后留下痕迹，因为没人到过那里**。

## Gating 拦截：几乎为零

| 拦截类型 | 30 天次数 | 独立访客 |
|---|---|---|
| **402（额度耗尽 / 付费墙）** | **1** | **1** |
| 429（mapMeter 限时等） | 43 | 9 |
| 401（未登录） | 55 | 49 |
| 500 | 7 | 2 |

匿名地图 10 分钟/天上限，撞顶的人数（按天）：

| 日期 | 当日匿名用户 | 撞顶 | 撞顶率 |
|---|---|---|---|
| 07-11 | 197 | 15 | 7.6% |
| 07-10 | 140 | 11 | 7.9% |
| 07-09 | 87 | 2 | 2.3% |
| 07-08 | 83 | 8 | 9.6% |
| 07-07 | 101 | 3 | 3.0% |

**402 在 30 天里总共只触发过 1 次。付费墙不是瓶颈——它几乎从未被碰到。** 地图限时撞顶率 ~8%，是唯一有点体量的 gating，但撞顶的人也没转化成注册。

## 经纪角色用户的使用深度：选完角色就走了

所有 lt_agents（含内部）的产出：

| 邮箱 | Luna 会话 | 报告 | 报价单 | 客户 | app_events |
|---|---|---|---|---|---|
| slavynchuk94（真实外部 agent） | 0 | 0 | 0 | 0 | 21 |
| carinachen39 | 0 | 0 | 0 | 0 | 39 |
| nankefei | 0 | 0 | 0 | 0 | 49 |
| elaine.zhu09 | 0 | 0 | 0 | 0 | 100 |
| lzp6529（我） | 0* | 2 | 7 | 1 | 5045 |
| shelldubai26 | 0* | 1 | 2 | 0 | 1319 |

\* `luna_sessions.user_email` 恒为 NULL（sendBeacon 带不了 auth，已知问题），Luna 使用需按 visitor_id 归因：30 天全站 36 场 Luna 会话 / 9 个独立访客。

**唯一的真实外部经纪：开了试用，然后 21 个事件，0 报告、0 报价单、0 客户、0 Luna。他绑了卡，进来了，然后什么也没做就走了。**

这比绑卡问题严重得多——**我们有个激活（activation）问题，不是获客定价问题**。

## 埋点缺口（必须先补，否则永远猜）

`app_events` 30 天全量事件类型只有 15 种：

`page_view, area_detail, property_view, tab_switch, search, api_error, luna_open, luna_close, auth_signed_out, auth_failure, image_view, share_action, contact_attempt, report_action, favorite_toggle`

**没有任何一个 pricing / upgrade / checkout / paywall / quota / plan_select 事件。**

也就是说：老板问「绑卡页有多少人跑掉」——**这个问题目前在数据上无法回答**，我只能用 `page_view` 的 path 去反推。要真正验证定价假设，必须在 `track.ts`（AppEvent 白名单）+ `eventIngest.ts`（ALLOWED_EVENTS）两处补：

- `pricing_view`（含来源）
- `plan_select`（选了哪档 / 月付年付）
- `checkout_start`（点了「开始试用」→ 跳 Stripe 前）
- `checkout_abandon` / `checkout_success`
- `paywall_hit`（402 时前端主动打点）

其中 `checkout_start` → `checkout_success` 之间的差值，才是「绑卡到底吓跑多少人」的唯一真实答案。

## 顺手发现的两个 bug

1. **`/undefined` 路径有 19 个独立访客的 page_view** —— 前端某处路由拼接出 `undefined`，19 个真人撞到了。
2. **404 出现 1108 次但只来自 1 个 visitor** —— 疑似爬虫或某个死循环重试。

## 我认为的漏斗断点排序

1. **顶端获客/定位（占掉 95% 的流失）**：716 个访客里 689 个从没看见过经纪入口。首页 520 人落地，只有 27 人走到 `/agent/join`。网站现在讲的是「买家看房」的故事，经纪根本不知道这是给他们的产品。
2. **经纪落地页 → 定价页掉 81%**（27 → 5）。落地页没能说服人往下走。
3. **激活**：唯一进来的经纪，绑了卡，0 产出。产品没在第一次会话里让他做出一份东西。
4. **绑卡门槛：目前无证据，且样本量为 1 时它的转化率是 100%。** 在补齐 checkout 埋点、并且把定价页月访问量从 12 拉到 100+ 之前，讨论要不要去掉绑卡是没有意义的——那是在优化一个每月只有 12 个人经过的房间的门把手。

## 建议动作

- **别动绑卡。** 现在改它，你既没有 before 基线也不会有 after 信号。
- **先补 checkout 漏斗埋点**（上面 5 个事件），成本半天，之后任何定价讨论才有数据。
- **把火力放在顶端**：首页 / `/agent/join` 的经纪价值主张、流量来源。让定价页的月访问量先到三位数。
- **修 `/undefined`**（19 个真人撞到）。
- **激活**：给新经纪一条「30 秒内产出第一份报价单」的引导路径。唯一的付费试用者 0 产出，这是留存的定时炸弹——他 7 天后大概率不会续。
