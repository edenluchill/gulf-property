# Luna 两层架构落地报告 — 2026-08-10

**决策**：owner 选「直接上两层架构」。
**前置**：`docs/reports/2026-08-10-luna-conversation-quality-audit.md`（审计）、`docs/luna-two-layer-spec.md`（方案）

---

## 做了什么

```
用户 → Live (gemini-2.5-flash-native-audio) —— 听 / 说 / 打断
         │ 工具从 17 个砍到 2 个: ask_luna / capture_contact
         ▼ POST /api/voice/tools/ask
       Brain (gemini-3.5-flash + thinkingLevel:'low')
         │ 22 个执行器现在**只有它**看得见
         ▼ { speech, mapAction, attachments }
       Live 照念 speech
```

**核心不变量：Live 层永远不生成事实。**

新增：
- `backend/src/services/luna-brain.ts` — 大脑
- `backend/src/services/luna-data-boundaries.ts` — 数据边界单一真相源
- `backend/scripts/luna-brain-eval.ts` — 大脑层跑分（Tier 1.5）
- `POST /api/voice/tools/ask` — 两层的接缝

---

## 五个只有跑起来才会发现的问题

这些都不在原方案里 —— 是实施过程中被跑分和真实会话打出来的。

### 1. `thought_signature` — 第一版跑分全红

Gemini 3.x 开 thinking 时，每个 `functionCall` part 上挂着 `thoughtSignature`。
把工具结果送回模型时**必须原样带上**，否则下一轮直接 400。

我第一版手工重建了 parts（`parts: calls.map(c => ({ functionCall: c }))`），
签名丢了 → 每条用例都走降级路径。

修法：回传模型返回的**原始 candidate content**，不要自己拼。

### 2. 延迟：8.9s → 4-7s，靠两个旋钮

| 配置 | 实测 |
|---|---|
| MAX_ROUNDS=3 + 末轮带工具 + 额外成稿调用 | 7.5–8.9s |
| MAX_ROUNDS=2 + **末轮不给工具** | 4–7s |

**并行调用救不了** —— 试过在 prompt 里要求「一轮把工具全调了」，没用，
因为那些调用真有依赖（先 search 拿到 project_id，才能算这个盘的 ROI）。
串行轮数就是延迟本身。

**末轮不给工具**单独砍掉 2-3 秒：之前末轮仍带工具 → 模型又调一次工具、
还是没写出话 → 只能再补一次「成稿」调用，一次问答烧 3 次 LLM 往返。

### 3. 🔴 禁止让 Live 说「让我查一下」

方案里写的是「调 ask_luna 前先说一句等待语盖住延迟」。**实际做不到。**

Tier2 实测：「买房能拿迪拜身份吗？」→ `让我 查一 下。1` → 沉默，
**一次工具调用都没有**，裁判 1/5。

2.5 native audio 做不到「先说话再调工具」这个组合动作 —— 一开口说等待语，
它就把这一回合当成说完了。先加强 prompt 要求「filler 和调用是同一个动作」，
无效；改成**禁止开口前说话**，5/5。

代价是 2-4 秒静默，靠前端 `toolStatus`（"查询中..."）的视觉反馈兜着。
**「承诺了不兑现」比静默糟糕得多。**

### 4. 🔴 Brain 无状态 → 「第一个」指到别的盘上

拆层**新引入**的失败模式，单层时不存在（那时模型自己带着对话历史）。

Tier2 实测：客户先问 "where are Emaar projects"，再问 "tell me more about
the first one" → Brain 重新搜了一遍，把 Binghatti Aquarise 当成"第一个"介绍，
而客户问的是 Emaar 的 Albero。裁判 1/5「严重的数据和上下文张冠李戴」。

修法：按 sessionId 记住上一轮**工具真正返回的项目名+id、按原顺序**
（存事实清单不存话术 —— 转述恰恰是错误的来源），下一轮注入并明确要求
「指代按这个列表解，不要重新搜索去猜」。1/5 → 5/5。

### 5. 转写丢失的真凶是打字模式，不是打断分支

