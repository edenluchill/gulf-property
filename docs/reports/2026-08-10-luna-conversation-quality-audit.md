# Luna 实时对话质量审计 — 2026-08-10

**结论：owner 的判断（"几乎就是垃圾，用一次不想用第二次"）成立。**
但根因不是模型能力，也不是 2026-07-20 那轮修复失效 —— 那轮修的是"数字造假"，
确实不再编 79.9% 年化了。**现在的垃圾感来自角色错位：Luna 被产品说明书和
澄清逻辑挤成了一个既不敢答、又爱讲收费规则的客服。**

## 数据来源

生产库 `luna_sessions`，本机连不上 5432（见 memory `local-db-unreachable-use-ssh`），
走 `ssh root@46.224.149.244 'docker exec -i pinzos-api node'`。

- 90 天共 58 场会话，全部 `user_email IS NULL`（匿名访客）
- 周分布：6/22 峰值 21 场 → 7/27 之后每周 2-4 场
- 8 月 5 场，turn_count = 2, 2, 1, 6, 2（**平均 2.4 轮 = 说一句就走**）
- 90 天复访 visitor 8 个，其中 5 个是同一天内连开（≈重连，不是回访）

## 十场会话逐场实录

| id | 日期 | 时长/轮次 | 用户说了什么 | Luna 回了什么 |
|----|------|-----------|--------------|----------------|
| **54** | 8/2 | 354s / 2 | "I'm looking for **off plan** nearby the area of 2027 **plus payment plan. Plus post hand over payment plan.**" | 「Post-handover payment 是项目详情页 Sales Offer tab 上的功能。你的经纪可以生成 A4 报价单，**收 5 credits，链接 60 天过期**」 |
| 58 | 8/9 | 458s / 2 | 「我怎么样联系客人，怎么样把这个软件发给客人」 | Luna AI Tour 功能说明（对题，但是说明书口吻） |
| 57 | 8/6 | 186s / 2 | （转写丢失） | 问预算/区域/目标 → 「我不确定有没有这种分类功能」 |
| 55 | 8/5 | 400s / 6 | 波斯语，问身份/模型 | 「**我是 Gemini 开发的 AI 模型**」「我的知识截止 2025 年」「我不是 Gemini 里某个特定模型，是他们项目的一部分」——**6 轮零房产内容** |
| 56 | 8/6 | 45s / 1 | （无） | "Hello, how can I help you today?" 然后结束 |
| 53 | 7/29 | **17274s** / 3 | Terra woods / Expo living | 三轮全是澄清：「不认识 Terra woods，你是不是想说 Cherry woods？」「Expo living 也有歧义，是 Dubai Expo City / Living Legends / Madinat Jumeirah Living？」 |
| 52 | 7/26 | 418s / 4 | （转写丢失） | 「我不确定这个功能有没有」→「**抱歉**，我没法直接帮你」→ 自我介绍 |
| 51 | 7/21 | 338s / 2 | 问 Diamond 2 | 「找不到 Diamond 2」→ 补充后 →「**还是找不到**，要不看看迪拜别的项目？」 |
| 49 | 7/21 | 73s / 6 | **经纪在给客户演示**：「客户有什么问题就可以跟这个 AI 说，他就会帮你回答」「比如客人在国内、英国、美国，就可以三方连线」 | 「是的, 我很高兴能帮您解答」→「是的, 我很高兴能为您提供」→ 车轱辘话三连，**两句都断在半截** |
| 47 | 7/20 | 197s / 1 | （转写丢失） | 一段关于"在迪拜能不能自己出租"的泛泛回答，无工具调用 |

**十场里只有 session 54 是一个把需求说清楚的真实买家 —— 他被当成客服工单打发了，没有第二轮。**

## 三个根因

### 1. 产品说明书吃掉了房产顾问的角色 🔴 最致命

`backend/src/routes/voice-token.ts:94-96`：

> ## QUESTIONS ABOUT THE PRODUCT ITSELF
> When someone asks how to DO something in this app … call `explain_feature` with
> their question. **Never answer product questions from memory**

加上 `:92`「You cannot send/email/deliver anything → call `explain_feature`」。

这两条的触发边界太宽。用户一提到 "payment plan"、"发给客人"、"分类"，
就被路由进 `product-guide.ts`（**16 KB**，比整个 system prompt 大得多），
吐出来的是 credits / tab / 草稿 / 60 天过期。

