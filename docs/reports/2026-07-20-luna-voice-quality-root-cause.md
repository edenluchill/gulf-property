# Luna 语音助手「回复智障」根因审计

日期：2026-07-20
数据来源：`luna_sessions` 表，2026-07-08 ~ 2026-07-17 共 11 场真实对话（全部匿名访客）
方法：逐句回放对话 + 反向定位代码

---

## 摘要

**结论：主因不是 Gemini 模型能力，是工具层向模型返回了错误数据且不带任何不确定性信号。**

11 场对话里每一句「智障回复」都能对应到一个具体的工程缺陷。换更强的模型无法修复其中任何一条——更强的模型只会把错话说得更自信、更流畅。

唯一真正属于模型的问题是：跑在 `gemini-2.5-flash-native-audio-preview-12-2025`（2.5 世代小号预览版）上，却被压了 22 个工具 + 约 4000 token 的自相矛盾提示词，指令跟随已经崩溃。

**用户留存佐证**：过去 30 天 14 个访客，其中 8 个只发起过 1 场会话。6 月多次会话的 visitor 为内部测试。

---

## 缺陷一：ROI 数字取到了商业写字楼的指标（最严重）

### 现象
Session 42，对一套 270 万 AED 的 1 居室播报：
> "5 年增值约 4818 万，年化回报 79.9%"

Session 39/41，对 350 万的 GREENZ 播报「5 年预计总收益 1790 万迪拉姆」。

### 根因 A：查询缺 usage / segment 过滤

`backend/src/routes/ai-projects.ts:400-408`

```sql
SELECT dam.rental_yield_pct, dam.price_growth_pct
FROM dubai_area_rolling_metrics dam JOIN dubai_areas da ...
WHERE LOWER(da.name) = LOWER($1) OR REPLACE(...)
ORDER BY dam.period_end_month DESC
LIMIT 1        -- 没有 usage='residential' AND segment='all'
```

Business Bay 同月实际有 4 行：

| usage | segment | rental_yield_pct | price_growth_pct |
|---|---|---|---|
| residential | all | 4.85 | 10.9 | ← 应取此行 |
| all | all | 4.85 | 12.9 |
| **commercial** | all | null | **79.9** | ← 实际取到 |
| hospitality | all | null | -15.2 |

`search_projects` 路径同病（`ai-projects.ts:126-137`），`DISTINCT ON (da.name) ORDER BY da.name, period_end_month DESC` 同样无过滤且无 tiebreak → **同一项目每次查值可能不同**。日志可证：Serenz 在一处是 `area_growth:14.2 / area_yield:null`，另一处变成 `area_growth:8.5 / area_yield:6.69`。

### 根因 B：把单年 YoY 当永续复利外推 5 年

`backend/src/services/investment-calculator.ts:17-38`

```ts
const appreciation5yr = growthPct ? price * (Math.pow(1 + growthPct / 100, 5) - 1) : 0
const annualizedReturn = (Math.pow((price + totalProfit5yr) / price, 1 / 5) - 1) * 100
```

`price_growth_pct` 的定义（`backend/src/db/add-rent-stability-and-median-yield.sql:30-33, 77-84`）是**滚动 12 个月 YoY 中位价变动**，不是 CAGR，且 SQL 层放行到 ±120%。

### 验算（与日志逐位对上）

AVARRA by PALACE 1BR，price=2,700,000、growth=79.9、yield=0（commercial 行 yield 为 null）：
- appreciation = 2.7M × (1.799⁵ − 1) = 2.7M × 17.83 = **48.15M ≈ 日志 4818 万** ✓
- annualized = (1+17.83)^(1/5) − 1 = **79.9%** ✓

GREENZ，3.5M、growth=42、yield=6.82：
- 3.5M × (1.42⁵ − 1) = 16.7M + 3.5M × 6.82% × 5 = 1.19M = **17.9M = 1790 万** ✓

### 同项目里已有一份写对的实现

`backend/src/routes/ai-analytics.ts:208-215`（`get_investment_breakdown` / `recommend_by_budget` 走这条）：

```ts
const g = Math.min(0.20, Math.max(-0.10, (d.trend.cagr_3y_pct || 3) / 100))  // 真 3 年 CAGR + clamp
const fees = price * 0.06                                                     // 计入交易成本
```

**两套 ROI 实现并存，语音这条路一个护栏都没享受到。** 收口目标明确。

### 附带
`investment-calculator.ts:40-43` 的 `payback_years = Math.round(100 / yieldPct)` 是纯毛租金回本，不扣物业费/空置/交易成本，与 `net_yield` 那套口径不一致。

---

## 缺陷二：区域模糊匹配按字母序抽奖

