# Luna 两层架构方案：Live 模型当嘴，服务端当大脑

> 2026-07-20 · 调研 + 落地方案（不含代码改动）
>
> 目标：解决 native-audio 模型无 thinking 导致的两个残留问题 ——
> ①抢在工具返回前开口 ②复杂问题只会平铺工具返回。

---

## 0. TL;DR — 三个会改变方案的实测结论

**① `thinkingLevel:'high'` 在语音场景不可用。实测（gemini-3.5-flash，本机→Google）：**

| 配置 | 耗时 | output tokens | 成本/次 |
|---|---|---|---|
| prose + `minimal` | **1.6s** (1636/1668ms) | 98–117 | $0.0012 |
| **schema + `minimal`（推荐）** | **2.5–4.1s** | 217–234 | $0.0024 |
| prose + `low` | 5.0s | 1154 | $0.0107 |
| prose + `high` | **7.3–10.4s** | 1477–2269 | **$0.0208** |

`high` 比 `minimal` 慢 6 倍、贵 17 倍，而**产出质量没有更好** —— `high` 那版还吐出
`"2,310,000 AED"`（数字直读，语音场景更差）。真正带来质量提升的不是 thinking 深度，
是**结构化输出强制它先填推理槽位**（`key_comparison` / `caveat`）：只有 schema 版本
主动指出了「gross yield 不含物业费，净收益会更低」这个数据缺口。

→ **方案改为 `thinkingLevel:'minimal'` + responseSchema 强制推理槽位，不是 `high`。**

**② 后端调 Gemini 做「工具选择」在生产区域有前科（血泪教训，2h 排查）。**
见 memory `luna-text-mode-server-region-blocker`：同一句「商业湾投资回报」，本机 12/12
选对，Hetzner 德国机上只 ~1/6。穷尽排除了 key/模型/提示词/SDK，结论是 Google 按调用方
IP 的行为差异。**这正是文字模式当初从后端搬回前端的原因。**
→ **大脑不能靠 Gemini function calling 自己多轮调工具，必须写死编排**（详见 §B2）。
（注：该实验是 2.5 世代模型 + 2026-07-01；现在 models.ts 指向 GA 的 gemini-3.5-flash，
可能已好转，但**方案不能押在这上面**，要先跑探针验证，见 §B2 附录。）

**③ 发现一个既存静默失败：`highlight_areas` 这个 mapAction 从来没被消费过。**
`compare_areas` / `recommend_by_budget` / `check_affordability` 三个工具都发它
（voice-assistant-tools.ts:587 / :844 / :908），`MapAction` 类型里有它
（types.ts:99），VoiceAssistantContext.tsx:521 也把它列进「跳回地图页」的清单，
但 **MapPage.tsx 的 switch 没有 `case 'highlight_areas'`**（661-758 只有 10 个 case）
→ 用户被导航回地图，然后什么也没发生。`add_favorite` 同样无消费者。
这两个工具正是本次要迁的对象，迁移时必须一并决定发什么动作。

---

## A. 现状梳理

### A1. 前端 16 个工具声明

`frontend/src/contexts/VoiceAssistantContext.tsx:60-269`（`voiceTools`，唯一喂给
Live 模型的那份，config 挂载在 :1129）

| # | 行号 | 名字 | 参数 | description 摘要 |
|---|---|---|---|---|
| 1 | :64 | `present_place` | `project_id?` / `area_name?` | 启动 3 站导览（优势/环境/成交），自动播放 |
| 2 | :75 | `capture_contact` | `name?, whatsapp?, phone?, email?` | 存客户联系方式，**仅前端执行** |
| 3 | :87 | `search_projects` | `area?, min_price?, max_price?, bedrooms?, developer?` | 搜盘；min/max 有大段区间语义说明 |
| 4 | :101 | `fly_to_area` | `area_name*` | 地图飞到某区 |
| 5 | :112 | `get_area_info` | `area_name*` | 区域市场数据（回报/涨幅/成交量） |
| 6 | :123 | `show_nearby_pois` | `category*, hide?` | 显示/隐藏 POI 图层 |
| 7 | :141 | `analyze_area_amenities` | `area_name*` | 配套便利度 0-100 分 + 地图放射线 |
| 8 | :152 | `navigate_to_project` | `project_id*, project_name?` | 飞到项目 + 户型 + 投资分析 + 开详情页 |
| 9 | :164 | `recommend_by_budget` | `budget*, goal?, property_type?, bedrooms?` | 按预算推荐区域 |
| 10 | :178 | `get_investment_breakdown` | `area*, property_type?, bedrooms?, offplan?` | 单区+户型的 ROI/收益/CAGR |
| 11 | :192 | `compare_market` | `vary*, property_type?, bedrooms?, area?` | 控制变量对比 DLD 成交 |
| 12 | :206 | `area_investment_report` | `area*, property_type?, bedrooms?` | **最全**的一次性投资报告 |
| 13 | :219 | `check_affordability` | `income?, cash?, property_type?, bedrooms?` | 从收入/现金反推可负担 |
| 14 | :232 | `project_value_check` | `project_id*` | 项目报价 vs 片区中位 |
| 15 | :241 | `purchase_costs` | `price*, mortgage?` | 一次性购房费用拆解 |
| 16 | :253 | `rent_vs_buy` | `area*, property_type?, bedrooms?, years?` | 租 vs 买 N 年对比 |

