# Luna 质量修复 + 评测系统落地

日期：2026-07-20
前置：`docs/reports/2026-07-20-luna-voice-quality-root-cause.md`（五个根因的审计）

---

## 一句话结果

| | 修复前 | 修复后 |
|---|---|---|
| **Tier 1 工具层**（确定性，62 条断言） | **28/66 (42%)** | **62/62 (100%)** |
| **Tier 2 模型层**（真实 Live 会话 15 条确定性检查） | 无基线（评测本次才建） | **15/15 · 13/13**（两轮） |
| **裁判均分** | — | **4.36 / 4.82**（两轮，5 分制） |
| AVARRA by PALACE 1BR 年化回报 | **79.9%** | **13.2%** |
| 系统提示词 | ~4000 token | **~1030 token** |

基线存档：`backend/scripts/luna-eval-baseline-2026-07-20.json`

---

## 交付的两层评测

### Tier 1 — `backend/scripts/luna-eval.ts`

确定性、~10 秒、零 API 成本，可进 CI。测**工具有没有说真话**。

```bash
cd backend
npx ts-node -T scripts/luna-eval.ts                        # 打生产
npx ts-node -T scripts/luna-eval.ts --json after.json \
  --diff scripts/luna-eval-baseline-2026-07-20.json        # 跟基线对比
LUNA_EVAL_BASE=http://localhost:3000 npx ts-node -T scripts/luna-eval.ts
```

四个套件：

| 套件 | 断言 |
|---|---|
| A·区域解析 | 25 条黄金用例，含两起生产事故的原样复现；**每条都断言「不得错配」**；必须回 confidence；`village`/`dubai` 这类词必须承认歧义；查无此区必须报 not_found |
| B·ROI 理智 | 54 个项目 + detail 路由 8 个项目，年化 ≤30%、5 年增值 ≤本金 2 倍、收益率 0-15%；Business Bay 不得取到写字楼的 79.9%；重复查询结果必须稳定 |
| C·价格区间 | `min==max` 必须显式声明按「约等于」处理 |
| D·0 结果出路 | 空结果必须带 `relaxation.blocking_filter` 和可执行候选 |

⚠️ **它打的是已部署的 API**。改完后端先 `.\quick-deploy.ps1` 再跑分。

### Tier 2 — `backend/scripts/luna-eval-live.ts`

真模型、真提示词、真工具。用 `ai.live.connect()` 从 Node 直连**生产同款** `gemini-2.5-flash-native-audio-preview`，喂 `getSystemInstruction()` 和 `voiceAssistantTools`，工具走 `executeTool()` 真执行；差别只有**文字注入代替麦克风**。

```bash
cd backend
LUNA_TOOLS_API_BASE=https://api.pinzos.com npx ts-node -T scripts/luna-eval-live.ts
# --verbose 打印完整对话  --only lang 只跑某类  --json/--diff 做对比
```

11 条用例全部取自 2026-07-08~17 的真实对话。判定分两层：

**确定性检查（硬证据，裁判无权翻案）**
- 语言一致性：客户说英文，回复不得含中文
- 禁提区域：不得把另一个区当成答案讲
- 遵守工具的不确定信号：工具回 `AREA_AMBIGUOUS`/`AREA_NOT_FOUND` 时不许自信开讲
- 数字溯源：回复里每个大额数字必须能在工具返回（或用户原话）里找到，5% 容差
- 不放空话：答应了「这就带您看看」却没调任何工具 = 失败

**LLM 裁判（补充信号）**
gemini-3.5-flash 打 1-5 分 + 单独报 `handledLimitationWell`。

**两条限制必须知道：**
1. **测不到 VAD/打断/音频质量** —— 文字注入没有麦克风，「被背景噪音掐断」只能真机复核
2. **有随机性** —— 同一条用例可能这次过下次挂。判定失败先跑两遍再下结论

---

## 修了什么

### 1. 区域匹配：从字母序抽奖改为 IDF 加权打分

`backend/src/services/area-matcher.ts` 整个重写。

**旧版**三级 SQL cascade，第三级是「命中任意一个 >2 字符的词就算候选」+ `ORDER BY priority, name LIMIT 1`（**tie-break 是字母序**）。

**新版**：`dubai_areas` 只有 232 行 → 全量载入内存打分，不跟 SQL 较劲。

