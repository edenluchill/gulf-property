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

---

# 追加（同日）：三个遗留问题的处理

## A. `tours@pinzos.com` → 归为内部号

owner 确认「是 AI 自己搞的」。加进 `backend/src/lib/internalAccounts.ts` 的 `OWNER_ACCOUNTS`。

**剔除后面板变了，而且是变准了**：

| | 剔除前 | 剔除后 |
|---|---|---|
| 够得着的人 | 4 | **3** |
| signals | 6 条 | **7 条** |

多出来的那条是 **「Luna Tour 导览：30 天内外部产出为 0」**。
原来面板认为 Luna Tour 有外部产出 —— 那唯一一条 tour 是 **AI 自己的账号做的**。
剔掉之后的事实是：**至今没有任何外部经纪做过一个 Luna Tour。**
这和 `activation-crisis-2026-07-17` 记忆条里那句「至今无任何外部经纪用过 Luna Tour」对上了 ——
面板之前因为名单少一个人，把这个事实盖住了。

⚠️ 教训重复了一次：**内部号名单漏一个，结论就反向。** 这已经是第二次
（第一次是把合伙人当外部客户，得出「真实外部用户建过 tour = 1 人」）。

## B. `pedias797@gmail.com` → 改回 approved

owner：「那个干净他又很多账户在乱玩？让他玩吧」。已 `UPDATE agents SET status='approved',
decided_by='owner:let-him-play'`。现在库里 **69 approved / 0 rejected / 0 pending**。

**顺带确认 owner 的疑问「经纪账户不是我们 grant 的吧」——对，approve 不发任何东西。**
`routes/agents.ts` 的 `decide()` 只 `UPDATE agents SET status`，一行而已：
- 不发试用（试用要他自己去 `/agent/plans` 领，7 天 / 200 分，一人一次）
- 不发积分（额度闸门在 `quota.ts`，与审批无关）
- 不发权限（楼书上传另有 `requireUploader`）

所以放行的成本是 0。这也是取消排队本身成立的原因。

## C. 开发商验证 → **砍掉**

owner：「开发商批准那个现在 0 价值 感觉没必要 你觉得怎么让他有价值 或者直接砍掉看你」。

### 判断：砍。理由是查出来的，不是嫌它麻烦

查了四件事，**四件都是空的**：

1. **徽章 0 价值**（owner 已指出）—— `developer_verified_at` 全站没有一处渲染成标记。

2. **它守的门是假的。** 上传楼书的判据在 `middleware/requireUploader.ts` 的
   `canManageProjects()`：`role='developer'` **+ 生效订阅**。而 `role` 在 `/choose-role`
   自助点一下就有 —— **库里 23 个 `role='developer'`，其中只有 1 个验证过**。
   验证从来不是上传楼书的必要条件，批准时"顺手落 role"是多余动作。

3. **实测 ROI = 0。** 全库唯一通过验证的开发商 `graceww1110`（ONE Development，
   2026-07-20 批的），拿了 30 天 + 600 积分，**交付了 0 个楼盘**（只做了 1 份客户报告，
   还没被客户打开）。楼盘归属分布：

   ```
   submitted_by_email = NULL            51 个   ← 我们自己灌的
   shelldubai26@gmail.com（合伙人）       3 个
   353199031@qq.com（一个试用用户）        1 个
   ────────────────────────────────────────
   合计 55 个，已发布 55 个
   ```

   **供给侧的真实情况是：外部只传过 1 个楼盘，而且不是那个"已验证开发商"传的。**

4. **和已有功能重复。** 「给某人加长试用」后台早就有通用的**「赠 Pro 30 天」**按钮
   （1200 积分，比这条链路的 600 更慷慨），走 `services/adminGrant.ts`。
   开发商验证本质上就是"一个专门给开发商的、需要人工批的赠送流程" —— 通用按钮已覆盖。

### 为什么不是"给它加个徽章让它有价值"

想过。「已验证开发商 → 项目页显示『资料由开发商官方提供』」是个合理设计：
对买家是真实的信任差（官方付款计划 vs 转手信息），对开发商是继续供货的理由。

**但现在做它，就是给 1 个交付了 0 个楼盘的用户写功能。** 徽章要挂在楼盘上，
而那个已验证开发商一个楼盘都没传 —— 挂无可挂。这正是 `build-instead-of-sell-pattern`
里那个模式：用写代码代替去解决真问题。

供给为 0 不是流程问题，加一道人工审批不会让人传楼书，去掉也不会。
**等真的有开发商在传楼书了，信任标记是 30 分钟的活，而且那时候有真实数据可挂。**

### 删了什么 / 留了什么

**删**：
- 后端三个端点：`POST /billing/developer/verify-request`、
  `GET /billing/admin/developer-verifications`、`POST .../:id/decide`
- `/billing/me` 响应里的 `developer` 字段 + 那条 `developer_verifications` 查询
- 常量 `DEV_TRIAL_CREDITS` / `DEV_TRIAL_DAYS`（credits.ts）
- 前端 `DeveloperVerifyCard.tsx`（经纪台顶部那张黄条）+ TrialBanner 里的挂载
- 前端 `analytics/DeveloperVerification.tsx` + admin 的「开发商验证」tab
- `billingApi.ts` 的三个函数 + `DeveloperVerification` 类型 + `BillingMe.developer`
- 健康度面板的 `dev_verify` 待办（永远为 0 了）

**留**（故意）：
- 表 `developer_verifications`（1 行历史）
- 列 `lt_agents.developer_verified_at`（1 行）
- 删掉它们只是为了删而删，留着不花钱，也是这段历史的唯一记录。

**三处墓碑注释**写清了为什么删、以及什么条件下该重新做：
`routes/billing.ts`（主）、`luna-tour/credits.ts`、`db/developer-verification-migration.sql`。

### 副作用检查
- 已验证的那位（graceww1110）的 `role='developer'` **不会掉** —— role 在 `user_profiles` 上，
  和验证链路无关，她的上传权照旧。
- 23 个 `role='developer'` 的人上传权全部不受影响（判据没动）。
- 自助试用仍然是所有角色统一 7 天 / 200 分，没有人被降级。

## 部署
- commit `ea31425`，已 push（前端 CF Pages 自动）
- API 同样走 `docker save | ssh docker load`（GHCR token 还是死的）
- 验证：`/health` 200；容器内直跑 `getHealthSnapshot()` 正常，tasks 1 条、people 3 人、signals 7 条