审计时以为是 `finalizeUserMessage` 在打断分支漏调。实际是：
**`sendText` 从来没把用户输入喂进 transcript**。语音模式靠
`inputTranscription` 回调，打字模式不开麦克风 → 回调永远不来。

这解释了为什么 10 场里 8 场只有 Luna 的话 —— 那 8 场是打字的用户。

---

## 验收

| 跑分 | 结果 |
|---|---|
| Tier1 工具层（`luna-eval.ts`） | **85/85**，与部署前基线逐条一致，无回归 |
| Tier1.5 大脑层（`luna-brain-eval.ts`，新建） | **9/9** |
| Tier2 模型层（`luna-eval-live.ts`，已改造） | 确定性 **30/30**，裁判均分 **4.65/5**（修两条 1/5 前） |
| 工具声明漂移（`check-voice-tools.mjs`） | PASS |
| 生产 smoke（真 HTTP） | 边界命中、身份护栏、指代解析全部正确 |

### 审计里的四条生产事故，逐条复现验证

| 事故 | 现在 |
|---|---|
| 客户问二手房 → 答「有」 | 「我们没有二手房挂牌房源，但有 DLD 官方二手成交历史，可以判断报价是否合理」 |
| 问「你是什么模型」→ 报出 Gemini | 「我是 Luna」+ 同句转回房产 |
| 「Diamond 2」→ 连续两轮找不到 | 认出 Marina Diamond 2，说明是已建成楼盘无期房库存，给出成交数据 |
| 2027 交房 + post-handover → 回了 5 credits 报价单说明 | 真去搜项目，并诚实说明多数在 2028/2029 交房 |

---

## Tier2 的保真度缺口基本补上了

旧版读 `convertToolsForSDK()`（后端 22 个执行器），而生产 Luna 拿的是前端
16 个声明 —— **两份历来漂移，跑分绿≠生产绿**。

拆层后 Live 只有 2 个工具，Tier2 内联同一份声明并**真调 `askLuna()`**，两边一致。

⚠️ 但拆层会把 Tier2 的两条断言弄瞎（「数字溯源」「遵守不确定信号」要读工具原始返回，
而它现在只看得见一个 `ask_luna`）—— 靠 Brain 的 `debug.toolLog` 把内部调用摊还给它。
**改 Brain 返回结构时别把这个字段弄丢。**

---

## 埋点：`AREA_NOT_FOUND` 不再伪装成成功

旧口径只分 `ok`/`unknown`/`error`，于是 `AREA_NOT_FOUND`、`AREA_AMBIGUOUS`、
0 结果**全部记成 `ok`** —— 看板 60 天 32 次调用 0 失败一片健康，
而同期真实 transcript 里用户在连续吃闭门羹。

现在分 `ok`/`empty`/`not_found`/`ambiguous`/`unknown`/`error`。
这几档要分开看：`not_found` 高 = 数据缺口；`ambiguous` 高 = 匹配器该调；
`empty` 高 = 搜索条件太窄。混成 `ok` 一个都定位不了。

新增 `luna.brain.{ms,clarify_streak}` + `ai.cost.usd_micro{task=luna-brain}`
（Brain 是一笔**新成本**，必须能在成本看板单独看到）。

---

## 已知残留

- **延迟仍偏高**：边界类 1.5-4s，搜索类 4-7s。语音里 7s 偏长。
  下一步可考虑 speech 流式回传，或把高频问法做成缓存。
- **Live 复述偶有截断**：观察到一次 "While we do not have," 半句丢失 ——
  native audio 复述长 speech 时会自行压缩。缓解方向是把 speech 压得更短。
- **HTTP 端点 p95 6 秒的尾部延迟未修**（工具内部只花 150ms，差值在 cpx11 双核
  被挤，疑似 `warmer-starves-live-traffic` 同款）。Brain 的 6s 硬超时会盖住它。

## 但这仍然不是增长瓶颈

45 天 10 场会话、全匿名、零真实复访。这轮修的是**产品质量**，
定位是止血不是救命 —— 跟 2026-07-20 那次结论一致。
