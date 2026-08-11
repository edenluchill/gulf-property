# Luna 两层架构 Spec — 2026-08-10

**决策人**：owner，2026-08-10。选项是「直接上两层架构」。
**依据**：`docs/reports/2026-08-10-luna-conversation-quality-audit.md`

---

## 一、为什么是架构问题，不是模型问题

审计拿到的三组数据，指向同一个结论：**数据层是好的，是那个实时语音模型不会用它。**

| 观测 | 数字 | 说明 |
|---|---|---|
| 工具执行成功率 | 60 天 32 次，**0 error** | `voice.tool` 埋点。工具本身不失败 |
| 工具执行耗时 | p95 **全部 < 150ms** | `voice.tool.ms`。不慢 |
| 每场对话工具调用数 | **平均 1 次**（58 场 / 59 次） | **模型基本不查数据就开口** |
| 会话轮次 | 8 月 5 场平均 **2.4 轮** | 说一句就走 |
| 十场 transcript | **1 场**进入房产话题 | 其余是产品手册 / 澄清死循环 / 闲聊身份 |

Live 层跑的是 `gemini-2.5-flash-native-audio-preview-12-2025` ——
2.5 世代原生音频预览版，**没有 thinking 也配不了**，上面压着 22 个工具。

指令跟随崩溃的铁证已经有了：prompt 明令禁止说"抱歉"，session 52 说了；
prompt 要求"先调工具再开口"，实际每场只调 1 次工具。

**结论**：让一个无思考能力的实时语音模型同时承担「听、说、打断、选工具、
判断置信度、组织话术」是超纲的。拆。

---

## 二、目标架构

```
用户说话
   │
   ▼
┌────────────────────────────────────────────┐
│  Layer 1 — 嘴和耳朵 (Live)                  │
│  gemini-2.5-flash-native-audio-preview      │
│  职责：听 / 说 / 打断 / 判断该不该问大脑     │
│  工具：3 个                                 │
│    · ask_luna(question)   ← 唯一知识入口     │
│    · capture_contact(...)  ← 纯前端          │
│    · reset_map()           ← 纯 UI，零延迟   │
│  它 **不做任何事实判断**，speech 照念不改     │
└────────────────┬───────────────────────────┘
                 │ POST /api/voice/ask
                 ▼
┌────────────────────────────────────────────┐
│  Layer 2 — 大脑 (Brain)                     │
│  gemini-3.5-flash + thinkingLevel: 'low'    │
│  职责：理解意图 / 选工具 / 多轮调用 /        │
│        判断置信度 / **写好最终话术**         │
│  工具：现有 22 个执行器，原样复用            │
│  额外：数据边界表（我们有什么、没有什么）     │
│  输出：{ speech, mapAction, attachments }    │
└────────────────────────────────────────────┘
```

**核心不变量：Layer 1 永远不生成事实。** speech 字段由 Layer 2 写死，
Layer 1 的 prompt 只允许它「照念」+「念之前说一句等待语」。

---

## 三、Layer 2 的三个新职责（架构本身不自动带来的）

拆层只解决"谁来思考"。下面三条必须单独做，否则换架构等于白换。

### 3.1 数据边界表 —— 解决"客户问二手房，Luna 说有"

现状：22 个工具全是「去查某个具体东西」，**没有一个能回答「你们有什么数据」**。
prompt 只禁止编造价格/收益率/项目名，**没禁止编造能力**。

新增 `backend/src/services/luna-data-boundaries.ts`，作为**单一真相源**，
同时注入 Brain 的 system prompt。内容：

**有**
- 迪拜**期房 / 新盘**项目库（开发商在售，含户型、付款计划、交房期）
- DLD 历史成交（`trans_group='Sales'` 口径）、租赁合同
- 区域指标：价格 / 租金 / 收益率 / 增长 / 成交量
- POI、通勤测距、便利度评分
- 购房成本、租买对比、可负担性测算

**没有**（问到必须直说，禁止用相近的东西糊弄）
- ❌ **二手房 / 现房转售在售房源**（有二手**成交价**，没有二手**房源**）
- ❌ 租房房源、短租 / Airbnb
- ❌ 迪拜以外的城市（阿布扎比、沙迦…）
- ❌ 贷款审批 / 银行利率报价
- ❌ 实时剩余库存（项目售罄状态是快照，不是实时）

边界命中时的返回契约：`{ status: 'OUT_OF_SCOPE', asked, have_instead }` ——
**必须带 `have_instead`**，否则又回到"反复说找不到"的老路。
例：问二手房 → 「在售二手房源我们没有；但同区域同户型的**二手成交价**有，
可以拿来判断报价合不合理」。

### 3.2 澄清必须自带出路 —— 解决"连续三轮找不到"

7-20 把「自信地说谎」修成了「诚实地说找不到」，但出路只覆盖"空搜索结果"，
不覆盖"区域没匹配上"。session 51 连续两轮、53 连续三轮纯澄清。

Brain 层硬规则（代码强制，不靠 prompt）：
- 一次回答里 **不允许只有问题没有内容**。`AREA_AMBIGUOUS` / `AREA_NOT_FOUND` /
  `OUT_OF_SCOPE` 三种情况，返回体必须同时带一组可展示的东西（热门区 / 相似名项目）。