- **IDF 加权**是关键：`dubai` 出现在 20+ 个区名里（几乎无信息量），`harbour` 只出现 2 次（高信息量）。旧版一视同仁，所以 `dubai` 成了万能通配符
- 打分 = `queryCoverage^0.75 × candCoverage^0.25`，偏向 query 覆盖（否则短 query "JVC" 永远赢不了长区名）
- 词级模糊匹配（Levenshtein）解决 Harbor↔Harbour、Hartland↔Heartland
- **margin 规则**：top1 与 top2 差距 <0.08 判定歧义，返回候选而不是猜
- **精确命中一律直接返回，跳过 margin 判定** —— 栽过一次：查 `Damac Hills` 因为库里有 `Damac Hills 2`（`"2"` 这个 token IDF 极低）被判成歧义
- 归一化处理了库里的真实脏数据：8 个区名带首尾空格、混着中文注释、`"‏Trade Center First"` 开头有 U+200F 控制符、拼写错误遍地

**返回契约改了**：`matched` / `ambiguous` / `not_found` + `confidence` + `candidates` + **`asked`（永远保留用户原话）**。

向后兼容层（`findAreaByName` 等）保持签名不变，但行为改为**不确定时返回 null 而不是返回一个错的区**。

### 2. 同一个 bug 的第二处（Tier 2 找出来的）

`backend/src/routes/ai-projects.ts` 的 `buildSearchWhere` 里藏着**一模一样**的「命中任意 >2 字符的词」模式，作用在 `residential_projects.area` 上。修 area-matcher 时漏了这条 —— **模型层跑分的 `jvc-parens` 用例当场把它揪出来**。

现在：先用 `resolveArea()` 解析出规范区名，拿它 + 用户原话去匹配；**词级 OR 那层整个删掉**。

### 3. ROI：usage 过滤 + clamp + 扣费

- `ai-projects.ts` 两处查询加 `dam.usage = 'residential' AND dam.segment = 'all'`，并补 `, dam.id` 做确定性 tiebreak（旧版无 tiebreak，同一项目的 `area_growth` 会在 14.2 和 8.5 之间飘）
- `investment-calculator.ts`：growth clamp 到 (-10%, +20%)、扣 6% 交易成本、返回 `assumed_growth_pct`/`growth_was_clamped`/`fees_aed`
- **sanity 闸门**：算完年化 >30% 直接返回 `null` + `console.warn`，宁可不显示也不播错

实测：AVARRA by PALACE 1BR（270 万 AED）**79.9% → 13.2%**。
顺带被 clamp 兜住的真实脏数据：International City 的 GREENZ `price_growth_pct = 42.5` → clamp 到 20。**79.9 不是孤例。**

### 4. 价格区间与 0 结果

- `min_price === max_price` → 展开 ±20%，响应带 `interpreted_as`
- 0 结果走 `diagnoseZeroResults()`：并行试算各条件放宽后的命中数，返回 `relaxation.blocking_filter` + 可直接回调的 `suggestions`

### 5. 语言乱跳（三处）

- **`present_place` 的 summary** 原本是一条**中文祈使句**（"请用口语顺着把这三站讲出来…"）+ 中文 narration。这不是数据是指令 —— 语言乱跳的头号真凶。改为语言中立的结构化英文 facts，UI 面板的中文 `line` 保留但**不再喂给模型**
- **`khda_rating_zh` 等中文字段**不再进模型，改传语言无关的官方英文档位
- **开发商中文别名表从提示词搬进工具层**（`normalizeDeveloper()`）。提示词里**残留的任何中文块都是漂移诱因** —— 跑分抓到过「带您 看看 迪拜 码头。Dubai Marina is a stunning…」

### 6. 提示词重写：4000 → ~1030 token

删掉的：20+ 个工具触发词枚举（那是工具 description 的职责）、所有禁词令（「NEVER say 抱歉」会逼模型编造，而且生产日志证明它根本没被遵守）、「信任 fuzzy match」那句误导、130 行中文实体词表。

新增的：语言规则**放最顶部**并写死「工具返回什么语言都不影响你说什么语言」；`AREA_AMBIGUOUS`/`AREA_NOT_FOUND`/`relaxation` 的处理约定；「投资数据缺失时不许自己补」（配合 sanity 闸门）；**「工具没返回前不许宣布动作」**。

### 7. 前端（已改完、已 typecheck，**尚未部署**）

