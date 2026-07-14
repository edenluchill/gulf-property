/**
 * perfMetrics — per-request latency/status sampler. Feeds services/perfSink.
 *
 * Mounted early (before routes) in index.ts. Never touches the response; on
 * 'finish' it records duration + status + concurrency into the in-memory sink.
 * Fail-safe: any error here is swallowed so telemetry can't break a request.
 */
import { Request, Response, NextFunction } from 'express'
import { recordRequest, recordEndpoint, recordError, recordSlow, SLOW_REQ_MS, incConcurrency, decConcurrency } from '../services/perfSink'

// Health checks and the metrics endpoints themselves would skew the numbers.
const IGNORE = new Set(['/health'])

/**
 * 耗时「设计如此」的路径 —— 不进延迟分位样本(仍计 req / 错误率 / 并发)。
 *
 * ① 长连接:大文件上传(几十秒~几分钟)、SSE 进度流。
 *    2026-07-07 实锤:**一条 142s 的上传把 5 请求窗口的 p95 干到 142083ms** → 误报。
 *
 * ② **AI 生成接口**(2026-07-13 加):它们要等 Gemini 出结果,**3–15 秒是正常的**,
 *    不是"慢"。2026-07-14 05:17 的 HIGH_LATENCY 告警里就混着一条
 *    `POST /api/luna/agent/sessions/:id/ai-edit 3625ms` —— 那是 Luna 在改文案,
 *    调一次 Gemini,3.6 秒完全正常。低流量时(告警窗口只有 9 个请求)一条 AI 调用
 *    就能把 p95 顶过 2000ms 阈值 → **告警会反复误报,然后没人再看告警**。
 *
 *    ⚠️ 排除它们**不等于不监控** —— AI 的耗时/失败/成本有专门的指标:
 *    `ai.call.ms{task}` / `ai.call.failed` / `ai.cost.usd_micro`(见 services/ai/gemini.ts),
 *    而且比 HTTP p95 精确得多(能拆到是哪个 task、哪个模型、有没有降级)。
 */
const LONG_LIVED_PREFIXES = [
  '/api/upload', '/api/r2-upload', '/api/langgraph-progress',   // ① 上传 / SSE
]

/**
 * ② **真正同步等模型出结果**的接口 —— 只有这几个。
 *
 * ⚠️ **别按路径名猜。** 2026-07-14 我第一版把 `/api/ai/*` 和 `/api/compare` 整个排除了,
 * 理由是"名字里有 ai,肯定慢"。**错得离谱**:
 *   · `ai-analytics.ts`(investment / recommend / affordability / rent-vs-buy …8 个端点)
 *     —— **零 AI 调用**,全是 SQL + PG 函数(`area_investment_report()`)
 *   · `ai-projects.ts` / `ai-areas.ts` / `compare.ts` —— 同样**零 AI 调用**
 *   路径里的 `ai` 只是「给 Luna 用的数据接口」的命名习惯。
 *
 *   于是 `/api/ai/analytics/investment` 那个**真实的 5–9 秒慢查询**
 *   (owner 在 dashboard 上一眼看到的)被我当成"AI 天生慢"**藏起来了**。
 *   **把真问题排除出监控,比没有监控更糟。**
 *
 * 也别把 tour 的 create / render 算进来 —— 它们**立即 res.json 返回**,
 * AI 在后台跑,HTTP 耗时本来就短(几十毫秒)。
 *
 * 判据只有一个:**handler 里有没有 `await` 一个会调 Gemini 的函数。**
 * 已逐个 grep 确认:
 *   · POST …/sessions/:id/ai-edit        → await revise()          调 Gemini
 *   · POST …/clients/profile-coach       → await coachProfile()    调 Gemini
 *   · POST …/client-reports (+ /report)  → await buildClientReport() 调 Gemini
 *
 * 排除 ≠ 不监控:AI 的耗时/失败/成本由 `ai.call.ms{task}` / `ai.call.failed` /
 * `ai.cost.usd_micro` 单独盯着(services/ai/gemini.ts),比 HTTP p95 精确得多。
 */
