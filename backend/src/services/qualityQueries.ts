/**
 * 质量诊断的读侧 —— **这个接口是给 AI(我)用的**,不只是给人看图表。
 *
 * 优化闭环长这样:
 *   ① ruleRanking()  哪条规则最常挂 → **这就是路线图**,先改最普遍的那个缺陷
 *   ② worstSamples() 最差的 N 个案例 + ref_id → **拿着 ref_id 去看原件**
 *      (share_code → 原剧本 / job_id → 原 PDF(永久归档) / session_id → 原对话)
 *   ③ 改 prompt / 代码
 *   ④ trend()        分数有没有真的上去 —— 不是"感觉变好了",是数字
 *
 * 没有 ②(可回溯的样本),前三步都做不了 —— 那正是纯聚合遥测的天花板。
 */
import pool from '../db/pool'

export type Feature = 'luna_tour' | 'pdf_extract' | 'luna_session'

/**
 * 规则失败排行 —— **优化路线图**。
 * 按 (失败次数 × 严重度) 排,最上面那条就是最该动的地方。
 */
export async function ruleRanking(feature: Feature, days = 7) {
  const { rows } = await pool.query<{
    rule: string; severity: string; fails: string; samples: string; example: string
  }>(
    `SELECT i->>'rule'      AS rule,
            i->>'severity'  AS severity,
            COUNT(*)::bigint            AS fails,
            COUNT(DISTINCT s.ref_id)::bigint AS samples,
            (ARRAY_AGG(i->>'detail' ORDER BY s.created_at DESC))[1] AS example
       FROM quality_samples s
       CROSS JOIN LATERAL jsonb_array_elements(s.issues) AS i
      WHERE s.feature = $1 AND s.created_at > now() - ($2 || ' days')::interval
      GROUP BY 1, 2
      ORDER BY (CASE i->>'severity'
                  WHEN 'critical' THEN 5 WHEN 'major' THEN 2 ELSE 1 END) * COUNT(*) DESC`,
    [feature, String(days)]
  )
  return rows.map((r) => ({
    rule: r.rule,
    severity: r.severity,
    fails: Number(r.fails),
    affectedSamples: Number(r.samples),
    /** 最近一次的具体报错 —— 直接指向改哪里,不是"质量不佳"这种废话 */
    example: r.example,
  }))
}

/**
 * 最差的样本 —— **带 ref_id,可以直接去看原件**。
 * 这是「能优化」和「只能看看」的分界线。
 */
export async function worstSamples(feature: Feature, limit = 20, days = 7) {
  const { rows } = await pool.query(
    `SELECT ref_id, score, passed, failed, issues, meta, created_at
       FROM quality_samples
      WHERE feature = $1 AND created_at > now() - ($3 || ' days')::interval
      ORDER BY score ASC, created_at DESC
      LIMIT $2`,
    [feature, limit, String(days)]
  )
  return rows.map((r) => ({
    refId: r.ref_id,
    score: r.score,
    passed: r.passed,
    failed: r.failed,
    issues: r.issues,
    meta: r.meta,
    createdAt: r.created_at,
    /** 拿这个去看原件 */
    trace: traceHint(feature, r.ref_id),
  }))
}

function traceHint(feature: Feature, refId: string): string {
  switch (feature) {
    case 'luna_tour':
      return `原剧本: SELECT script FROM lt_tour_scripts WHERE session_id = (SELECT id FROM lt_demo_sessions WHERE share_code='${refId}')`
    case 'pdf_extract':
      return `原抽取: SELECT result FROM pdf_processing_tasks WHERE job_id='${refId}' · 源 PDF 已永久归档(pdf-archive/)`
    case 'luna_session':
      return `原对话: SELECT transcript FROM luna_sessions WHERE session_id='${refId}'`
  }
}

/** 分数趋势 —— 改完之后**有没有真的变好**(不是"感觉")。 */
export async function trend(feature: Feature, days = 30) {
  const { rows } = await pool.query<{ day: string; n: string; avg: string; critical: string }>(
    `SELECT date_trunc('day', created_at)::date AS day,
            COUNT(*)::bigint AS n,
            ROUND(AVG(score))::text AS avg,
            COUNT(*) FILTER (WHERE issues @> '[{"severity":"critical"}]')::bigint AS critical
       FROM quality_samples
      WHERE feature = $1 AND created_at > now() - ($2 || ' days')::interval
      GROUP BY 1 ORDER BY 1`,
    [feature, String(days)]
  )
  return rows.map((r) => ({
    day: r.day,
    samples: Number(r.n),
    avgScore: Number(r.avg),
    withCritical: Number(r.critical),
  }))
}

/** 概览:三个 feature 的当前质量。 */
export async function qualityOverview(days = 7) {
  const { rows } = await pool.query<{
    feature: string; n: string; avg: string; critical: string; worst: string
  }>(
    `SELECT feature,
            COUNT(*)::bigint AS n,
            ROUND(AVG(score))::text AS avg,
            COUNT(*) FILTER (WHERE issues @> '[{"severity":"critical"}]')::bigint AS critical,
            MIN(score)::text AS worst
       FROM quality_samples
      WHERE created_at > now() - ($1 || ' days')::interval
      GROUP BY feature`,
    [String(days)]
  )
  return rows.map((r) => ({
    feature: r.feature,
    samples: Number(r.n),
    avgScore: Number(r.avg),
    withCritical: Number(r.critical),
    worstScore: Number(r.worst),
  }))
}

/**
 * **一次性给 AI 的完整诊断包** —— 一个请求拿到优化所需的全部信息。
 * GET /api/admin/insights/quality/:feature/diagnose
 */
export async function diagnose(feature: Feature, days = 7) {
  const [ranking, worst, tr] = await Promise.all([
    ruleRanking(feature, days),
    worstSamples(feature, 10, days),
    trend(feature, days),
  ])
  return {
    feature,
    days,
    /** 先改这个 —— 失败最多 × 最严重 */
    topIssue: ranking[0] || null,
    ruleRanking: ranking,
    worstSamples: worst,
    trend: tr,
    howToUse:
      '① topIssue = 最该改的缺陷 ② worstSamples[].trace = 拿去看原件的 SQL ' +
      '③ 改完看 trend 的 avgScore 有没有真的上去',
  }
}