**买家问的是房子，听到的是后台管理手册。** session 54、58、57 全中。

这条规则本身有正当来源（历史上 Luna 否认过产品有 live calling），
但它现在的优先级压过了"找房"这个主职责。

### 2. 7-20 把"自信地说谎"修成了"诚实地反复说找不到"

`AREA_AMBIGUOUS` / `AREA_NOT_FOUND` 落地了（这是对的，是进步），
但 prompt 第 83 行的 `relaxation` 出路只覆盖"空搜索结果"，
**不覆盖"区域没匹配上"**。

结果：51 连续两轮纯澄清，53 连续三轮纯澄清。
用户不会陪你猜第三次 —— 51 和 53 都是这之后直接走人。

从"说谎"变成了"没用"，体感依然是垃圾，只是换了种垃圾。

### 3. 没有身份护栏 + 回复仍被掐断

- **55**：直接报出「我是 Gemini 开发的」+ 知识截止日期。prompt 里
  `## WHO YOU ARE` 只有两行，没有任何"不讨论自身实现"的规则。
- **49**：「我很高兴能帮您解答」断在半截。VAD 那条（`VoiceAssistantContext.tsx`
  的 `START_HIGH + prefixPadding 300ms`，见 memory `luna-voice-quality-root-cause` 根因 4）
  仍未调整。**这场是经纪在向客户演示 —— 最不该出丑的场合。**

## 两个附带发现

- **用户侧转写 8/10 场为空**。`finalizeUserMessage()` 只在
  `VoiceAssistantContext.tsx:851 / :906` 两处调用，打断分支不经过。
  后台"Luna 对话"tab 现在等于只能看 Luna 自言自语，**诊断能力已废**。
  （2026-06-25 修过一次同款问题，见 memory `luna-experience-redesign`。）
- **session 53 挂了 17274 秒 = 4.8 小时**没关闭。native audio 按时长计价，
  是单位时间最贵的一项（`VoiceAssistantContext.tsx:41` 自己的注释）。
  需要确认是真连着还是只是 `ended_at` 没回填。

## 最短止血（估半天）

按性价比排序：

1. **收窄 `explain_feature` 触发**（30 min）——
   只有明确问"怎么操作/在哪里/多少钱"才走；
   出现需求词（预算 / 交房年份 / 付款计划 / 户型 / 区域）一律先走搜索。
   prompt 里把"先找房"提到 product 那节之前。
2. **澄清必须自带一屏内容**（30 min）——
   `AREA_NOT_FOUND` / `AREA_AMBIGUOUS` 的返回体里塞进
   "同时可以看的东西"（热门区 / 相似名项目），prompt 强制"问的同时必须展示"。
   禁止连续两轮纯澄清。
3. **身份护栏**（10 min）—— `## WHO YOU ARE` 加一条：
   不讨论底层模型 / 训练数据 / 知识截止；被问就转回房产。
4. **补 `finalizeUserMessage`**（10 min）—— 打断分支也要 finalize，
   否则下一轮审计还是瞎的。
5. `prefixPadding` 300 → 700ms（1 行，7-20 就该做没做）。

改完必须跑两层跑分（memory `luna-eval-harness`）：
```bash
cd backend
npx ts-node -T scripts/luna-eval.ts --json after.json --diff scripts/luna-eval-baseline-2026-07-20.json
LUNA_TOOLS_API_BASE=https://api.pinzos.com npx ts-node -T scripts/luna-eval-live.ts
```
⚠️ Tier1 打的是已部署 API，**先 quick-deploy 再跑分**。
⚠️ Tier2 读后端工具声明，**改前端 schema 它验证不到**（`voice-tool-declaration-drift`）。

## 但这不是增长瓶颈

45 天 10 场会话、全匿名、零真实复访。修完体感会好，**定位是止血不是救命** ——
跟 2026-07-20 那次的结论一致。参见 memory `activation-crisis-2026-07-17`、
`build-instead-of-sell-pattern`（"用找方向代替卖东西"的模式）。

要不要投这半天，是 owner 的决定，不是我的。

## 相关

- `docs/reports/2026-07-20-luna-voice-quality-root-cause.md`（上一轮五个根因）
- `docs/reports/2026-07-20-luna-quality-fixes-and-eval-system.md`（上一轮修复 + 跑分体系）
- memory: `luna-voice-quality-root-cause` / `luna-eval-harness` / `luna-product-guide`
