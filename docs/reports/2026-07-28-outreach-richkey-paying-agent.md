> ## 🔴 结果回填（2026-08-18 补，原文写于 2026-07-28）
>
> **这封信发出去了 —— 2026-07-29，连同另外 15 封一起。不是「未发送的草稿」。**
>
> **她回信了**（2026-07-29 05:48，全站唯一一封回信）：
>
> > Dear Eden,
> > Your program is very good!
> > Just update it more as not everything is there unfortunately. **Can't find many off plan projects or area.**
> > **Would be great if we can type an area and it straight away brings you there.**
> > Thank you !
>
> **然后我们回了「你要的功能我做好了」（改进了搜索 + 楼盘从 40+ 增到 100+）—— 她再没回过。**
>
> 按《The Mom Test》这封回信是**三类垃圾数据占全了**：
> 「very good」= 赞美 · 「update it more」= 废话 · 「would be great if」= 点子 + 未来假设。
> 零事实、零承诺。而我们把「点子」直接当需求做掉了，那是书里明确点名的错误动作。
>
> **之后发生了什么**：8/07 她回访 → 一秒内 6 个 API 错误 → 被踢回 /choose-role → 看了眼价格 → 走
> （见 `2026-08-11-why-nobody-replied.md`）。**8/14 她又回来一次，这次零报错，看了价格，还是没买。**
> 订阅 8/17 到期结束。
>
> 👉 最新分析见 `2026-08-18-first-dollar-plan.md`（已按本节修订）。

---

# 唯一付费客户的挽回邮件 —— slavynchuk94@gmail.com (Richkey)

日期：2026-07-28

## 账户事实（DB 实查，非推测）

| 项 | 值 |
|---|---|
| agent_id | `d198d743-4212-40e0-bce5-d73e23bdf44b` |
| email / display_name | slavynchuk94@gmail.com / yaroslava.b@richkey.ae |
| 注册 | 2026-07-10 11:38 |
| 付费订阅 | plan `rookie`（启程版），source `stripe`，`sub_1TrcnuLQ2nIWAGfrKRLkYgWL` |
| 当前状态 | **past_due**（2026-07-28 17:20 更新），period_end 2026-08-17 |
| 另一条订阅 | plan `agent`，source `free_trial`，2026-07-18 开始 → 2026-07-25 canceled |
| **建过的 tour（lt_demo_sessions）** | **0** |
| **客户（lt_clients）** | **0** |
| **积分消耗** | **0 / 200**，credit ledger 空 |
| onboarding_done | true |

## 结论

这是全站唯一真付过钱的客户，**付费 18 天，产品使用量为 0**。
扣款失败只是表象，真问题是从未拿到首次价值（见 `activation-crisis-2026-07-17`）。

**异常信号**：已在付费状态下，7/18 又点了「免费试用」。
付费用户不该需要试用 —— 高度怀疑撞到了付费墙 / 权限锁 / gating 判断错误
（参考 `subscription-past-due-hidden`、`stripe-billing` 的 gating 走 quota.ts）。
这条如果是 bug，同时影响后面 39 个试用账户，必须从这封邮件里问出来。

## 邮件策略

1. 不催款。催换卡 = 让零价值继续收费 → 必然退订且再不回信。
2. 先停扣款再提问，把「回信」和「掏钱」解耦。
3. 先自曝短处（"你付了三周换到零"），这是让沉默用户回信的唯一开场。
4. 三个问题：动机 / 卡在哪（重点问付费墙）/ 是否根本不这么干活。
5. 主动提出帮他手工做一条 tour —— 光问问题救不回从未体验过价值的人。

## 邮件正文（定稿）

写作原则：
- 语气正式、温和，**不要 "it's just me building it" 这类自嗨**；founder 身份只放签名档。
- 开场先感谢 + 明说他的反馈对我们最有价值。
- **不提 tour**（当前不是重心），问整体平台体验和希望下一步做什么。
- **绝不写「你从没建过 tour / 你的卡失败了 / 我已暂停扣款」**——会让人觉得平台在监视他。
  续费问题改成客服式关怀：「快到续费了，付款那边有没有遇到什么问题」。
- 三条编号每条一行 —— ADHD 友好的关键不是字少，是不用决定从哪读起。

Subject: `Thank you — and may I ask for your feedback?`

```
Dear Yaroslava,

Thank you for being one of our earliest subscribers at Pinzos. It
truly means a lot to us, and feedback from users like you is the
most valuable input we get.

If you have a moment, I would really appreciate your thoughts:

1. Overall, how has the platform been for you so far? Anything that
   felt confusing, or anything you wished was there?

2. Is there something you'd like us to improve or build next?

3. Your subscription is coming up for renewal — did you run into any
   trouble on the payment side? If so, just let me know and I'll take
   care of it.

Even a one-line reply would be a great help. Thank you again for
your support.

Warm regards,

Eden
Founder, Pinzos
```

每条的用意：
- 开场是感谢 + 抬高对方，不是质问 → 他不用防着你。
- Q1 整体体验，最容易开口的入口；不点名任何具体功能。
- Q2 「希望我们做什么」——比问「哪里不好」更容易得到真实答案。
- Q3 用续费/付款问题的委婉说法，既能问出卡的问题，也给了不想续的人体面开口的机会。
- "Even a one-line reply" 明确降低回复成本，本身就提回信率。

## 发送前必做

- [ ] 在 Stripe 真的暂停 `sub_1TrcnuLQ2nIWAGfrKRLkYgWL`。信里说停就必须真停，
      否则他转头收到催款邮件，整封信可信度归零。
- [ ] 回信后若确认是付费墙/权限 bug → 立刻查 quota.ts 的 gating 分支，
      past_due 状态下是否把付费用户当成无权限。