### 现象
- 请求 `Dubai Harbor` → 返回 `D3 Dubai Dsign District 3`，Luna 随即介绍 D3
- 请求 `Jumeirah Village Circle (JVC)` → 返回 `Jebel Ali Village`

两个区在库里都真实存在且 visible：`Dubai Harbour`（英式拼写）、`JVC Jumeirah Village Circle`（缩写前置）。

### 根因

`backend/src/services/area-matcher.ts:63-91`，三级 fallback 的第三级：

```sql
SELECT ..., 3 as priority FROM dubai_areas
WHERE visible = true
  AND EXISTS (
    SELECT 1 FROM unnest(string_to_array(LOWER($2), ' ')) AS word
    WHERE LENGTH(word) > 2 AND LOWER(name) LIKE '%' || word || '%'
  )
...
ORDER BY priority, name LIMIT 1   -- tie-break 是字母序
```

**第三级不是打分，是「命中任意一个 >2 字符的词就算候选」，然后按字母序取第一个。** 匹配词数、词的稀有度、匹配长度占比全都不参与排序。

- `dubai` 命中全库几十个区域 → 字母序第一名 `D3 Dubai Dsign District 3` 赢
- `village` 命中 `Jebel Ali Village`，`Je` < `Ju` → 赢；命中 3/4 个词的正确答案被 `LIMIT 1` 砍掉

`sanitize()`（`:11-13`）只剥 `%` 和 `_`，括号保留，所以 `(jvc)` 也匹配不上 `JVC ...`。

### 更致命：模型收不到任何不确定性信号

三处都丢弃了匹配质量：

| 位置 | 行为 |
|---|---|
| `area-matcher.ts:88` | `priority` 算出来了但外层不传递 |
| `backend/src/routes/ai-areas.ts:24` | `res.json({area:{id,name,lat,lng}})` 显式挑字段，priority 被扔 |
| `backend/src/services/voice-assistant-tools.ts:926` | `name = m.area.name` **用匹配结果彻底覆盖用户输入** |

返回给模型的是 `{name, area, stops}` + `summary: '已开始带看 XXX'` —— 一个语气笃定的成功回执，既无原始请求词也无 confidence。**模型无从判断这不是它要的区域。**

雪上加霜：提示词 `voice-token.ts:148` 明确教模型信任它——
> "If exact name doesn't match → the tool handles fuzzy matching automatically"

### 附带数据质量问题
`dubai_areas.name` 存在尾随空格（`'Dubai Marina '`、`'Jumeirah Beach Residence(JBR) '`），命名风格不统一（缩写有时前置 `JVC Jumeirah…`、有时后置带括号 `…Residence(JBR)`），导致 P1/P2 命中率低，大量查询被推进 P3 抽奖。

---

## 缺陷三：语言乱跳（工具返回体注入中文指令）

### 现象
用户全程英文，Luna 中途切中文。例：
- `"No stop it finish this."` → `"好的, 我这就带您看看 The Oasis by Emaar。"`

### 根因

`backend/src/services/voice-assistant-tools.ts:1025`：

```ts
summary: `已开始带看 ${name}（地图正逐站展示）。请用口语顺着把这三站讲出来，
自然连贯、像带客户现场看房，不要照读、不要只说"分三步"：\n${narration}`,
```

**这不是中文数据，是一条中文的行为祈使句**，经 `VoiceAssistantContext.tsx:853` 原样透传回模型。附带的 `narration` 三行也是中文模板（`:1996, 1001, 1006`）。

`voice-assistant-tools.ts` 1036 行里 **97 行含中文**，几乎全在 `summary` 字段。另有中文字段直接进模型（`:1022-1023`）：`khda_rating_zh`（'卓越'/'优秀'…）、POI 只取 `description_zh`，无英文分支。

### 提示词的语言规则被中文范例淹没

`backend/src/routes/voice-token.ts:21` 只有一句语言规则，被插在整个 prompt 的**第 152 行中段**，前后被约 130 行中文包围：实体词表（40-69 行全中文）、中文示例输出（103/114/141/159/164/170/192-193 行）、BANNED WORDS 段全中文词。few-shot 信号强度远超单行规则。

另：`voice-token.ts:208` 的 `language` 取的是**界面语言**不是对话语言，用户说英文但界面中文时反而把模型推向中文。

---

## 缺陷四：回复被 barge-in 掐断

### 现象
日志中大量半句话：`"您好，我是"` / `"I'm not"` / `"What would you like to do? We can"` / `"…像 Downtown Dubai 就很受欢迎。我带"`

### 根因：VAD 配置与注释漂移

`frontend/src/contexts/VoiceAssistantContext.tsx:1106-1117`