const AI_SYNC_PATTERNS = [
  /\/ai-edit$/,                          // Luna 改文案(await revise)
  /\/clients\/profile-coach$/,           // 客户档案教练(await coachProfile)
  /\/client-reports$/,                   // 客户匹配报告(await buildClientReport)
  /\/luna\/agent\/report$/,              // 同上,另一个入口
]
function isLongLived(path: string): boolean {
  return LONG_LIVED_PREFIXES.some((p) => path.startsWith(p))
    || AI_SYNC_PATTERNS.some((re) => re.test(path))
}

/**
 * Stable, low-cardinality key for the per-endpoint table. Prefer the matched
 * Express route template (baseUrl + route.path → "/api/residential-projects/:id",
 * which already collapses ids). Fall back to a heuristic that swaps id-like path
 * segments for ":id" so unmatched/404 paths don't explode cardinality.
 */
function endpointKey(req: Request): string {
  const routePath = (req.route && req.route.path) || ''
  if (routePath) {
    const tmpl = (req.baseUrl || '') + (routePath === '/' ? '' : routePath)
    return `${req.method} ${tmpl || '/'}`
  }
  const norm = req.path
    .split('/')
    .map((seg) =>
      /^\d+$/.test(seg) || /^[0-9a-f-]{16,}$/i.test(seg) ? ':id' : seg
    )
    .join('/')
  return `${req.method} ${norm || '/'}`
}

export function perfMetrics(req: Request, res: Response, next: NextFunction): void {
  if (IGNORE.has(req.path)) return next()

  const start = process.hrtime.bigint()
  let counted = false
  incConcurrency()

  // ⚠️ 必须在入口(app 级中间件、进任何子路由之前)算好长连接判断:进入挂载在
  // /api/r2-upload 的子路由时 Express 会临时把 req.url 剥成 /start,而 done() 跑在
  // 异步的 res.on('finish') 里——那时 req.path 可能已不是完整路径,前缀匹配失效,
  // 上传请求就漏回 p95 样本(2026-07-09 实测:一次 2665ms 上传顶爆 HIGH_LATENCY,
  // 排除逻辑明明已部署却没生效,根因即此)。这里锁定,done() 只读闭包变量。
  const longLived = isLongLived(req.path)

  const done = () => {
    if (counted) return
    counted = true
    try {
      decConcurrency()
      const ms = Number(process.hrtime.bigint() - start) / 1e6
      // 长连接不进全局延迟分位(报警口径);端点表仍记真实耗时(展示用,诚实)。
      const key = endpointKey(req)
      const who = req.ctx?.email || req.ctx?.visitorId || null
      recordRequest(res.statusCode, ms, longLived)
      recordEndpoint(key, res.statusCode, ms)
      // Every 5xx is captured whole — who ate it and on which URL. Unsampled:
      // this is the record that has to survive long enough to be root-caused.
      if (res.statusCode >= 500) {
        recordError(key, res.statusCode, String(req.originalUrl), who)
      }
      // Same for every slow request. Long-lived paths (uploads/SSE) are slow by
      // design and don't count toward p95, so they're excluded here too — this
      // records exactly the requests that can raise a HIGH_LATENCY alert, which
      // is what makes such an alert diagnosable at all.
      if (!longLived && ms >= SLOW_REQ_MS) {
        recordSlow({
          endpoint: key,
          url: String(req.originalUrl),
          status: res.statusCode,
          ms: Math.round(ms),
          who,
          aborted: !res.writableFinished,
        })
        console.log(`[perf] slow-request ${Math.round(ms)}ms ${key} ${String(req.originalUrl).slice(0, 140)} status=${res.statusCode} who=${who || '-'} aborted=${!res.writableFinished}`)
      }
    } catch {
      /* telemetry must never throw into the request lifecycle */
    }
  }

  res.on('finish', done)
  res.on('close', done) // client aborted before finish
  next()
}
