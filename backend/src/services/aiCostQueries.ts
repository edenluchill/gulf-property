/**
 * Admin 读侧:AI 成本 / PDF 管线 / 钱门 —— 全部来自通用 metrics_minute。
 *
 * 之前这三块**完全是盲的**:
 *   - AI:全 backend 没有一处读 usageMetadata → 不知道花了多少、哪个功能在烧
 *   - PDF 管线:跑在独立的 worker 进程里,零遥测 → 卡住/失败只有 docker logs
 *   - paywall:谁被挡在门外、被什么挡的 → 转化漏斗里最值钱的一格,没人记
 */
import pool from '../db/pool'
import { PRICES, whatIfUsd, stalePrices } from './ai/pricing'

/** AI 用量与成本(按 task 维度)。cost 存的是**微美元**(counter 只累加整数)。 */
export async function aiCost(hours = 24) {
  const { rows } = await pool.query<{
    task: string; calls: string; usd_micro: string; in_tok: string; out_tok: string
    p50: number | null; p95: number | null; failed: string; fallback: string
  }>(
    `WITH m AS (
       SELECT name, labels, count, p50, p95 FROM metrics_minute
        WHERE minute > now() - ($1 || ' hours')::interval
          AND name IN ('ai.call','ai.cost.usd_micro','ai.tokens','ai.call.failed','ai.call.fallback','ai.call.ms')
     )
     SELECT
       labels->>'task' AS task,
       COALESCE(SUM(count) FILTER (WHERE name = 'ai.call'), 0)::bigint                              AS calls,
       COALESCE(SUM(count) FILTER (WHERE name = 'ai.cost.usd_micro'), 0)::bigint                    AS usd_micro,
       COALESCE(SUM(count) FILTER (WHERE name = 'ai.tokens' AND labels->>'dir' = 'in'), 0)::bigint  AS in_tok,
       COALESCE(SUM(count) FILTER (WHERE name = 'ai.tokens' AND labels->>'dir' = 'out'), 0)::bigint AS out_tok,
       COALESCE(SUM(count) FILTER (WHERE name = 'ai.call.failed'), 0)::bigint                       AS failed,
       COALESCE(SUM(count) FILTER (WHERE name = 'ai.call.fallback'), 0)::bigint                     AS fallback,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY p50) FILTER (WHERE name = 'ai.call.ms')          AS p50,
       MAX(p95) FILTER (WHERE name = 'ai.call.ms')                                                  AS p95
     FROM m
     WHERE labels->>'task' IS NOT NULL
     GROUP BY 1
     ORDER BY 3 DESC`,
    [String(hours)]
  )
  const tasks = rows.map((r) => ({
    task: r.task,
    calls: Number(r.calls),
    usd: Math.round((Number(r.usd_micro) / 1e6) * 10000) / 10000,
    inTokens: Number(r.in_tok),
    outTokens: Number(r.out_tok),
    failed: Number(r.failed),
    // 退到备用模型 = 主模型有问题(废弃/限流)。模型漂移的哨兵。
    fallback: Number(r.fallback),
    p50: Math.round(Number(r.p50 ?? 0)),
    p95: Math.round(Number(r.p95 ?? 0)),
  }))
  return {
    hours,
    totalUsd: Math.round(tasks.reduce((a, t) => a + t.usd, 0) * 10000) / 10000,
    totalCalls: tasks.reduce((a, t) => a + t.calls, 0),
    tasks,
  }
}

/**
 * 成本**预测** —— 「照这个速度,这个月要花多少钱」。
 *
 * WHY:24 小时的成本表回答不了唯一重要的问题 —— **月底账单会是多少**。
 * 收到 Google 的账单才知道花了多少,已经晚了一个月。
 *
 * 三个数字,口径写死在这里免得看板上各算各的:
 *   day7   最近 7 天的日均(近期真实速率;比 24h 稳,不会被一次批量跑分带偏)
 *   day30  最近 30 天的日均(受历史影响,和 day7 一比就知道在涨还是在跌)
 *   projected = day7 × 30(**按近期速率**外推整月;这是最该盯的数)
 *
 * ⚠️ metrics_minute 只留 90 天(METRICS_RETENTION_DAYS)→ 拉不出更长的趋势。
 */
