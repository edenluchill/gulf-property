# 全站 feature 遥测接入 + 审计发现 — 2026-07-13

盘完 40+ 路由，把通用遥测（`docs/telemetry-spec.md`）接到所有关键流程。
**过程中发现的 bug 比埋点本身更值钱** —— 全部是「正在生产上发生、但没人看得见」的那种。

---

## 一、发现的真 bug（按伤害排序）

### 1. 🔴 AI 模型已 404，楼书的项目描述生成一直在失败

`gemini-3-pro-preview` **已被 Google 关停**（实测：`This model is no longer supported`）。
它写死在 `langgraph/agents/project-description-generator.agent.ts` ——
**每传一份楼书，项目描述那一步都必然失败**，`withRetry` 重试 3 次后抛错，
只留一行 `console.warn`。**没有任何人会知道。**

另外 8 个抽取 agent 用的 `gemini-3-flash-preview` 也已废弃（暂时还能调，但随时会关）。

**根因**：模型名散在 20+ 个文件里各写各的（同一行 `const MODELS = [...]` 的注释
被复制了 6 遍）。上一轮修模型名只修了 luna-tour 那一半，**PDF 管线整条漏掉了**。

**已修**：模型名收口到 `services/ai/models.ts` 单一真相源，代码里**零裸写**。

### 2. 🔴 Stripe webhook 有两条「收了钱没发货」的静默路径

`billing.ts` 的 `upsertSubscription` 里：

| 位置 | 情况 | 后果 |
|---|---|---|
| :975 | webhook 找不到对应的 agent | **客户付了钱，订阅没开通** |
| :998 | price 映射不到套餐 | 同上，而且是**批量的**（price 配错 = 所有新订阅都不开通） |

两处都是 `console.warn` + `return`，而 webhook **仍然回 200** ——
Stripe 认为一切正常，**不会重试**。这是全流程唯一「收钱不发货」的路径。

**已修**：立案计数 + `BILLING_PAID_NOT_PROVISIONED` 告警（任何一次都发邮件）。

### 3. 🔴 API 部署会误杀 worker 正在跑的任务

`recoverInterruptedTasks()` 在 **API 进程**启动时，把所有 `processing` 的任务
一把刷成 `failed`。但 **PDF 跑在 worker 进程**（两个独立容器）。

于是每次 `quick-deploy.ps1`（天天跑）都会把 worker **正在处理**的 job 标成失败；
worker 全然不知，跑完又把它改回 `completed`。**状态来回跳，失败率指标全是假的。**

**已修**：只清理 **20 分钟无进展** 的真孤儿（单个 job 约 2.6 分钟，20 分钟足够宽容）。
正在跑的 job 会持续更新 `updated_at`，不会被误杀。

### 4. worker 进程从来没有遥测

worker 是独立进程、独立镜像，API 里那句 `startTelemetry()` 它根本跑不到。
**全站最重、最容易卡住、失败最伤客户的流程，内部完全是盲的** ——
客户传了 500MB 楼书，失败了只有 `docker logs` 里一行 `console.error`。

而且**卡住的任务完全没有检测**：worker 被 OOM kill 的 job 会**永久停在 processing**，
不会重试、不会告警、没人知道。

**已修**：`telemetry/worker.ts` —— 队列深度/队首等待/卡死数/worker 内存，
外加 `PDF_JOB_STUCK` 告警。

### 5. Tour 语音的「假成功」

`generateSessionAudio` **设计上从不 throw** —— 11 拍全失败也照样 resolve，
调用方于是把 job 标成 `ready`。**经纪看到「生成成功」，客户点开听到的是浏览器机器音。**

**已修**：`tour.audio.session{result: ok|partial|none}`，并且只有全部拍成功才算
漏斗里的 `audio_ready`。

### 附：语音工具漂移是隐形的（已验证）

工具声明在**三处**（前端声明 / 后端执行器 / 提示词），会漂移。漂移后 `executeTool`
的 default 分支返回 `Unknown tool: X`，但 HTTP 是 **200 + success**。

生产实测：调一个根本不存在的工具 → **返回 200**。
现在被记为 `voice.tool{result: unknown}`（已在生产验证到）。

---

## 二、AI 调用收口

之前：**20+ 个文件各自 `new GoogleGenAI`、各自写模型名、各自 for-try-catch fallback**，
**两套 SDK 并存**，**全 backend 没有一处读 `usageMetadata`** —— 花了多少钱、
哪个功能在烧，完全不知道。

现在：

- `services/ai/models.ts` —— 模型名 + 价格的**单一真相源**，附 `costUsd()`
- `services/ai/gemini.ts` —— 统一入口 `callGemini()`：单例 client · 模型 fallback ·
  计时 · 错误分类 · **token → 美元** · 埋点