**后端有 22 个执行器**（`voice-assistant-tools.ts:90-439` 声明 + `:479` 起 switch）。
差集 = 前端**没声明**的 7 个：`compare_areas`、`show_transport`、`highlight_projects`、
`open_project_detail`、`add_to_favorites`、`reset_map`、`measure_distance`
（模型调不到，但 `luna-eval-live.ts` 用的是后端那份 → 跑分和生产不同源，
脚本自己在 :24-31 承认了这个保真度缺口）。

### A2. 后端 executeTool 结构

```
executeTool(toolName, params)                    voice-assistant-tools.ts:461-477
  └─ 埋点包装层：counter('voice.tool',{tool,result}) + histogram('voice.tool.ms')
     ⚠️ 专门识别 unknown tool —— default 分支返回 "Unknown tool: X" 但 HTTP 仍是
        200+success，监控上完全隐形（:453-459 的注释）
     └─ executeToolInner(...)                    :479-1150
        └─ 一个 22 分支的 switch，每个 case 返回 { result, summary, mapAction? }
```

- **`apiFetch<T>(path)`** `:75-79` —— 极简：`fetch(API_BASE+path)` → 非 2xx 抛
  `API ${path}: ${status}` → `res.json()`。**无超时、无重试、无 body/POST 支持**。
  `API_BASE` `:18` 线上恒为 `localhost:3000`（同进程同容器）；`LUNA_TOOLS_API_BASE`
  只给跑分脚本打生产用。
- **返回体三段**：
  - `result` —— 结构化原始数据，给前端 `buildBubbleAttachment` 渲染卡片
  - `summary` —— **喂回模型的字符串**。已经承担了「指令」职责：
    `AREA_AMBIGUOUS: … Do not say you are flying anywhere yet.`（:542）、
    `AREA_NOT_FOUND: … Do NOT substitute a different area.`（:548）
  - `mapAction` —— 可选，前端直接消费
- 金额一律走 `wan()` `:31-35`（`/10000`，注释记录了曾有 10 处写成 `/1000` 导致
  播报金额全部放大 10 倍的事故）。

### A3. 工具调用完整时序

```
① Live 模型 emit function call
   VoiceAssistantContext.tsx:835   if (message.toolCall?.functionCalls)
   :836 logReplyLatency('tool')  :839 finalizeUserMessage()

② 前端逐个执行（串行 for 循环，:850）
   :856  const result = await executeTool(fc.name, fc.args||{}, callId)
         └─ 前端 executeTool :612-687
            :613 debug log  :615 setPhase('processing')  :616 setToolStatus(中文文案)
            :622-650 capture_contact 在这里被拦截 → POST /api/leads/contact，不走后端工具路径
            :653  POST ${API_BASE}/api/voice/tools/execute  { toolName, params }
                  └─ backend/src/routes/voice-tools.ts:17-42
                     :27 const {result,summary,mapAction} = await executeTool(...)
                     :29 res.json({ success:true, result, summary, mapAction })
                     ⚠️ 无鉴权、无超时；catch 里 500（:35-41）
            :660-662 if (data.mapAction) handleMapAction(data.mapAction)   ← 副作用先发生
            :665-667 buildBubbleAttachment(toolName, data.result, params) → 气泡卡片
            :669-674 navigate_to_project 额外 2.5s 后跳详情页

③ 结果回传给模型
   :858  let detailedOutput = result.summary || 'Action completed.'
   :860-932  按工具名做**字符串富化**（search_projects 拼项目列表 + ID + 售罄标记；
             navigate_to_project 拼户型/5年投资/POI/地标/片区指标；get_area_info 拼 METRICS）
   :934-938  functionResponses.push({ id: callId, name: fc.name,
                                      response: { output: detailedOutput } })
   :949-958  sessionRef.current.sendToolResponse({ functionResponses })
```

