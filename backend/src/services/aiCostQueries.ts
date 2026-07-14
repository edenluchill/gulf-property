/**
 * Admin 读侧:AI 成本 / PDF 管线 / 钱门 —— 全部来自通用 metrics_minute。
 *
 * 之前这三块**完全是盲的**:
 *   - AI:全 backend 没有一处读 usageMetadata → 不知道花了多少、哪个功能在烧
 *   - PDF 管线:跑在独立的 worker 进程里,零遥测 → 卡住/失败只有 docker logs
 *   - paywall:谁被挡在门外、被什么挡的 → 转化漏斗里最值钱的一格,没人记
 */
import pool from '../db/pool'

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