```ts
automaticActivityDetection: {
  startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_HIGH,
  endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_HIGH,
  prefixPaddingMs: 300,
  silenceDurationMs: 350,
}
```

正上方 `:1096-1105` 的注释写着「kept CONSERVATIVE (LOW + 400ms) so background noise no longer interrupts Luna mid-sentence」——**注释与代码已漂移**。后来为修「说半天没反应」把 START 调回 HIGH、padding 400→300，未改注释。现在任何背景噪音 300ms 即触发打断。

### 生产数据佐证
45 场有 transcript 的会话中，15 场存在 interruption，共 50 次：
- 有 interruption 的会话：助手消息「结尾无标点」占 **27.1%**（19/70）
- 无 interruption 的会话：**13.3%**（8/60）

### 实际体验比日志更差
`frontend/src/hooks/voice-assistant/audioUtils.ts:449-455` 的 `AudioPlayer.stop()` 会 `src.stop()` 掉所有已排程 buffer。Gemini 推音频快于实时，打断时**已收到但未播放的音频整段丢弃**。

### 附带 bug：转写数据本身不可信

`VoiceAssistantContext.tsx:734-741` 的 interrupted 分支 `return` 早退，**未调用 `voiceDebugLogger.finalizeAssistantMessage()`** → `debugLogger.ts:298` 的 `currentAssistantText` 不清空，**与下一轮回复字符串粘连**（`:302-322` 只在 turnComplete 时 flush）。且被打断后无任何恢复机制：不重发、不标记、不提示。

---

## 缺陷五：「100 万左右」被翻译成「精确等于 100 万」

### 现象
用户说「100万左右的房产」→ 模型调 `search_projects({min_price:1000000, max_price:1000000})` → 只返回 1-3 个项目。

### 根因

1. **schema 无区间语义**：`frontend/src/contexts/VoiceAssistantContext.tsx:88-99` 的描述只有 `'Minimum budget in AED'`，无「min 必须小于 max」「'X 左右' 如何展开」的任何约束。后端还有一份漂移副本（`voice-assistant-tools.ts:64-71`，字段集不同）。

2. **提示词直接教错**：`voice-token.ts:89`
   ```
   - "200万预算" → search_projects(min_price=2000000) - DON'T ask area
   ```
   把预算映射到 min_price。模型一边守规则填 min，一边按常识填 max → min == max。

3. **后端零防御**：`ai-projects.ts:45-55` 无 min>max 校验、无容差、无放宽。退化后再叠加 `project_unit_types` 的 `price >= X AND price <= X`（`:186-187`）→ `unit_types_in_budget` 几乎必然为空。

### 0 结果 = 死路

`ai-projects.ts:286-329` 返回体就是 `{projects:[], count:0, summary:'No projects found matching your criteria.'}` —— 无近似候选、无「哪个条件卡住了」、无放宽建议、无 relaxed retry。

提示词 `:98` 要求模型 pivot 到「earlier recommend_by_budget/search results」，但首次调用时模型手里没有任何数据。**提示词在要求模型引用它没有的信息，模型正确地拒绝了，对话因此终止。**

### 附带
模型传了 `project_name` 参数，但**两份 schema 都未声明该字段，后端执行器也完全忽略**（`voice-assistant-tools.ts:446-452` 只转发 area/min_price/max_price/bedrooms/developer/status）。

---

## 模型层面的真实问题

`backend/src/services/ai/models.ts:26` — Luna 跑在：

```
LIVE_AUDIO = 'gemini-2.5-flash-native-audio-preview-12-2025'
```

同文件 `:62` 自己标注「gemini-2.5-*（除 LIVE_AUDIO）deprecated，最早 2026-10-16 关停」。

压在这个模型上的负载：
- **22 个工具**（`voice-assistant-tools.ts`）
- **约 4000 token 提示词**（`voice-token.ts:23-194`）

提示词自相矛盾之处：
- 要求 "2-3 sentences MAX"，同时用 20+ section 要求每次提及收益率/回本/户型/POI/对标/售罄状态/5年预测/置信度
- "BANNED WORDS: 抱歉 — NEVER use this word in any context"，但 Session 41、37 都说了「抱歉」。**禁令被违反是指令跟随崩溃的直接证据**
- "NEVER say sorry" + "ALWAYS provide useful information, even if indirect" + "Frame it positively" 的组合，在结构性地鼓励模型编造

**原生音频 Live 模型没有 thinking，也无法配置。这是硬限制。**

---

## 建议架构：两层拆分

Live 模型不应承担推理。正确分层：