**关键点：模型最终只看到一个字符串 `output`。** `result` 对象**完全不进模型**，
只用于渲染卡片。这对 §B3 的契约设计是好消息 —— ask_analyst 只要把
朗读文本放进 `summary`，天然就是「模型唯一看到的东西」。

### A4. mapAction 类型与消费

后端发出 12 种（grep `type: '…'`）：

| type | 发出处 | MapPage 消费 |
|---|---|---|
| `fly_to` | :557, :603, :1093 | ✅ :665 |
| `highlight_projects` | :502, :645 | ✅ :671 |
| `show_pois` | :621 | ✅ :689 |
| `toggle_transport` | :634 | ✅ :703 |
| `show_area_info` | :568 | ✅ :707 |
| `measure_distance` | :727 | ✅ :715 |
| `amenity_spokes` | :817 | ✅ :722 |
| `guided_tour` | :1140 | ✅ :743 |
| `navigate` | :604, :656 | ✅ :746（也在 Context:511 提前拦截） |
| `reset` | :678 | ✅ :752 |
| **`highlight_areas`** | :587, :844, :908 | ❌ **无 case，静默丢弃** |
| **`add_favorite`** | :667 | ❌ **无 case，静默丢弃** |

消费路径：`Context.handleMapAction` (:508-525) → 若在 `/` 或 `/map` 交给
`mapActionHandlerRef`；否则把动作暂存 `pendingActionRef` 并 `navigate('/')`，
由 MapPage 注册时补发（:528-534）。MapPage 侧 `handleVoiceMapAction` :661 起，
且在 :765 附近会把每个 action 广播进 collab 房间。

---

## B. ask_analyst 设计

### B1. 放哪

```
backend/src/services/luna-analyst.ts        ← 新建，大脑本体
   export async function askAnalyst(q: AnalystInput): Promise<AnalystOutput>
   · 走 callGemini({ task: 'luna-analyst', ... })   services/ai/gemini.ts:78
   · 模型名不硬编码：models: [FLASH, FLASH_LITE] 或直接省略用 DEFAULT_CHAIN
     （services/ai/models.ts:20/22/39）
   · thinkingConfig: { thinkingLevel: 'minimal' }   ← 见 §0①
   · responseMimeType:'application/json' + responseSchema，**所有字段 required
     且允许 null**（CLAUDE.md 的坑 #2：optional 字段模型会静默不填）

backend/src/services/voice-assistant-tools.ts
   在 executeToolInner 的 switch 里加 `case 'ask_analyst':`（约 :946 之后）
   → 调 luna-analyst，把结果映射成 { result, summary, mapAction }
```

**不需要新路由。** ask_analyst 复用现成的 `POST /api/voice/tools/execute`
（voice-tools.ts:17）—— 前端一行不用改传输层，埋点（`voice.tool` / `voice.tool.ms`）
自动覆盖，且 `LUNA_TOOLS_API_BASE` 那条跑分通路也自动可用。

把 AI 调用放在 service 而不是 route，是为了让 `luna-eval-live.ts` 能直接 import
`executeTool` 就跑到真大脑（它现在就是这么调的，:184）。

### B2. 大脑怎么调内部工具 —— **写死编排，不用 function calling**

**推荐：编排层写死（意图路由 → 并行取数 → 一次生成）。**

理由，按权重排序：

1. **生产区域前科（决定性）。** memory `luna-text-mode-server-region-blocker` 记录：
   后端 Hetzner 让 Gemini 选工具，同句本机 12/12 对、线上 ~1/6 对；试过 native
   function-calling、两步 JSON 分类、thinking on/off、`mode:'ANY'` 强制、精简提示词、
   few-shot、换 4 个模型 —— **全部本地好线上坏**。文字模式因此整个搬回前端。
   在这台机器上押 model-driven tool selection，是重蹈已经付出过 2h 代价的覆辙。