export async function aiForecast() {
  const { rows } = await pool.query<{
    task: string; d: string; usd_micro: string; in_tok: string; out_tok: string; calls: string
  }>(
    `SELECT labels->>'task' AS task,
            to_char(date_trunc('day', minute), 'YYYY-MM-DD') AS d,
            COALESCE(SUM(count) FILTER (WHERE name = 'ai.cost.usd_micro'), 0)::bigint    AS usd_micro,
            COALESCE(SUM(count) FILTER (WHERE name = 'ai.tokens'
                     AND labels->>'dir' = 'in'), 0)::bigint                              AS in_tok,
            COALESCE(SUM(count) FILTER (WHERE name = 'ai.tokens'
                     AND labels->>'dir' <> 'in'), 0)::bigint                             AS out_tok,
            COALESCE(SUM(count) FILTER (WHERE name = 'ai.call'), 0)::bigint              AS calls
       FROM metrics_minute
      WHERE minute > now() - interval '30 days'
        AND name IN ('ai.cost.usd_micro','ai.tokens','ai.call')
        AND labels->>'task' IS NOT NULL
      GROUP BY 1,2`
  )

  const usd = (m: string) => Number(m) / 1e6
  const dayMs = 86_400_000
  const now = Date.now()
  const ageDays = (d: string) => Math.floor((now - new Date(`${d}T00:00:00Z`).getTime()) / dayMs)

  // 按天汇总(画趋势用)
  const byDay = new Map<string, number>()
  // 按功能汇总(7 天窗口 —— 预测和「谁在烧钱」都用同一个窗口,免得两处对不上)
  const byTask = new Map<string, { usd7: number; calls7: number; in7: number; out7: number }>()
  let total7 = 0
  let total30 = 0

  for (const r of rows) {
    const v = usd(r.usd_micro)
    byDay.set(r.d, (byDay.get(r.d) || 0) + v)
    total30 += v
    if (ageDays(r.d) < 7) {
      total7 += v
      const cur = byTask.get(r.task) || { usd7: 0, calls7: 0, in7: 0, out7: 0 }
      cur.usd7 += v
      cur.calls7 += Number(r.calls)
      cur.in7 += Number(r.in_tok)
      cur.out7 += Number(r.out_tok)
      byTask.set(r.task, cur)
    }
  }

  const round = (n: number, p = 4) => Math.round(n * 10 ** p) / 10 ** p
  const perDay7 = total7 / 7
  const perDay30 = total30 / 30

  const tasks = [...byTask.entries()]
    .map(([task, v]) => ({
      task,
      usd7: round(v.usd7),
      /** 按近期速率外推的**月成本**(这条才是能和订阅收入比的数) */
      projectedUsd: round((v.usd7 / 7) * 30, 2),
      calls7: v.calls7,
      inTokens7: v.in7,
      outTokens7: v.out7,
      /** 每次调用多少钱 —— 优化时先看这个,再看总量 */
      usdPerCall: v.calls7 > 0 ? round(v.usd7 / v.calls7, 6) : 0,
    }))
    .sort((a, b) => b.projectedUsd - a.projectedUsd)

  return {
    perDay7: round(perDay7, 4),
    perDay30: round(perDay30, 4),
    /** 照最近 7 天的速率,一个月要花这么多 */
    projectedMonthlyUsd: round(perDay7 * 30, 2),
    /** >1 = 在涨。和 30 天均值比,一眼看出是不是最近突然开始烧钱 */
    trend: perDay30 > 0 ? round(perDay7 / perDay30, 2) : 0,
    /** 近 30 天每天的花费(画趋势线) */
    daily: [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, v]) => ({ date, usd: round(v, 4) })),
    tasks,
    totalInTokens7: tasks.reduce((a, t) => a + t.inTokens7, 0),
    totalOutTokens7: tasks.reduce((a, t) => a + t.outTokens7, 0),
  }
}

/**
 * 「换模型要多少钱」试算 —— **谈换 ChatGPT / 换别家之前先看这个**。
 *
 * 拿最近 7 天**真实发生**的进/出 token 量,按每个候选模型的单价重算月成本。
 * 比听说谁便宜靠谱得多:同样的活,输出 token 多的任务对「输出贵」的模型特别敏感,
 * 光看输入单价会得出反过来的结论。
 *
 * ⚠️ 前提:不同家的 tokenizer 切分不一样(±10~30% 很常见),这里按等量估算 ——
 * **用来排序和判断量级,不是报价单**。
 */
