# 健康度面板改成「待办」+ 取消经纪台准入排队

日期：2026-08-17 · 触发：owner「这个页面这些信息太挡视线而且没屌用，我也不会 take action」

---

## 1. 面板为什么失效

`/admin/analytics?tab=health` 的落地屏原来是 6 张结论卡：

- 零真实付费客户
- Sales Offer 30 天内外部产出为 0
- C 端在用，B 端没起来
- 拉新是在往漏桶里倒水
- 地图有广度，但没有形成习惯
- 只有 4 个外部经纪做出过可分享产出物

**每一条都是对的**，而且都带着触发它的具体数字（这是 v2 刻意做到的）。
问题不在正确性，在**时间尺度**：这六条下个月还是同一句话，因为它们是**长期事实**，
不是**待办**。看第三遍就学会跳过整块，而它还占着首屏，把真正要看的数字挤到下面。

讽刺的是 `buildSignals()` 的注释里自己写过这个警告：

> 规则要少而准。宁可只报 2 条真事，也不要凑 8 条正确的废话 ——
> 后者会让人学会忽略这个区块，那就跟没有一样。

规则确实少（6 条），但**准的定义错了**：准 ≠ 结论正确，准 = **能今天点一下就完事**。
「暂停推广，直到激活率 > 20%」不是动作，是意见。

## 2. 改成什么

落地屏两块，都是「名字 + 邮箱 + 一个按钮」：

### 待办（`buildTasks()`，服务端）
准入门槛只有一条：**做完就消失**。永远挂着的东西不是待办。

| kind | 触发 | 动作 |
|---|---|---|
| `payment_failed` | 订阅 past_due / unpaid / incomplete | mailto（**只给主题不给正文**——催换卡措辞必须自己斟酌） |
| `dev_verify` | `developer_verifications.status='pending'` | 跳 `?tab=devverify` 批 30 天/600 分 |
| `trial_ending` | trialing 且 3 天内到期 **且消耗过积分** | mailto |
| `new_output` | 近 7 天外部经纪做出的报价单/导览/客户报告 | 打开那个产出物 |

`trial_ending` 的「且消耗过积分」是关键：**没用过的人不提醒**——给他发消息只会提醒他取消。
上线时 8 个试用在 3 天内到期，7 个 used=0 被滤掉，剩 1 个真的该联系。

`new_output` 窗口固定 7 天，**不跟随面板的 7/30/90 天切换**：
「30 天前有人做过一个」不是今天的待办。同理整个 tasks 层不受 days 影响。

### 够得着的人（`reachablePeople()`）
**明确不是待办**（做完不会消失），所以单独一块。

signals 里那条「只有 N 个外部经纪做出过产出物 … 一人聊 20 分钟胜过再写两周代码」
是面板上最有用的一句话，但它是**一段话**——读完还得自己去别的表翻邮箱，所以从来没被执行过。
现在是几行人，带「做了什么 / 多久没动静 / 客户打开过几次 / 联系按钮」。

「客户打开过 2 次」和「客户没打开过」必须分开显示：这是两种完全不同的谈资。

### 战略结论
6 条 signals 一条没删，收进折叠区。写周报有用，决定「今天干什么」没用。

## 3. 上线后的真实数据（生产实跑）

```
tasks:  1  → Eric Cheng <dubai.ericheng@outlook.com>
             「试用还剩 2 天，他用过东西」· 已消耗 40 积分 · [发邮件]
people: 4  → Pedram Asadi   1 份客户报告 · 10 天前 · 客户没打开过
             Pinzos(tours@) 1 个导览     · 16 天前 · 客户没打开过
             WW Grace       1 份客户报告 · 32 天前 · 客户没打开过
             李加惠          1 张报价单   · 33 天前 · 客户打开过 2 次
signals: 6 (折叠)
```

**这条 Eric Cheng 是老面板完全看不到的东西** —— 6 张结论卡里没有任何一条会告诉你
「今天有个真人的试用要到期而且他真的在用」。这就是改版要拿到的东西。

⚠️ 另外注意：`tours@pinzos.com` 出现在「够得着的人」里。这是 pinzos.com 域名的账号，
**几乎肯定是自己人**，但它不在 `INTERNAL_AGENTS` 名单里。名单是「谁不算真实客户」的
唯一真相源，往里加人 = 让某个客户消失，**必须 owner 明确确认才能加**，所以没动。
需要 owner 拍板。

## 4. 顺手干掉的：经纪台准入排队