2. **延迟不允许。** function calling 每多一轮就多一个 RTT + 一次生成。§0 实测单次
   生成就要 1.6-2.5s；两轮就 4-5s，加上取数直接顶穿语音预算（§B4）。写死编排可以
   **并行**取数（`Promise.all`），把 N 个工具压成 1 个 RTT。
3. **可测。** 写死的路由是纯函数，能进 Tier-1 跑分（`luna-eval.ts` 那种确定性、
   秒级、免费的层）。模型选的工具只能靠真跑，贵且有随机性。
4. **意图空间很窄。** 真正需要「推理」的问题就那么几类（投资值不值 / 预算买哪 /
   A vs B / 租还是买 / 买得起吗）。这不是需要通用 agent 的场景。

**具体形态（两跳，共 1 次模型调用）：**

```
ask_analyst(question, context)
  ├─ 跳1  纯代码意图路由（关键词 + 已有 slot）→ 决定拉哪几个数据源
  │       ⚠️ 不要为「路由」再调一次模型：那是第二次 1.6s，且正是区域不稳的那类调用
  ├─ 跳2  Promise.all 并行 apiFetch 现成的 /api/ai/analytics/* 端点
  │       实测服务端耗时（生产，已扣 ~190ms RTT）：
  │         report ~290ms · investment ~160ms · recommend ~10ms · compare ~20ms
  │       → 并行 3 个 ≈ 300ms，可忽略
  └─ 跳3  一次 callGemini：把并行拿到的**已核对事实 JSON** + 客户原话 → 朗读文本
```

> **附录 · 上线前必跑的区域探针。** 若哪天想改用 function calling，先在**生产 API 容器里**
> 跑 20 次同一句「商业湾一居室投资回报」的工具选择，统计正确率。
> ≥18/20 才算区域问题已随 3.5-flash 消失；否则维持写死编排。
> （必须在容器内跑 —— 本机跑永远是绿的，这正是上次踩坑的方式。）

### B3. 返回契约 —— 让 Live 模型「只念不想」

模型只看得到 `summary`（§A3 ③），所以契约的重心就是让 `summary` **本身就是成品**。

```jsonc
// luna-analyst 的 responseSchema（字段全 required，可为 null）
{
  "speech_text":     "string  ← 2-3句，已成文、可直接朗读、用客户的语言",
  "key_comparison":  "string|null  ← 推理槽位：最具决策价值的那个对比",
  "caveat":          "string|null  ← 推理槽位：最重要的诚实警告/数据缺口",
  "numbers_used":    "number[]     ← speech_text 里每个数字，从事实 JSON 原样抄回",
  "map_action_hint": "string|null  ← 'fly_to'|'highlight_projects'|null"
}
```

`key_comparison` / `caveat` 存在的意义不是给人看，是**强迫模型在写 speech_text 之前
先想**（实测：只有带这两槽的版本主动说出了「gross yield 不含物业费」）。

**executeTool 里映射成工具返回：**

```jsonc
{
  "result": { /* 原始事实 JSON + numbers_used，给卡片渲染 & 遥测溯源 */ },
  "summary": "SPEAK_VERBATIM: <speech_text>",
  "mapAction": { /* 由 map_action_hint + 事实里的坐标在代码里组装，不由模型编 */ }
}
```

三个「只念不想」的保障，缺一不可：

1. **`SPEAK_VERBATIM:` 前缀 + 系统提示词加一条规则。**
   voice-token.ts 的 `## HOW YOU WORK`（:66-74）已经有「工具的 summary 让你别说什么
   你就别说」这一条（:70），顺势加一条：
   > `SPEAK_VERBATIM:` 之后的文字已经写好并核对过了。**逐字读出来，一个字都不要加、
   > 不要改、不要补充。**不要在前面加「好的」「让我看看」，不要在后面追加你自己的分析。

2. **数字核对的保证走服务端，不靠模型自觉。**
   在 luna-analyst 里做一道**确定性后校验**：把 `speech_text` 里 ≥1e5 量级的数字抽出来，
   逐个在事实 JSON 里比对（5% 容差）—— 这套算法 `luna-eval-live.ts:288-339`
   （`checkNumbersGrounded`）已经写好了，**抽出来复用即可**。
   对不上就重试一次；再对不上则降级（§D3）。
   这样「这段话里的数字都已核对」才是**真保证**，而不是提示词里的一句祝愿。