export async function aiWhatIf() {
  const f = await aiForecast()
  const totals = { inTokens: f.totalInTokens7, outTokens: f.totalOutTokens7 }
  const candidates = Object.entries(PRICES)
    // 语音/TTS 模型不参与文本任务的横向比较(计费模态根本不同,比了会误导)
    .filter(([, p]) => !p.audioOut && !p.audioIn)
    .map(([key, p]) => ({
      model: key,
      provider: p.provider,
      verified: p.verified,
      asOf: p.asOf,
      note: p.note,
      /** 把这 7 天的活全交给它,一个月要多少钱 */
      projectedMonthlyUsd: Math.round((whatIfUsd(key, totals) / 7) * 30 * 100) / 100,
    }))
    .sort((a, b) => a.projectedMonthlyUsd - b.projectedMonthlyUsd)

  return {
    basis: { days: 7, ...totals },
    current: f.projectedMonthlyUsd,
    candidates,
    /** 单价过期/没核对过的条目 —— 拿这些数做决定之前先去官网核对 */
    stale: stalePrices(),
  }
}

/** PDF 楼书管线:队列、成败、AI 抽取的健康度。 */
export async function pdfPipeline(hours = 24) {
  const [live, jobs, agents] = await Promise.all([
    // 队列现状(worker 的 gauge,取最新一分钟)
    pool.query<{ name: string; value: number }>(
      `SELECT DISTINCT ON (name) name, value FROM metrics_minute
        WHERE name IN ('pdf.queue.pending','pdf.queue.processing','pdf.queue.oldest_wait_s','pdf.queue.stuck','worker.rss.mb','worker.cpu.pct')
          AND minute > now() - interval '10 minutes'
        ORDER BY name, minute DESC`
    ),
    pool.query<{ result: string; n: string }>(
      `SELECT labels->>'result' AS result, SUM(count)::bigint AS n
         FROM metrics_minute
        WHERE name = 'pdf.job' AND minute > now() - ($1 || ' hours')::interval
        GROUP BY 1`,
      [String(hours)]
    ),
    // 每个抽取 agent 的成败 —— 一个 agent 挂了 = 客户的楼书缺那块数据
    pool.query<{ agent: string; result: string; n: string }>(
      `SELECT labels->>'agent' AS agent, labels->>'result' AS result, SUM(count)::bigint AS n
         FROM metrics_minute
        WHERE name = 'pdf.ai.call' AND minute > now() - ($1 || ' hours')::interval
        GROUP BY 1,2`,
      [String(hours)]
    ),
  ])

  const g = (n: string) => Number(live.rows.find((r) => r.name === n)?.value ?? 0)
  const byAgent = new Map<string, { ok: number; failed: number; invalid: number }>()
  for (const r of agents.rows) {
    const cur = byAgent.get(r.agent) || { ok: 0, failed: 0, invalid: 0 }
    if (r.result === 'ok') cur.ok += Number(r.n)
    else if (r.result === 'failed') cur.failed += Number(r.n)
    else cur.invalid += Number(r.n)
    byAgent.set(r.agent, cur)
  }

  return {
    queue: {
      pending: g('pdf.queue.pending'),
      processing: g('pdf.queue.processing'),
      oldestWaitS: g('pdf.queue.oldest_wait_s'),
      stuck: g('pdf.queue.stuck'),      // >0 = worker 被 OOM kill 留下的孤儿,永远不会重试
      workerRssMb: g('worker.rss.mb'),
      workerCpuPct: g('worker.cpu.pct'),
    },
    jobs: {
      completed: Number(jobs.rows.find((r) => r.result === 'completed')?.n || 0),
      failed: Number(jobs.rows.find((r) => r.result === 'failed')?.n || 0),
    },
    agents: [...byAgent.entries()]
      .map(([agent, v]) => ({ agent, ...v, total: v.ok + v.failed + v.invalid }))
      .sort((a, b) => b.failed - a.failed),
  }
}

/** 钱门:谁被挡住了、被什么挡的。转化漏斗里最值钱的一格。 */
export async function paywallHits(hours = 168) {
  const { rows } = await pool.query<{ feature: string; reason: string; trial: string; n: string }>(
    `SELECT labels->>'feature' AS feature, labels->>'reason' AS reason,
            labels->>'trial' AS trial, SUM(count)::bigint AS n
       FROM metrics_minute
      WHERE name = 'billing.paywall.hit' AND minute > now() - ($1 || ' hours')::interval
      GROUP BY 1,2,3 ORDER BY 4 DESC`,
    [String(hours)]
  )
  return rows.map((r) => ({
    feature: r.feature,
    reason: r.reason,
    trial: r.trial === 'yes',
    count: Number(r.n),
  }))
}
