/**
 * 质量遥测 —— **给 AI 用来自主优化的那一层**。
 *
 * 和 telemetry/ 的分工(别混):
 *   telemetry  = 运维型。系统健不健康、花了多少钱、快不快。**聚合**。
 *   quality    = 质量型。**输出好不好、烂在哪、该改哪里**。**带可回溯的样本**。
 *
 * 为什么 telemetry 不够(2026-07-13 owner 点破):
 *   histogram 能告诉我「tour 生成了 50 次、p95 8 秒」,但**无法回答
 *   「哪一次生成得烂、烂在哪」**。要优化质量,必须能拉到具体的差案例。
 *
 * 三件事:
 *   1. **规则**:声明式的质检(每条规则 = 一个可判定的缺陷)。
 *      `tour-e2e.ts` 里本来就有 24 条很好的规则,但它们**只在手动跑测试时执行** ——
 *      生产每天生成的真实 tour 从来没被体检过。现在搬进生产,每次生成自动跑。
 *   2. **样本**:落 quality_samples 表,带 **ref_id**(share_code / job_id / session_id)
 *      → **可以回溯到原件**。这是「聚合」和「能优化」的分界线。
 *   3. **指标**:`quality.rule{feature,rule,result}` → **哪条规则最常挂 = 最该优化的地方**。
 *
 * AI 的优化闭环(这才是重点):
 *   拉规则失败排行 → 知道哪个缺陷最普遍
 *   → 拉最差样本的 ref_id → 去看原件(tour script / 抽取结果 / transcript)
 *   → 改 prompt / 代码 → 再看分数有没有上去
 *
 * 用法(任何 feature):
 *   const result = await audit('luna_tour', shareCode, script, { projects: 3 })
 */
import pool from '../db/pool'
import { counter, histogram } from '../telemetry'

export type Severity = 'critical' | 'major' | 'minor'

export interface Issue {
  rule: string
  severity: Severity
  /** 具体哪里错了 —— 要能直接指向修改点,不是"质量不佳"这种废话。 */
  detail: string
}

/** 一条质检规则。check 返回 null = 通过;返回字符串 = 问题描述。 */
export interface Rule<T> {
  id: string
  severity: Severity
  /** 这条规则**为什么存在** —— 给未来的人(和 AI)看,免得被当成噪音删掉。 */
  why: string
  check: (subject: T, meta?: Record<string, unknown>) => string | null
}

export interface QualityResult {
  feature: string
  refId: string
  score: number          // 0-100
  passed: number
  failed: number
  issues: Issue[]
}

const WEIGHT: Record<Severity, number> = { critical: 5, major: 2, minor: 1 }

/**
 * 跑一组规则,算分,落样本,发指标。**绝不抛错** —— 质检挂了不能影响业务。
 */
export async function runAudit<T>(
  feature: string,
  refId: string,
  subject: T,
  rules: Rule<T>[],
  meta: Record<string, unknown> = {}
): Promise<QualityResult> {
  const issues: Issue[] = []
  let passed = 0

  for (const rule of rules) {
    let detail: string | null = null
    try {
      detail = rule.check(subject, meta)
    } catch (e) {
      // 规则自己写崩了 —— 记下来,但别当成"业务有问题"
      counter('quality.rule', { feature, rule: rule.id, result: 'error' }).inc()
      continue
    }
    if (detail === null) {
      passed++
      counter('quality.rule', { feature, rule: rule.id, result: 'pass' }).inc()
    } else {
      issues.push({ rule: rule.id, severity: rule.severity, detail: detail.slice(0, 500) })
      // **这个指标就是优化的路线图**:哪条规则最常挂,就先改哪里
      counter('quality.rule', { feature, rule: rule.id, result: 'fail' }).inc()
    }
  }

  // 扣分按严重度加权。critical 一条就掉 5 倍。
  const maxWeight = rules.reduce((a, r) => a + WEIGHT[r.severity], 0) || 1
  const lostWeight = issues.reduce((a, i) => a + WEIGHT[i.severity], 0)
  const score = Math.max(0, Math.round(100 * (1 - lostWeight / maxWeight)))

  histogram('quality.score', { feature }).observe(score)
  if (issues.some((i) => i.severity === 'critical')) {
    counter('quality.critical', { feature }).inc()
  }

  const result: QualityResult = { feature, refId, score, passed, failed: issues.length, issues }

  // 落样本 —— **带 ref_id,能回溯到原件**。这是"能优化"和"只能看看"的分界。
  await pool.query(
    `INSERT INTO quality_samples (feature, ref_id, score, passed, failed, issues, meta)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)`,
    [feature, refId.slice(0, 128), score, passed, issues.length,
     JSON.stringify(issues), JSON.stringify(meta)]
  ).catch((e) => console.error('[quality] sample insert failed:', e))

  if (issues.length) {
    const crit = issues.filter((i) => i.severity === 'critical').length
    console.log(`[quality] ${feature}/${refId}: ${score} 分 · ${issues.length} 个问题${crit ? ` (${crit} 严重)` : ''}`)
  }
  return result
}