- `prefixPaddingMs` 300 → 700（sensitivity 一档没动）。注释与代码原本已漂移——写着 "kept CONSERVATIVE (LOW + 400ms)" 而代码是 HIGH + 300ms，已同步并写明依据（有 interruption 的会话「结尾无标点」27.1% vs 无 interruption 13.3%）
- interrupted 分支补 `finalizeAssistantMessage({ interrupted: true })` —— 旧版早退不 flush，导致转写与下一轮**字符串粘连**，数据本身不可信
- `search_projects` 的 min/max schema 补上区间语义

---

## 评测系统自身的三次校准（值得单独记）

**评测第一版有 bug，而且是危险的那种 —— 它会凭空捏造缺陷。**

1. **裁判被诱导**：我把用例的 `why` 字段（描述的是**历史 bug**）当成「本用例关注点」喂给裁判，还只给了工具名没给工具返回值。结果裁判"确认"了它被告知的 bug —— `jvc-parens` 被打 1/5，判词是「工具返回了 Jebel Ali Village，Luna 张冠李戴」，而生产实测 `areas/match` 返回的是 `JVC Jumeirah Village Circle` 置信度 1.0，Luna 讲的数字也全对。**整条判词是编的。**
   → 现在：不给历史结论，只给真实工具返回，并明确要求「没在工具输出里看到就不许断言」。

2. **禁词表误伤诚实行为**：`harbor-typo` 把 `Creek Harbour` 列进禁词，但 Luna 主动说明「搜到的多是 Creek Harbour 而非 Dubai Harbour」恰恰是我们想要的。

3. **正则追不上自然语言**：「有没有优雅处理局限」这条判据我改了四轮正则，每次都是模型做对了却被判红（`Did you mean…` / `Would you like…` / `could mean A, B, or C` / `can't` 匹配不到 `cannot`）。最后一次的回复是教科书级的 `Which "Village" area are you interested in: Jebel Ali Village, JVC…`，正则依然判失败。
   → **这个维度本来就是判断题，交给裁判**；真正确定性的东西仍全部走确定性检查。

**教训：假红灯比漏报更伤 —— 跑分一旦不可信，就没人会再看它。**

---

## 残留问题（诚实记录）

1. **模型偶尔抢在工具返回前开口**：`"OK, flying to The Village."` 然后才说「这可能指几个地方」。加了提示词约束后减轻但未根除。**这是原生音频 Live 模型的固有行为，两层架构才是真正的解法。**
2. **语言偶发漂移**：清掉提示词里的中文后大幅减少，但 Tier 2 多轮跑仍偶见。同上，模型能力所限。
3. **VAD 效果未经真机验证** —— 评测测不到，需要在有背景噪音的环境实际打一通。
4. **前端未部署** —— 改动已完成并 typecheck 通过，但需要 git commit + push 才会经 CF Pages 上线。

---

## 未做（下一步）

**两层架构**（Live 模型只当嘴和耳朵，服务端 `gemini-3.5-flash` + `thinkingLevel:'high'` 当大脑）。这是唯一能给真正 think process 的改动，也是残留问题 1、2 的根治方案。**现在有了两层评测网兜底，改起来安全得多。**

配套：工具从 22 个收缩到 3-5 个，其中一个是 `ask_analyst(用户原话)`。

---

## 关键文件

| 路径 | 说明 |
|---|---|
| `backend/scripts/luna-eval.ts` | Tier 1 工具层跑分 |
| `backend/scripts/luna-eval-live.ts` | Tier 2 模型层跑分 |
| `backend/scripts/luna-eval-baseline-2026-07-20.json` | 修复前基线（28/66） |
| `backend/src/services/area-matcher.ts` | IDF 加权打分匹配（重写） |
| `backend/src/routes/ai-areas.ts` | `/match` 返回 status + confidence + candidates |
| `backend/src/routes/ai-projects.ts` | usage 过滤 / 区间展开 / 0 结果诊断 / 区域匹配收口 |
| `backend/src/services/investment-calculator.ts` | clamp + 扣费 + sanity 闸门 |
| `backend/src/services/voice-assistant-tools.ts` | present_place / fly_to_area 新契约、summary 去中文化、开发商别名 |
| `backend/src/routes/voice-token.ts` | 提示词（~1030 token） |
| `frontend/src/contexts/VoiceAssistantContext.tsx` | VAD padding、interrupted flush、schema 区间语义 |
| `frontend/src/hooks/voice-assistant/debugLogger.ts` | `interrupted` 标记（可统计截断率） |
