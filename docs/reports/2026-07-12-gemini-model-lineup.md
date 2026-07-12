# Gemini 模型选型报告 —— 2026-07-12

> 起因：客户画像抽取一直**静默丢字段**。查下去发现问题远不止一个模型名。
> 来源：Google 官方文档（ai.google.dev/gemini-api/docs/{models,pricing,thinking,structured-output}）
> + `ai.models.list()` 实测 + 对照实验。

---

## TL;DR — 三个发现，一个比一个严重

| # | 发现 | 影响 |
|---|---|---|
| 1 | `gemini-3-flash` **根本不存在**（404） | 全站 6 个文件都写着它 → **每次调用先撞 404 再 fallback，整个项目的 AI 一直跑在 Gemini 2.5 上** |
| 2 | Gemini 3.x 用 `thinkingLevel`，**不是 `thinkingBudget`** | 写错会被**静默忽略**。thinking 默认开着**且按 output 价计费**（$9/1M）→ 白烧钱 |
| 3 | 结构化输出的字段是 optional 时，模型可以合法「不填」 | **明说了的信息静默消失**。这是丢字段的**真正根因** —— 不是模型不行 |

---

## 1. 当前模型阵容（官方文档核对）

| 模型 ID | 状态 | 价格 (in/out per 1M) |
|---|---|---|
| **`gemini-3.5-flash`** | **GA 旗舰 Flash**（2026-05-19 发布） | **$1.50 / $9.00** |
| `gemini-3.1-flash-lite` | GA，最便宜 | $0.25 / $1.50 |
| `gemini-3.1-pro-preview` | Preview，最强 | $2.00 / $12.00（**无免费额度**） |
| `gemini-2.5-flash` / `pro` / `flash-lite` | ⚠️ deprecated，**最早 2026-10-16 关停** | — |

**别名**：`gemini-flash-latest` → `gemini-3.5-flash`；`gemini-pro-latest` → `gemini-3.1-pro-preview`。
⚠️ 别名会被**静默热切换**（官方只给 2 周邮件通知）→ **抽取代码不能钉别名**，输出分布会无声变化。

### ❌ 不能用的 ID

| ID | 问题 |
|---|---|
| `gemini-3-flash` · `gemini-3.1-flash` · `gemini-3.1-pro` | **404，从来不存在**。CLAUDE.md 原来写的就是这些 |
| `gemini-3-flash-preview` | **已 deprecated**（替代品就是 3.5-flash） |
| `gemini-3-pro-preview` | **2026-03-09 已关停** —— 它还能 resolve，但那只是 redirect 到 3.1-pro |
| `gemini-3.1-flash-lite-preview` | 2026-05-25 已关停 |

> 🪤 **陷阱**：`ai.models.list()` 里能看到、调用也能成功的 ID，**未必是活的模型** ——
> 已关停的 ID 会静默 redirect 到后继者。别拿"我调通了"当作"这个模型能用"。

---

## 2. Thinking：静默烧钱

| 模型 | thinking 默认 |
|---|---|
| `gemini-3.5-flash` | **medium**（开） |
| `gemini-3.1-pro-preview` | **high**（开，且**不能关**） |
| `gemini-3.1-flash-lite` | minimal（开） |

- **参数名**：Gemini 3.x 是 `thinkingConfig.thinkingLevel`（`minimal|low|medium|high`）。
  Gemini 2.5 才是 `thinkingConfig.thinkingBudget`（数字）。
  **写错的那个会被静默忽略** —— 我一开始写 `thinkingBudget: 0`，完全没生效。
- **thinking token 按 output 价计费**（3.5-flash 是 $9/1M）。
- **实测**（一条短笔记的抽取）：

| thinkingLevel | thinking token |
|---|---|
| 默认 | **1,440** |
| `low` | 889 |
| **`minimal`** | **0** ✅ |

→ **抽取/分类这类任务一律 `minimal`**。不需要思考，还省一大笔。

> ⚠️ Gemini 3 系**没有任何模型能把 thinking 完全关掉**（`minimal` 是下限，只是实测能到 0）。

---

## 3. ⭐ 静默丢字段的真正根因：schema 给了模型「藏起来」的权利

**这才是最值钱的发现。**

同一条笔记：`王小姐，单身，自住，预算120万，第一次在迪拜买房`

| schema | 抽取结果 |
|---|---|
| 字段全 **optional**（原写法） | `{name:"王小姐", payment:"cash"}` ← `goal`/`budget`/`first_time_buyer` **全丢**，`payment` 还是**编的** |
| 字段全 **required + 允许 null** | `{goal:"live", budget_max:1200000, first_time_buyer:true, nationality:null, ...}` ← **全对**，没说的老实给 `null` |

**结论：不是模型不行，是 schema 允许它不填。**
required 之后，它填不出来就**必须**交出一个 `null` —— 藏不住了。

```ts
// ❌ 模型可以合法地「不填」→ 明说的信息也会消失
{ type: 'object', properties: { goal: { type: 'string', enum: [...] } } }

// ✅ 填不出来必须给 null
{ type: 'object',
  properties: { goal: { type: ['string','null'], enum: [...values, null] } },
  required: ['goal', ...所有字段] }
```

官方文档也印证：结构化输出**只保证 JSON 语法合法，不保证语义完整/正确**，要求调用方自己校验。
另外：**不支持的 JSON Schema 关键字会被静默忽略**（不报错）—— 又一个静默失败面。

> 附带发现：`gemini-3.1-flash-lite` 在 optional schema 下不仅丢字段，还**编造**了
> `nationality:"中国"` 和 `payment:"cash"`（笔记里都没有）。**编造比丢失更危险** ——
> 报告会拿着编的画像去说服真实客户。换成 required+null 后它也抽对了。

---

## 4. 最终配置（客户画像抽取）

```ts
const MODELS = ['gemini-3.5-flash', 'gemini-3.1-flash-lite']   // GA，不钉别名
config: {
  responseMimeType: 'application/json',
  responseSchema: SCHEMA,              // 全 required + 允许 null
  temperature: 0,
  maxOutputTokens: 2000,               // 防跑飞（曾被一次 11 万字符的失控咬过）
  thinkingConfig: { thinkingLevel: 'minimal' },   // 不是 thinkingBudget！
}
```

**实测成本**：input ~200 tok + output ~79 tok ≈ **$0.001/次**。
→ 画像检查**不扣积分**是合理的：为了几厘钱去阻止一个提升主产品（20 积分的报告）质量的动作，不划算。

**验证**：`backend/scripts/test-profile-coach.ts` —— 22/22 全过。

---

## 5. 待办

- [ ] 现在全站钉在 `gemini-3.5-flash`。它是 GA，但 Google 的节奏是半年一代 —— **每季度复核一次这张表**
- [ ] `gemini-2.5-*` 最早 **2026-10-16 关停**：确认全站已无残留（本次已清）
- [ ] 其他调用点（`auto-report` / `tour-generator` / `collabReport` / `lunaSummary` / `revise` / `auto-config`）
      的 schema **也该做 required+null 审计** —— 它们可能一直在静默丢字段而没人发现
