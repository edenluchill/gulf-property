# Luna 工具路由重构 + 可观测/自测系统 — Spec 2026-08-10

**决策人**：owner。「做，然后 model 也更新最新的，我不信 gemini live call 大脑如此垃圾，肯定是没用对。」

---

## 1. 根因（推翻我之前的归因）

我之前说「2.5 native audio 调工具不可靠」。**错了。是我把线索删了。**

**工具的 description 就是模型的能力清单。** 拆层时我把 17 个具体工具砍成 1 个抽象入口：

| | Live 看到的 | 它要做的判断 |
|---|---|---|
| 拆层前 | `get_investment_breakdown: "Investment breakdown for a specific project…"`<br/>`rent_vs_buy: "Indicative rent-vs-buy comparison…"` | **语义匹配** —— 用户问回报率 → 对上了 → 调 |
| 拆层后 | `ask_luna: "你什么都不知道，任何真实问题都问这个"` | **元判断** —— 「这算不算真实问题？我该不该承认自己不知道？」 |

元判断恰恰是小模型最不擅长的。所以它有时候就自己答了 ——
owner 看到的「AI 说自己能卖二手房」就是这么来的（同样的问题直接问 Brain，三种问法答案全对）。

**连带结论：那次 3.1 vs 2.5 的 A/B 是在这个错误架构下跑的，结论作废，重测。**

---

## 2. 目标架构

```
后端 = 工具声明的唯一真相源
  POST /api/voice/token  →  { token, systemInstruction, tools[] }   ← 23 个完整声明
                                    │
                          前端喂给 Live（不再硬编码）
                                    ▼
  Live 看到完整能力清单 → 语义匹配 → 调 get_investment_breakdown(project_id)
                                    │
                          前端统一拦截（不真执行）
                                    ▼
  POST /api/voice/tools/ask { userSaid, intendedTool, params, … }
                                    ▼
  Brain：把 intendedTool 当**意图信号**（不是命令），自己决定真正调什么
         护栏全在这里：数据边界 / 诚实规则 / 澄清出路 / 指代记忆
                                    ▼
                        { speech, mapAction, attachments }
                                    ▼
                            Live 照念 speech
```

**三个问题一次解决**：
1. Live 重新有能力线索 → 会调工具（根因）
2. 护栏仍在 Brain → 不会再凭空承诺能力
3. 工具声明单一真相源 → 前端硬编码那份 + 跑分内联那份都删掉，漂移彻底消失

### 为什么 `intendedTool` 是「信号」不是「命令」

Live 选错工具是常态（它没有数据，只有名字和描述）。Brain 收到
`intendedTool=get_investment_breakdown` 的价值是**知道客户在问回报**，
至于该调 `area_investment_report` 还是 `project_value_check`、要不要先 `search_projects`
拿 id，由 Brain 判断。**照 Live 说的执行 = 把决策权还给了不该有的那层。**

### 快路径：纯 UI 动作

`fly_to_area` / `reset_map` / `open_project_detail` / `navigate_to_project` /
`add_to_favorites` / `highlight_projects` 这类**只动地图不产生事实**的调用，
Brain 走**单轮**（执行 + 一次 LLM 出话，≈1.5s），不走两轮。
「带我去 Marina」等 4 秒是不可接受的。

---

## 3. 模型升级

`LIVE_AUDIO`: `gemini-2.5-flash-native-audio-preview-12-2025` → **`gemini-3.1-flash-live-preview`**

- 音频同价（$3/$12 per 1M ≈ $0.005/$0.018 每分钟）
- 延迟 ~200ms（vs ~300ms）、噪声处理更好、200+ 语言
- **ComplexFuncBench Audio 90.8%，比上一代高约 20%** —— 而工具调用正是我们的痛点
- 之前判它差的那次 A/B 条件是错的（见 §1）

同步改：`pricing.ts` 加价格行、`models.ts`、前端常量（改为从 token 响应读）。

---

## 4. 可观测（owner 要的「完整知道体验」）

### 4.1 延迟必须落库

前端**已经算好了**关键时间戳（`VoiceAssistantContext.tsx:705-712`），
但**只有 `console.log`**。所以「客户说话到 AI 回话隔多久」线上零数据。

每轮记录这几个点（毫秒，相对该轮起点）：

| 字段 | 含义 |
|---|---|
| `user_speech_ms` | 客户说了多久 |
| `to_tool_call_ms` | 客户说完 → Live 决定调工具 |
| `brain_ms` | Brain 全程（含内部工具） |
| `to_first_audio_ms` | 客户说完 → **Luna 第一个音出来**（这是体感延迟） |
| `total_ms` | 客户说完 → Luna 说完 |

### 4.2 一张表，四个真相

`luna_turns` 扩展。**核心指标是 `asked_brain`** ——
Live 没问 Brain 就开口的轮次 = 护栏全失效 = 幻觉高危区。
这是唯一能量化「Live 有多不听话」的数字。

### 4.3 删掉重复记录

现在同一件事记在 5 处（`luna_sessions` / `luna_turns` / `metrics_minute` /
`api_calls` / `voice/debug/*`）。收敛到 `luna_turns` 为主 + `luna_sessions` 做聚合。
`voice-debug.ts` 那 4 个端点删除。

---

## 5. Admin 自测系统（owner 要的核心）

### 5.1 页面：`/admin/luna`

三块：

**A. 真实会话**
列表 → 逐轮时间线。每轮显示：客户说了什么 · Luna 说了什么 · 延迟瀑布 ·
调了哪些工具 · **是否问过 Brain**。
标红：没问 Brain / 超时 / 降级 / 纯澄清。

**B. 一键自测**
选一组场景（或全跑）→ 后台跑 → 结果落库 → 页面看。
人手能点，AI（我）也能通过同一个 API 触发。

**C. AI 评估**
每条测试结果交给 `gemini-3.5-flash` 裁判打分 + 判词，落库。
历史趋势对比（这次 vs 上次）。

### 5.2 🔴 测试必须走真实前端链路

**这是当前最大的盲区，也是两个真实故障都没被抓到的原因。**

现有三套跑分全测后端：
- `luna-eval.ts` 测工具返回
- `luna-brain-eval.ts` 测 Brain
- `luna-eval-live.ts` 看着像端到端，实际是**文字注入**：不走 `VoiceAssistantContext`、
  不走麦克风/VAD/播放，工具声明还是脚本内联的第二份

新增 **Tier 3：Playwright 驱动真实前端**
- 打开真实页面 → 用文字模式（走同一条 Live 管线）注入 → 断言真实链路
- 能抓到的：Live 有没有调工具 · 前端有没有正确路由 · 卡片/地图有没有响应 · 真实延迟
- 结果写进同一张表，admin 页可见

---

## 6. 实施顺序

1. **后端 manifest** —— `/api/voice/token` 响应带 `tools[]`（23 个）
2. **前端改造** —— 删硬编码声明，从 token 读；所有工具调用统一路由 `/ask`
3. **Brain 接 `intendedTool`** —— 当意图信号；纯 UI 动作走单轮快路径
4. **模型升级** 3.1-flash-live + pricing
5. **重跑 A/B**（这次条件才是对的）
6. **延迟落库** —— `luna_turns` 扩展字段
7. **Admin 页** —— 会话时间线 + 一键自测 + AI 评分
8. **Tier 3 真机跑分** —— Playwright
9. **删死代码** —— `voice-chat.ts` + `voice-assistant.ts` + `voice-debug.ts`（≈940 行）

1-5 是止血 + 根因修复，优先。6-8 是 owner 要的系统。9 收尾。
