# AI 成本计量与预测 —— 现状、缺口、这次做了什么

**日期**:2026-08-01
**触发**:Google Cloud 2026-07 账单 CA$197.80(税前 CA$176.61),想知道钱花在哪、以后换模型会怎样

---

## 一、结论先说

1. **账面上的 AI 成本原来是错的,而且是偏低的。** 全站只有 11 个走 `callGemini` 的
   文本调用在记 token 和钱;**三条最贵的链路一分钱都没记**:
   - PDF 楼书管线(9 个 agent,跑在独立 worker,用旧 SDK)
   - Tour 旁白合成 TTS(按**音频** token 计价,单价比文本高一档)
   - Luna 实时语音(前端直连 Gemini Live,后端根本不在链路上)

2. **有记录的那部分很便宜。** 生产库近 30 天全部 `ai.cost.usd_micro` 合计
   **≈ $4.83**(tour-generator 占 $3.77)。也就是说 CA$197.80 的账单里,
   **Gemini 文本调用连 2% 都不到** —— 大头在别处(其它 GCP 服务,或上面那三条没计量的链路)。
   这次改完,下个月就能把「别处」定位到具体功能。

3. **换模型的问题现在有数据可依。** 新增「换模型要多少钱」:拿最近 7 天**真实发生**的
   进/出 token 量,按每个候选模型的单价重算月成本。不是听说谁便宜,而是按自己的
   进出比例算 —— 输出 token 占比高的任务对「输出贵」的模型特别敏感,只看输入单价会得出反的结论。

---

## 二、原来的样子(缺口盘点)

| 链路 | 次数 | 耗时 | 失败 | **token** | **钱** |
|---|:--:|:--:|:--:|:--:|:--:|
| `callGemini` 的 11 个文本功能 | ✅ | ✅ | ✅ | ✅ | ✅ |
| PDF 楼书管线(9 个 agent) | ✅ | ✅ | ✅ | ❌ | ❌ |
| Tour TTS | ❌ | ❌ | ❌ | ❌ | ❌ |
| Luna 实时语音 | ❌ | ❌ | ❌ | ❌ | ❌ |

另外两个结构性问题:

- **单价表绑死 Gemini**:`models.ts` 里的 `PRICING` 只有三个文本模型,`costUsd()` 对未知模型
  一律按 FLASH 估。TTS 和 Live 就算记了,按文本价算也是错的(音频输出单价是文本的 6 倍)。
- **没有预测**:24 小时的成本表回答不了「月底账单多少」。等账单来,钱已经花掉了。

---

## 三、这次做了什么

### 1. 单价层重写:`backend/src/services/ai/pricing.ts`

key 是 **`provider:model`**,价格按**模态**拆开:

```ts
{ provider, textIn, textOut, audioIn?, audioOut?, cachedIn?, asOf, verified }
```

- 加一个新家族(OpenAI / Anthropic / 别的)= 往表里加几行,`costUsd()` 一行不改
- 每条带 `asOf`(核对日期)和 `verified`(是否对过官方价格页)——
  **价格没有 API 能查,只能人肉核对**,所以必须让「多久没核对」这件事可见
- `whatIfUsd(target, totals)` = 换模型试算的底层

`models.ts` 只保留模型名(会因为 Google 关停而变),价格搬走 —— 两者变化的原因不同。

### 2. 补齐三条漏计量的链路

| 链路 | 做法 | 侵入度 |
|---|---|---|
| PDF 管线 | 新增 `langgraph/utils/metered-genai.ts`,包一层读 `usageMetadata` | 每个 agent **改一行**,调用逻辑零改动 |
| TTS | `luna-tour/tts.ts` 里加 `meterTts()`,按模态拆输出 token | 加一个函数调用 |
| Luna Live | 前端按 `(dir, modality)` 报增量 token → RUM 白名单 → 后端按单价算钱 | 前端一个 helper |

