# 值得发反馈邮件的账户名单（2026-07-29）

数据源：`app_events` / `lt_agents` / `lt_subscriptions` / `user_profiles`，
已排除 `healthQueries.ts` 的 `INTERNAL_AGENTS` 内部号。

## 三条铁律

1. **全站没有任何人建过 tour（0 条）** → 邮件里绝不提 tour。
2. **角色不能混用同一封模板**：`buyer` 问「你的客户/续费」全错；`developer` 关心曝光不是带看。
3. **绝不在正文引用后台行为数据**（撞了几次上限、报了几次错）——只用来决定发给谁、问什么。
   见记忆条 `customer-outreach-email-tone`。

## S 档 · 必发（深度使用，反馈含金量最高）

| 人 | email | 角色 | 活跃天 | 事件数 | 订阅 | 为什么 |
|---|---|---|---|---|---|---|
| Lei Zhu | elaine.zhu09@googlemail.com | agent | 15 | 259 | 试用 canceled 7/24 | 用了半个月，试用到期没续但 7/27 还回来用；13 次 api_error |
| tczhulei2001 | tczhulei2001@msn.com | **buyer** | 26 | 509 | 无 | 全站最活跃的人，7/28 仍在用 |
| WW Grace | graceww1110@gmail.com | developer | 8 | 142 | trialing → 8/19 | 8 次 map_gate_hit，需求被上限挡住 |
| Jocelyn Wang | 353199031@qq.com | developer | 7 | 126 | trialing → 8/23 | 7/29 当天仍在用 |
| 刘民敏 | 1758494342@qq.com | **buyer** | 7 | 138 | 无 | 高频看区域数据的真买家 |

## A 档 · 建议发（撞过功能上限 = 需求被挡住）

| 人 | email | 角色 | 订阅 | gate_hits |
|---|---|---|---|---|
| Linli Wang | wanglinli994@gmail.com | developer | trialing → 8/14 | 11 |
| lydia迪拜房产经纪人 | aolydia22@gmail.com | agent | canceled 7/20 | 11 |
| shuchang5681 | shuchang5681@gmail.com | **buyer** | 无 | 11 |
| Summer Tang | 1844763822@qq.com | agent | canceled 7/28 | 7 |
| Nicolloyd Dinham | dnicoley99@gmail.com | **未选角色** | 无 | 7 |
| 13828783446 | 13828783446@163.com | agent | canceled 7/28 | 6 |

## B 档 · 试用即将到期（续费话题最自然）

| 人 | email | 到期 | 备注 |
|---|---|---|---|
| 李加惠 | l13541347198@gmail.com | **7/29（当天）** | ⚠️ 37 次 api_error，全站最多 —— 发信前先查是不是真 bug |
| Monali Patil | monaali.patil@gmail.com | 7/30 | |
| Behyad | behyad677@gmail.com | 8/3 | |
| Rohit Achnoor | rohitachnoor@gmail.com | 8/3 | |

## C 档 · 用过就走（想问「为什么没留下」时再发）

Kermit Lee (kermitlee666@gmail.com)、leining988@163.com、
MM2334 Almashghouni (mjalmashghouni@gmail.com)、Ying Hua (huayingzeng8866@gmail.com)

## 模板三版

基准 = 已发给 slavynchuk94 的那封（见 `2026-07-28-outreach-richkey-paying-agent.md`）。

**① 经纪版** —— 原样，第 3 点按状态替换：
- 试用中：`Your free trial is coming to an end soon — is there anything that would make it worth continuing for you?`
- 试用已过期：`I noticed your trial has ended — was there anything that made you decide not to continue? Honest answer is welcome.`

**② 开发商版** —— 第 1、2 点改为：
```
1. Overall, how has the platform been for you so far — especially
   when it comes to getting your projects in front of agents and buyers?

2. Is there anything you'd like us to improve or build next for
   developers specifically?
```

**③ 买家版** —— 去掉一切「客户/续费」：
```
1. Overall, how has the platform been for you so far? Anything that
   felt confusing, or anything you wished was there?

2. As someone looking at property in Dubai, what would help you most
   in making a decision?

3. Is there anything that stopped you from using it more often?
```

## 节奏

先发 S 档 5 人 → 看回信摸清话术 → 再铺 A/B 档。
一次群发 20 封回信率低且跟不过来。

## 待办

- [ ] 查 l13541347198@gmail.com 的 37 次 api_error 是否真 bug；若是，发信时顺带致歉
- [ ] 查 map_gate_hit 集中的人撞的是哪一道墙（付费墙位置是否过早）