```
Live 模型（嘴 + 耳朵）
  ├─ 工具收缩到 3-5 个
  └─ 其中一个是 ask_analyst(用户原话)
                    ↓
服务端「大脑」= gemini-3.5-flash + thinkingConfig.thinkingLevel='high'
  ├─ 多步推理、澄清、全部算术
  └─ 返回【已写好的可直接朗读的话】+ 一个地图动作
```

Live 模型永不接触原始 JSON、不做算术、不选区域。收益：
- thinking 有了（在大脑层）
- 换模型无痛（Live 层退化为音频编解码器）
- 数字收口到一处

## 三条通用铁律（让任何模型都变可靠）

**1. 工具禁止撒谎。** 每个模糊匹配返回 `{asked, matched, confidence, alternatives[]}`。低于阈值不返回答案，返回 `needs_disambiguation` + 候选，逼模型问「你说的是 Dubai Harbour 吗？」。**当前设计中工具说谎模型无法察觉——这是全部问题的总根源。**

**2. 数字不进模型。** 服务端算好、sanity-check（年化 > 30% 拒绝返回并告警）、渲染成可直接朗读的字符串。模型只念不算，就编不出 4818 万。

**3. 0 结果必须自带出路。** 返回体带「哪个条件卡住了 + 放宽后的候选」，模型才有牌可打。

---

## 动手顺序（按性价比）

| # | 动作 | 文件 | 成本 | 效果 |
|---|---|---|---|---|
| 1 | 加 `usage='residential' AND segment='all'` | `ai-projects.ts:400, 126` | 10 min | 立刻杀死 79.9% 类胡话 |
| 2 | ROI 收口到 `ai-analytics.ts:208` 那份实现 | `investment-calculator.ts` | 30 min | 数字可信 |
| 3 | `prefixPaddingMs` 300 → 700 | `VoiceAssistantContext.tsx:1113` | 1 行 | 不再被掐断 |
| 4 | 匹配器加相似度打分 + 返回 confidence，低分走澄清 | `area-matcher.ts`, `ai-areas.ts` | 2 h | 不再带错区 |
| 5 | 工具 summary 全改英文/结构化 | `voice-assistant-tools.ts` | 1 h | 语言不跳 |
| 6 | interrupted 分支补 `finalizeAssistantMessage()` | `VoiceAssistantContext.tsx:734` | 5 min | 转写数据可信（否则无法量化改进） |
| 7 | 提示词砍到 800 token 内，工具砍到 8 个以内 | `voice-token.ts` | 半天 | 指令跟随恢复 |
| 8 | 两层架构（Live 嘴 + 服务端脑） | 新 | 2-3 天 | 真正的 think process |

**第 1-3 项合计不到一小时，可解决体感问题的大半。**

---

## 重要提醒：这可能不是增长瓶颈

本次分析的 11 场对话**全部是匿名访客**，过去 30 天 14 个 visitor 中 8 个只来过一次。结合已知事实（真实外部用户建过 tour 的仅 1 人、pricing→trial 转化 73% 但试用后无人到达首次价值），修好 Luna 会把体验从「羞耻」拉到「能看」，但**大概率不是增长曲线的瓶颈**。

建议定位为止血，而非救命稻草。

---

## 关键文件索引

| 路径 | 作用 |
|---|---|
| `backend/src/routes/voice-token.ts:18-195` | 生产系统提示词（真正生效的那份） |
| `backend/src/services/voice-assistant.ts:20-61` | 旧版提示词（后端 WS 路径，已非主路径） |
| `frontend/src/contexts/VoiceAssistantContext.tsx:64-100` | Gemini 实际看到的工具 schema |
| `frontend/src/contexts/VoiceAssistantContext.tsx:1106-1117` | VAD 配置 |
| `frontend/src/contexts/VoiceAssistantContext.tsx:734-741` | interrupted 处理（缺 finalize） |
| `backend/src/services/voice-assistant-tools.ts` | 22 个工具执行器 + 中文 summary |
| `backend/src/services/area-matcher.ts:59-95` | 区域模糊匹配（字母序抽奖） |
| `backend/src/routes/ai-areas.ts:17-32` | 匹配路由（丢弃 priority） |
| `backend/src/routes/ai-projects.ts:126-172, 396-424` | 区域指标取数（缺 usage/segment） |
| `backend/src/services/investment-calculator.ts:17-43` | 5 年预测公式（无护栏） |
| `backend/src/routes/ai-analytics.ts:208-215` | 写对了的 ROI 实现（收口目标） |
| `backend/src/db/add-rent-stability-and-median-yield.sql:30-33, 77-84` | price_growth_pct 定义 |
| `frontend/src/hooks/voice-assistant/audioUtils.ts:449-455` | AudioPlayer.stop() 丢弃未播 buffer |
| `frontend/src/hooks/voice-assistant/debugLogger.ts:298-322` | 转写粘连 bug |