- Brain 记录本轮是否为纯澄清；**连续两轮纯澄清直接降级**为「我按最接近的给你看一个」。

### 3.3 埋点分清"成功"和"没结果"

现状 `voice-assistant-tools.ts:485` 只分 `ok` / `unknown` / `error` ——
`AREA_NOT_FOUND` 和 0 结果**全部记成 `ok`**。监控 100% 健康，用户全是失败。

新增 result 维度：`ok` / `empty` / `not_found` / `ambiguous` / `out_of_scope` /
`unknown` / `error`。Brain 层额外埋 `luna.brain.{ms,tools_used,degraded}`。

---

## 四、延迟预算（最大风险）

多一跳就是多一段静默。语音里 3 秒静默 = 用户以为断线。

| 段 | 预算 | 对策 |
|---|---|---|
| Live 决定调 ask_luna | ~300ms | — |
| Brain 首次推理 | ~800ms | `thinkingLevel: 'low'`（**不是 high** —— 延迟敏感场景） |
| 工具执行 | ~150ms | 实测 p95 已达标；模型一轮返回多个 call 时 `Promise.all` 并行 |
| Brain 二轮成稿 | ~700ms | 最多 3 轮工具循环，超了强制成稿 |
| **合计** | **~2s** | |

**硬超时 8 秒** → 返回降级 speech，不让用户干等。

Live 层 prompt 要求：调 `ask_luna` **之前**先说一句短等待语
（"我看一下" / "让我查查"）—— 这与旧规则"不许在工具返回前开口"**不冲突**：
禁的是**承诺结果**（"这就带你去 Marina"，可能根本找不到），
等待语不承诺任何事实，是安全的。这条要在 prompt 里写清楚区别，否则模型会混。

⚠️ HTTP 端点 p95 6 秒的尾部延迟是**另一件事**（工具内部只花 150ms，
差值在 cpx11 双核被挤，疑似 `warmer-starves-live-traffic` 同款）。
本次不修，但 Brain 的超时兜底会盖住它。

---

## 五、必须保住的现有行为（回归清单）

拆层最容易碰掉的是这些"顺带"逻辑：

1. **气泡卡片** —— 前端 `buildBubbleAttachment(toolName, result, params)` 靠工具名渲染。
   Brain 必须回传 `attachments: [{ toolName, result, params }]`，否则卡片全没。
2. **地图动作** —— `mapAction` 契约不变，前端 `handleMapAction` 不动。
3. **`navigate_to_project` 的 2.5s 延迟跳详情页**（`VoiceAssistantContext.tsx:730`）。
4. **token 计量 / 额度闸门** —— Live 侧不变；Brain 侧走 `callGemini` 自带计量
   （task 名 `luna-brain`），**新增的是一笔新成本，必须能在成本看板单独看到**。
5. **分享 tour 的额度豁免**（`quotaExemptRef`）不受影响。
6. **`present_place` 的 guided_tour** —— 由 Brain 决定调用，mapAction 原样透传。
7. **文字模式** `/api/voice/text` 复用同一份 system prompt —— 它也要切到 Brain。

## 六、顺带修掉（同一批，成本极低）

- **身份护栏**：Brain + Live 双侧加一条 —— 不讨论底层模型 / 训练数据 / 知识截止，
  被问就转回房产。（session 55 报出了「我是 Gemini 开发的」）
- **`finalizeUserMessage` 打断分支漏调** —— 10 场里 8 场用户的话是空的，
  后台回看等于只能看 Luna 自言自语，**不修下一轮审计还是瞎的**。
- **session 未关闭** —— session 53 挂了 17274 秒（4.8 小时）。确认是真连着还是
  `ended_at` 没回填；native audio 按时长计价。

---

## 七、验收

改完必跑（memory `luna-eval-harness`）：

```bash
cd backend
npx ts-node -T scripts/luna-eval.ts --json after.json \
  --diff scripts/luna-eval-baseline-2026-07-20.json
LUNA_TOOLS_API_BASE=https://api.pinzos.com npx ts-node -T scripts/luna-eval-live.ts
```

⚠️ Tier1 打**已部署** API → **先 `quick-deploy.ps1` 再跑分**。
⚠️ Tier2 读**后端**工具声明，改前端 schema 它验证不到
（memory `voice-tool-declaration-drift`）；跑 `frontend/scripts/check-voice-tools.mjs`。

**新增用例（Tier1）**：
- 二手房 / 租房 / 阿布扎比 → 必须 `OUT_OF_SCOPE` 且带 `have_instead`
- `AREA_NOT_FOUND` 返回体必须非空可展示
- 连续两轮澄清 → 第三轮必须降级出内容

**新增用例（Tier2，Brain 层可以单独跑，不需要 Live）**：
Brain 是普通文本模型，**可以确定性地跑** —— 这是拆层白捡的好处：
以前只能靠 Live 端到端撞运气，现在大脑部分能进 CI。

---

## 八、实施顺序

1. `luna-data-boundaries.ts` + Brain 骨架 + `/api/voice/ask`
2. Brain 的工具循环 + 澄清出路 + 降级
3. 埋点维度扩展
4. Live 层 prompt 重写 + 前端工具减到 3 个
5. `finalizeUserMessage` / 身份护栏 / session 关闭
6. 跑分用例 + 部署 + 验收