- `scripts/check-gemini-models.ts` —— ① 每个模型真调一次看还活着没
  ② **扫代码里有没有人绕过常量裸写**（这个检查当场抓出了我自己漏掉的一个文件）

埋出来的指标：`ai.call{task,model}` / `ai.call.ms` / `ai.call.failed{task,reason}` /
**`ai.call.fallback`（主模型挂了退到备用 = 模型漂移的哨兵）** /
`ai.tokens{task,dir}` / `ai.cost.usd_micro{task}`。

---

## 三、埋点落点（全部是「一处覆盖一片」的窄点）

| 埋在哪 | 一处覆盖了什么 |
|---|---|
| `credits.ts` 的 `creditError` / `spend` / `settleCallUsage` | 全站 **9 个 paywall 门**、所有扣费、Agora 计量 |
| `billing.ts` webhook 入口 + 两个静默 return | 所有 Stripe 事件类型 + **收钱没发货**立案 |
| `voice-assistant-tools.ts` 的 `executeTool` | **23 个语音工具**（语音/文字/Live 三条调用路径） |
| `langgraph/utils/ai-retry.ts` 的 `withRetry` | 整条 PDF 管线的 AI（重试/耗尽/耗时/失败原因） |
| `audio-pipeline.ts` 的逐拍循环 | tour 语音的真实成败（4 个调用方全覆盖） |
| `worker/index.ts` + `telemetry/worker.ts` | PDF 队列/卡死/worker 内存 |

**漏斗**：`tour.publish` = 生成 → 草稿 → 发布 → 语音就绪 → **客户真的点开看了**。
最后一步之前，整条生成链路的价值都是零。

---

## 四、新告警

| 告警 | 触发 | 为什么 |
|---|---|---|
| `BILLING_PAID_NOT_PROVISIONED` | 任意一次 | **客户付了钱没开通** —— 最严重 |
| `STRIPE_WEBHOOK_SIG_FAILED` | 任意一次 | 所有付款事件都进不来 |
| `AI_MODEL_GONE` | 任意一次 | **就是上面那个 404，以后当天就会报出来** |
| `AI_EXHAUSTED` | ≥3 次 | 整条模型链全挂 = 该功能对客户是坏的 |
| `PDF_QUEUE_BACKLOG` | 队首等 >15min | worker 卡死或排队过长 |
| `PDF_JOB_STUCK` | ≥1 个 | OOM 留下的孤儿，永远不会重试 |
| `WORKER_MEMORY_HIGH` | >6GB / 共 8GB | 再涨就被 OOM kill |

---

## 五、Admin 新 tab「AI & 管线」

- **AI 成本**：按功能（task）拆开 —— 谁在烧钱、谁在失败、谁在降级到备用模型
- **PDF 管线**：队列深度 / 队首等待 / **卡死数** / worker 内存 + 各抽取 agent 的成败
- **Tour 漏斗**：生成的 tour 到底有没有人看
- **被 paywall 挡住的人**：想用但用不了 —— 转化漏斗里最热的线索

---

## 六、还没做的（明说）

- ~~**PDF 管线的分阶段耗时**~~ → **已做**（2026-07-13 稍晚）：`workflow-executor.ts` 的
  6 个阶段（text_layer / imagegen / chunking / ai_batch / reduce / report）已逐段计时。
- **langgraph 仍用旧 SDK**（`@google/generative-ai`），没走 `callGemini`，
  所以 **PDF 管线的 AI 成本还没有计入**（只有次数/失败/耗时）。迁到新 SDK 是
  10 个文件的机械替换，风险可控但没在这一轮做。

### ⚠️ 本报告的一处错误（2026-07-13 更正）

原文这里写着：

> ~~`processing_logs` / `debug_snapshot` 是**死代码**（`logToDB()` 全库零调用），
> 所以 admin 的任务日志页永远是空的。~~

**这是错的。** 大扫除时去验证，发现：

- `logToDB()` 有 **6 处调用**（都在 `workflow-executor.ts` 里，`executePdfWorkflow` 的主路径上）
- `processing_logs` 列里 **33 个任务有日志**
- **admin 的任务日志页是能用的**

只有 `debug_snapshot` 是真死的（`updateDebugSnapshot()` 零调用、列 0 行数据），已删除。

**教训：分析报告本身也会错。清理 dead code 前必须逐条 grep 验证 ——
差一点就按这份报告删掉了一个正在工作的日志功能。**

---

## 复现 / 巡检

```bash
cd backend
npx ts-node -T scripts/check-gemini-models.ts    # 模型活性 + 代码里有没有裸写(发版前跑)
npx ts-node -T scripts/verify-telemetry.ts       # 遥测系统回归(25 项)
```