**为什么 PDF 管线不直接迁到新 SDK**:那是 9 个文件的行为改动(每个都有自己的
timeout/race/retry/JSON 修复),而楼书解析是收钱的核心链路。这一层只做一件事 ——
把 usage 读出来上报。

**Live 的两个设计决定**:
- 成本上报**不受额度豁免影响**。分享的 tour 对经纪免额度,但**token 照样花钱**。
  把它一起跳过,正是 Luna 成本在看板上一直是 0 的原因之一。
- 客户端**只报 token 数,不报钱**。钱在服务端按单价算 —— 成本数字绝不能让客户端传。

### 3. 预测 + 换模型试算(`aiForecast` / `aiWhatIf`)

- `perDay7` / `perDay30` / **`projectedMonthlyUsd`(= 7 日均 × 30)**
- `trend` = 7 日均 ÷ 30 日均。>1 = 在涨,一眼看出是不是最近突然开始烧钱
- 按功能拆:月成本 + **每次调用多少钱**(优化先看单次成本,再看总量)
- 换模型试算:候选模型按重算后的月成本排序,并标出哪些单价「待核对」

⚠️ **试算的前提**:各家 tokenizer 切分不同(±10~30% 常见),这里按等量 token 估算。
**用来排序和判断量级,不是报价单。**

### 4. 告警 `AI_COST_SPIKE`

盯的不是「花了多少」而是「花得多快」:一分钟 AI 支出超阈值就报。
默认 $0.50/分钟(≈ $720/月的速率,远高于当前实际)。
这个阈值触发时,通常是**重试风暴或某个调用在打转**,不是流量真涨了。
可用 `AI_COST_BUDGET_PER_MIN_USD` 调。

### 5. 巡检脚本 `scripts/check-ai-pricing.ts`

```bash
cd backend && npx ts-node -T scripts/check-ai-pricing.ts
```

① 列出过期(>90 天)或没核对过的单价,附官方价格页链接
② 抓「在用的模型没有单价」—— 那种会静默按兜底价算,看板上的数字就是编的
③ 抓代码里绕过 `pricing.ts` 裸写单价的地方

**当前有 7 条待核对**(4 条 Gemini 语音 + 3 条 OpenAI)——
Gemini 语音的单价是按官方文档口径推的,OpenAI 的来自公开报价页,都没逐条对过官方价目表。

### 6. Admin 面板

「AI 成本」tab(原「AI & 管线」)新增两张卡:
- **月成本预测**:预计本月 / 日均 / 趋势 / 30 天柱状趋势 / 按功能拆(含单次成本)
- **换模型要多少钱**:候选模型 × 重算月成本,便宜的标绿,未核对单价的打黄标

顺手把 13 个 tab 分成三组:**生意**(有没有人用)/ **钱**(谁在付费)/ **系统**(机器 & 成本)。
组由当前 tab **推导**,不是第二份 state —— 否则告警横幅 `setTab('perf')` 会切了内容
但导航停在旧组,看起来像点了没反应。

---

## 四、下一步(没做的)

1. **核对那 7 条单价**(半小时的事,但必须人去官网看)。在此之前,语音成本的绝对值
   只能当量级参考。
2. **等一周数据**再看预测 —— 新计量的三条链路要跑够一个周期,数字才有意义。
3. **账单对账**:下个月拿 Google Cloud 账单和看板的 `projectedMonthlyUsd` 对一次。
   对不上说明还有链路没计量(或者大头根本不是 Gemini,而是别的 GCP 服务)。
4. `metrics_minute` 只留 90 天 → 拉不出更长的成本趋势。要看年度趋势得单独落一张日汇总表。

---

## 五、改完要跑的

```bash
cd backend && npx ts-node -T scripts/check-ai-pricing.ts     # 单价巡检
cd backend && npx ts-node -T scripts/check-gemini-models.ts  # 模型还活着没
cd backend && npx ts-node -T scripts/verify-telemetry.ts     # 改 telemetry/* 必跑
```