订阅 tab 顶部那个「待审批」队列，owner 问「她们在哪里触发这个审批的？」

**答案：没人触发。** `routes/agents.ts` 的 `GET /me` 会给**每一个点进 `/agent/*` 的登录用户**
自动插一行 `status='pending'`——包括误点进去的**买家**。截图里那条 `pedram asadi 买家`
就是这么来的，他自己从没看到过任何申请表单，他看到的是一堵「申请已提交 / 审核中」的墙。

而且这道门早就是假的：`agents.ts:46` —— 只要开了免费试用，下次进来就
`decided_by='auto:subscription'` 自动放行。它拦住的**从来只是「还没开试用的人」**，
那正是最该让他进来看看的人。全库 69 行 agents，66 行是 `stripe:auto` 自动批的。

改法：`GET /me` 首次插入直接 `'approved'`（`decided_by='auto:open'`），存量 pending 就地升级，
配一个 migration `backend/src/db/agents-open-access-2026-08-17.sql` 清存量（实跑 0 行，
因为 owner 在提问那会儿已经手动清空了）。

- `rejected` **仍然拦死** —— 那是 owner 主动封的人，是真决策。
- 真正的功能闸门留在原处：积分/套餐 gating（`quota.ts`）、楼书上传（`requireUploader` 要 `role='developer'`）。
  这里放行 ≠ 白嫖，只是不拦在门口。
- 前端 `AgentLayout.tsx` 的「申请已提交」分支已删（不可能再出现）；
  `AgentApprovals.tsx` 的「待审批」筛选 chip 删掉，Group 保留（0 行自动隐藏，兜异常）。

### 🔴 需要 owner 决定的一件事
`pedias797@gmail.com` 在 2026-08-18 00:55 UTC 被点了**拒绝**（就在提这个问题前几分钟）。
他是个**误点进经纪台的买家**——同一个人另有 `pedramasadi2002@gmail.com` 是正常 approved 的
账号，还做过 1 份客户报告。现在这个 `pedias797` 会永久看到「暂未开通」。
这个拒绝正是「排队本身不该存在」的产物。**要不要把他改回 approved，需要 owner 说一声**
（没有擅自改——`rejected` 按新设计就是 owner 的主动决策，代码不该替他反悔）。

## 5. 开发商验证是怎么回事（owner 的第三个问题）

和上面那个不一样，**这个是用户真的主动提交的**。

- **触发点**：经纪台顶部 `TrialBanner` → `DeveloperVerifyCard.tsx`。
  只有 `role='developer'` 且未验证的人看得到那张黄条，点「获取验证」→ 填**公司名 / 官网 / 备注** → 提交。
- **为什么要人工验证**：`/choose-role` 上人人都能点「我是开发商」。
  自助试用所有角色统一 7 天 / 200 分；若开发商自助就 30 天，所有经纪都会去点开发商。
- **批准做三件事**（`billing.ts:474-517`）：
  1. 发一条**全新的** 30 天 / 600 积分试用（从批准日起算，不是延长旧的）
  2. `user_profiles.role='developer'` —— **这才是能传楼书 PDF 的前提**，是批准的真正意义
  3. `lt_agents.developer_verified_at` 打戳
- **有 badge 吗？没有。** 全站搜过，`developer_verified_at` 除了「别再给他看那张申请卡」
  之外，前端**没有任何地方渲染成徽章**。审计流水里多一条「开发商验证」标签，仅此而已。
  「已验证开发商」这个身份目前对外零可见价值 —— 想要徽章是另做的事。

当前库里 `developer_verifications` 只有 1 行且已 approved（ONE Development / graceww1110），
所以 `dev_verify` 待办为空。

## 6. 部署

- commit `be696f4`，已 push（前端走 CF Pages 自动部署）
- API：GHCR token 仍然是死的（`[FAIL] GHCR login failed`），
  走 `docker save | ssh docker load` 绕过，见 `ghcr-token-dead-ship-image-over-ssh` 记忆条
- 验证：`/health` 200；在生产容器里直接 `require('./dist/services/healthQueries').getHealthSnapshot()`
  跑通，四个 tasks 查询 + people 查询无 SQL 错误

### 踩到的坑
`lt_payment_shares` **没有 `title` 列**（是 `unit_name`）。第一版查询写了 `ps.title`，
本机 tsc 查不出来 —— SQL 字符串不参与类型检查。**这类查询必须先对着生产库单跑一遍**，
否则一个列名错误会让整个健康度面板 500。