3. **`result` 里绝不放中文 UI 文案。** present_place 的注释（:1097-1107）记录了血泪：
   把写死的中文 `stops[].line` 喂回模型，导致全程说英语的客户突然听到中文 ——
   语言漂移的头号真凶。ask_analyst 的 `speech_text` 由模型按**客户语言**生成，
   事实 JSON 保持语言中立。

### B4. 延迟预算

**现状（实测，生产 API）：**

| 环节 | 耗时 |
|---|---|
| `areas/match`（fly_to_area）服务端 | ~10ms（197ms 全是我这边 RTT） |
| `analytics/recommend` / `compare` 服务端 | ~10–20ms |
| `analytics/investment` 服务端 | ~160ms |
| `analytics/report` 服务端（最重） | ~290ms |
| 客户浏览器 → Hetzner RTT | 视客户而定，迪拜↔法兰克福 ~120-160ms |
| **当前工具往返合计** | **~200–450ms** |

（注：这已经是 memory `plpgsql-case-predicate-index-trap` 修完之后的数字 ——
修之前 `/api/ai/analytics/*` 是 5.5-9.0s。）

**加大脑之后：**

| 配置 | 工具往返 | 模型生成 | 合计 | 判定 |
|---|---|---|---|---|
| `minimal` + prose | 0.3s | 1.6s | **~1.9s** | ✅ |
| **`minimal` + schema（推荐）** | 0.3s | 2.5–4.1s | **~2.8–4.4s** | ⚠️ 上沿偏高 |
| `low` | 0.3s | 5.0s | ~5.3s | ❌ |
| `high` | 0.3s | 7.3–10.4s | **~7.6–10.7s** | ❌ 完全不可用 |

**还要加上一段**：`sendToolResponse` 之后 Live 模型自己还要处理 + 起 TTS，
约 +0.5–1.0s。所以 schema/minimal 的真实端到端是 **~3.3–5.4s**。

**可接受上限。** 对照系统里已有的判断：VAD 的 `silenceDurationMs` 被特意调到 350ms
「让她答得几乎是瞬间」，注释里明说旧的 800ms 造成「10s+ latency」是事故
（VoiceAssistantContext.tsx:1101-1117）。人类对话的自然轮次间隙 < 500ms，
**语音助手 2s 是舒适上限，4s 是「需要听觉填充才能忍」，>5s 客户会以为断线。**

→ 结论：**必须配听觉填充**（§C3），且 `thinkingLevel` 不得超过 `minimal`。
若 schema 版本的 4.1s 上沿在真机上体感太差，退到 prose+minimal（1.6s）并把
`caveat` 用**提示词**要求而非 schema 强制。

**实测方法（三条，从粗到细）：**

1. **模型层单点**：复用我这次的做法 —— 写个一次性脚本调 `callGemini` 跑
   `minimal|low|high` 各 3 次取中位。**必须在生产容器里跑**
   （`docker exec` 进 pinzos API 容器），本机数字只能做相对比较。
2. **端到端**：`voice.tool.ms{tool="ask_analyst"}` 这个 histogram
   **不用新增埋点** —— `executeTool` 的包装层（:461-477）自动覆盖。
   上线后直接在遥测里看 p50/p95。
3. **人耳口径**：前端已有现成的 `[VoiceTiming]` 日志
   （VoiceAssistantContext.tsx:706-715，`logReplyLatency`），打印
   「用户停止说话 → Luna 首个 token」的毫秒数。开 `?lunatest=1` 用
   `window.__lunaTest.say()` 注入问题，读控制台。**这个数才是客户真实感受到的。**

---

## C. 迁移路径

### C1. 分组

**保留给 Live 模型直接调（12 个）** —— 低延迟纯动作、或纯查一个数、或已有专属可视化：

| 工具 | 理由 |
|---|---|
| `fly_to_area` | 纯动作，~10ms；且它的 AMBIGUOUS/NOT_FOUND 契约（:525-559）已经解决了「抢话」问题，是范本不是问题 |
| `search_projects` | 结果要立刻上地图 + 渲染卡片；富化逻辑在前端 :860-883 |
| `show_nearby_pois` / `navigate_to_project` | 纯图层/导航动作 |
| `present_place` | 已经是自带编排的「导览」，有专属 `guided_tour` 面板，不该再套一层 |
| `analyze_area_amenities` | 已自带评分 + `amenity_spokes` 可视化，是「算好了的」不是「平铺的」 |
| `capture_contact` | 前端本地执行（需要 visitorId），:622-650 |
| `purchase_costs` | 纯算数、无歧义、summary 已经很像人话（:929） |
| `get_area_info` | 单区快照，前端有富化（:915-932） |
| `project_value_check` | 单项目对标，输出已是一句结论（:920） |
| `measure_distance` / `compare_areas` 等 | 前端本就没声明，不动 |

**收进大脑（4 个，全部是「需要推理/多步/取舍」的）：**

| 工具 | 为什么该收 |
|---|---|
| `area_investment_report` | 12 个指标塞进一句 summary（:892 那行长得离谱），模型只能平铺；且它自带 `gaps` 需要判断哪个 gap 值得说 |
| `recommend_by_budget` | 「按 goal 排序」这件事本身就是取舍；且它的 `highlight_areas` 是死的（§0③） |
| `compare_market` | 「控制变量对比」的结论需要被**解释**，不是念 8 组中位数（:875-878） |
| `check_affordability` | 收入→可负担→选区，三步链式推理；`highlight_areas` 同样是死的 |

**边界情况：**
- `get_investment_breakdown` —— 与 `area_investment_report` 高度重叠。
  **第一阶段不动**，观察大脑接管 report 之后模型还调不调它；若基本不调，第二阶段删。
- `rent_vs_buy` —— 真需要推理，但它的 summary 已经给了明确 verdict（:943）。
  **放第二批**，第一批先验证架构。

### C2. 灰度：能，而且应该

**最小改动集（第一阶段，只迁 4 个）：**

| # | 文件 | 改动 |
|---|---|---|
| 1 | `backend/src/services/luna-analyst.ts` | **新建**。意图路由 + 并行取数 + 一次 callGemini + 数字后校验 |
| 2 | `backend/src/services/voice-assistant-tools.ts` | ① `voiceAssistantTools` 数组加 `ask_analyst` 声明（:436 后）② switch 加 `case 'ask_analyst'`（:946 后）③ **那 4 个 case 一行不删**（灰度回滚的开关就是前端声明，见下） |
| 3 | `frontend/src/contexts/VoiceAssistantContext.tsx` | ① `voiceTools` 里**删掉** `area_investment_report`(:206) / `recommend_by_budget`(:164) / `compare_market`(:192) / `check_affordability`(:219) 四个声明，**换成一个** `ask_analyst` ② `getToolDisplayName`(:442-461) 加一条文案 |
| 4 | `backend/src/routes/voice-token.ts` | `getSystemInstruction`(:49-103) 加 `SPEAK_VERBATIM` 规则（§B3-1） |

**为什么删前端声明就等于灰度开关**：模型只能调**前端声明过**的工具
（check-voice-tools.mjs 的核心断言就是这个）。后端 4 个 case 留着不删 →
`luna-eval-live.ts`（读后端那份，:172）仍能单独跑旧路径做 A/B 对照；
想回滚只需把 4 个声明加回前端，**零后端部署**。

⚠️ **改完必跑** `node frontend/scripts/check-voice-tools.mjs` —— 它会抓
「提示词引用了前端没声明的工具」这类漂移（memory `voice-tool-declaration-drift`）。

**第二阶段**（第一阶段跑稳 2 周后）：迁 `rent_vs_buy` + 视情况删
`get_investment_breakdown`；把 `highlight_areas` 补上 MapPage 的 case 或改发
`highlight_projects`。

### C3. 前端要改什么

1. **工具声明**（上表 #3）。`ask_analyst` 的 schema 建议：
   ```
   question: string*    ← 客户的原话，别让模型自己转述（转述=第一次信息损失）
   area?: string        ← 已知就填，省掉大脑的一次消歧
   budget?: number
   bedrooms?: number
   property_type?: string
   ```
2. **mapAction 处理 —— 不用改。** ask_analyst 只发**已有**的类型
   （`fly_to` / `highlight_projects`），MapPage 的 switch 已覆盖。
   ⚠️ **千万别发 `highlight_areas`** —— 它是死的（§0③）。
3. **「思考中」听觉反馈 —— 必须做，这是本次风险最高的一处。**
   现在只有视觉的 `setToolStatus`（:616，`getToolDisplayName` 的中英文案），
   语音场景里客户**看不见**。3-5s 静默 = 客户以为断线 = 会开口重问 = 触发 VAD 打断
   = 大脑白算。建议按成本从低到高选：
   - **(a) 最低成本、最有效**：`ask_analyst` 的 description 里写死一句
     「调用**前**先说一句简短的『让我算一下』（用客户的语言），然后**保持安静**直到结果返回」。
     这把空话变成**受控的、诚实的**填充语 —— 注意这与 §D1 不冲突：禁止的是
     「宣告一个尚未完成的动作」（"OK, flying to X"），允许的是「宣告我正在思考」。
   - **(b)** 复用已有的 `playerRef.current?.chime?.()`（:1062 在 activate 里已在用）
     做一声轻提示音。
   - **(c)** 前端 `executeTool`(:612) 里对 `ask_analyst` 加一个 >1.5s 的
     「仍在计算」二段提示。
   建议 **(a) + (b)**，(c) 视真机体感再说。
4. **`buildBubbleAttachment`**（:665-667）加 `ask_analyst` 的映射，否则复杂问题
   反而**没有卡片**（现在 area_investment_report 是有的），体验会倒退。

---

## D. 风险

### D1. 大脑思考期间 Live 模型会不会又开始说空话

**会 —— 而且这是本方案最大的新增风险。** 等待从 ~300ms 变成 3-5s，
模型「填补沉默」的冲动被放大一个数量级。

三层防御：

1. **工具 description 层（最直接，也是问的那一层）。**
   `ask_analyst` 的 description 里显式写清楚**它自己的输出契约**：
   > 这个工具返回的是**已经写好、数字已核对、可直接朗读**的一段话。
   > 调用它之前，只允许说一句简短的「让我算一下」。**不要预测它会返回什么，
   > 不要先给一个你自己的答案，不要在它返回后重写它的措辞。**

   ⚠️ **别把这段写成中文。** `DEVELOPER_ALIASES` 的注释（:40-46）记录了教训：
   提示词里**残留的任何中文块都是语言漂移的诱因**，few-shot 信号强度碾压规则行。
2. **系统提示词层**：`## HOW YOU WORK` 已有的「Never announce an action before its
   tool has returned」（voice-token.ts:69）本就是为这个问题写的，
   保留并追加 `SPEAK_VERBATIM` 规则（§B3-1）。
3. **跑分层**：`checkNoEmptyPromise`（luna-eval-live.ts:342-355）已经在测
   「答应了却没调工具」。见 §D2 扩展。

### D2. `luna-eval-live.ts` 怎么改

**先修一个既存缺陷（不改就白测）：** 脚本 :172 用
`convertToolsForSDK()` 读**后端** 22 个声明，而生产 Luna 拿到的是**前端** 16 个
（脚本自己在 :24-31 承认）。**迁移后这个缺口会致命** —— 后端仍留着旧 4 个 case
做灰度对照（§C2），跑分会同时看到 `ask_analyst` 和 4 个旧工具，
**测出来的行为和生产完全不是一回事**。

→ **必须先让脚本读前端那份声明**（正则解析 `VoiceAssistantContext.tsx` 的
`voiceTools`，check-voice-tools.mjs:32-34 已经有现成的解析写法可抄），
或者把声明收口到一处。这是迁移的**前置任务**，不是收尾任务。

**然后加检查：**

| 新增 | 内容 |
|---|---|
| `checkVerbatim` **（新，确定性）** | Luna 的回复与工具返回的 `speech_text` 做相似度比对（去标点后 token 重合率 >0.8）。低于阈值 = 她在改写大脑的话 = `SPEAK_VERBATIM` 没生效。**这是整个方案能否成立的唯一硬验收点。** |
| `checkNoEmptyPromise` **（扩展，:342）** | 现在只查「没调工具却许诺」。要加：**调了 `ask_analyst` 但在结果返回前就给了实质答案**（回复里出现工具返回之外的数字/结论）。 |
| `checkNumbersGrounded`（:288） | **不用改**，但要注意它现在从 `t.tools[].result` 抽数字池 —— ask_analyst 的 `result` 里必须带上原始事实 JSON（§B3），否则数字溯源会全红。 |
| 新 scenario `tag: 'analyst'` | 至少 4 条：①「商业湾一居室值不值」（该走 ask_analyst）②「100万预算买哪」③「期房比现房贵吗」④ **反向对照**：「带我去迪拜码头」**必须仍走 `fly_to_area`**，不许什么都塞给大脑 |
| 延迟断言 | `runScenario`（:159）记录每个工具的墙钟耗时；`ask_analyst` p50 >5s 直接判失败 |

`judge`（:379）的提示词也要加一句：**Luna 逐字复述 `SPEAK_VERBATIM` 内容不算
「念 JSON」，不扣分** —— 否则裁判会把正确行为判成机械。
（这个脚本已经因为「假红灯」踩过四轮坑，:467-483 的注释专门警告过。）

跑分前先存基线：已有 `scripts/luna-eval-baseline-2026-07-20.json`，
用 `--diff` 对比。⚠️ 有随机性，判定失败**先跑两遍**（脚本 :32-34 的警告）。

### D3. 失败回退

`apiFetch`（:75-79）**没有超时** —— 而 `callGemini`（gemini.ts:78）也没有。
一个卡住的 Gemini 调用会让客户对着静默的 Luna 等到 WebSocket 超时。**必须自己加。**

分层降级，**每一层都要能出声**：

| 触发 | 行为 |
|---|---|
| 大脑 >3.5s 未返回 | **`Promise.race` 硬超时**。取数已经拿到 → 回落到**旧工具的 `summary` 字符串**（那 4 个 case 留着没删，正好当降级路径）。客户听到的是今天的体验，不是静默。 |
| `callGemini` 抛错 | 同上。`callGemini` 自带 `[FLASH, FLASH_LITE]` fallback（models.ts:39），两个都挂才到这里 —— 那是真事故，`ai.call.exhausted` 会计数（gemini.ts:135）。 |
| 数字后校验不通过（§B3-2） | 重试 1 次；再失败 → **丢弃 speech_text，回落旧 summary**。宁可平铺，绝不播报没核对过的数字（memory `luna-tour-audit` 记的就是「ROI 数字全是编的且 AI 当事实播报」）。 |
| 取数本身失败 | 现有行为不变：`summary` 说「数据不足」，模型照实说。 |

**绝不能做的**：超时后返回 `{ success: true, summary: '' }`。
memory `silent-failure-paths` 记着这类「返回 200 但没干活」是审计重点；
`executeTool` 的 unknown-tool 埋点（:468）就是为此而生。
降级路径必须**单独打点**（建议 `counter('voice.analyst', { result: 'degraded'|'timeout'|'ungrounded' })`），
否则大脑常年在静默降级、看板上一片绿。

---

## E. 落地顺序

| 阶段 | 内容 | 验收 |
|---|---|---|
| 0 | **前置**：让 `luna-eval-live.ts` 读前端工具声明；存基线 | 跑分结果与生产同源 |
| 1 | `luna-analyst.ts` + 后端 `ask_analyst` case（前端**先不声明**） | `npx ts-node -T scripts/luna-eval-live.ts --only analyst` 能单独调到 |
| 2 | 生产容器内跑延迟探针 | p50 <3s，否则退到 prose/minimal |
| 3 | 系统提示词加 `SPEAK_VERBATIM` + 前端换 4 个声明 + 听觉填充 | `check-voice-tools.mjs` 绿；`checkVerbatim` >0.8 |
| 4 | `quick-deploy.ps1` → 真机复核（VAD/打断只能真机测） | `[VoiceTiming]` 日志 <4s |
| 5 | 观察 2 周：`voice.tool.ms{tool=ask_analyst}` + 降级计数 | 降级率 <5% |

**⚠️ 部署提醒**：改的是后端 → 按 memory `deploy-is-my-job`，
`cd backend; .\quick-deploy.ps1`。跑分打的是生产 API，**先部署再跑分**。

---

## 附：本次调研的实测原始数据

```
生产 API 服务端耗时（curl，含 ~190ms 本机 RTT）
  /api/ai/analytics/report?area=Business Bay&bedrooms=1   477ms
  /api/ai/analytics/recommend?budget=1500000&goal=balanced 200ms
  /api/ai/analytics/compare?vary=is_offplan&area=Marina    209ms
  /api/ai/analytics/investment?area=JVC                    353ms
  /api/ai/areas/match?q=Dubai Marina                       197ms / 197ms  ← 基本纯 RTT

gemini-3.5-flash 生成耗时（本机 → Google，同一 prompt）
  prose  + minimal   1420 / 1636 / 1668 ms   out 87/98/117     $0.0011–0.0014
  schema + minimal   4143 / 2495 ms          out 217/234       $0.0023–0.0024
  prose  + low       5041 ms                 out 1154          $0.0107
  prose  + high      7308 / 10387 ms         out 1477/2269     $0.0136–0.0208
```
