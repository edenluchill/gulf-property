/**
 * telemetry/alerts — **声明式**告警规则。
 *
 * WHY:perfMonitor.evaluateRules 是一坨硬编码 if-else,加一条规则要改函数体。
 * 这里一条规则 = 一个对象,注册即生效。规则写进**现有的 perf_alerts 表** →
 * 邮件通知和 Admin「错误监控」tab **全部白嫖现成的**,不用再做一套。
 *
 * 状态机沿用现有约定(见 [[alerts-are-incidents-not-state]]):
 *   没有活跃告警 + 突破阈值 → 开一条 + 发邮件
 *   有活跃告警 + 恢复      → 关闭 + 发恢复邮件
 * 只在**状态跳变**时发信 → 天然去抖,不会刷屏。
 *
 * ⚠️ 这里管的都是**状态类**告警(CPU 高了、积压了 —— 会自己恢复)。
 * **5xx 那种「事故类」永远不自动恢复**,那套逻辑在 perfMonitor 里,别混进来。
 */
import pool from '../db/pool'
import { sendAlertEmail } from '../services/notify'

const APP_URL = process.env.APP_URL || 'https://www.pinzos.com'

export interface AlertRule {
  /** 唯一 kind(也是 perf_alerts 的去重键)。 */
  kind: string
  severity: 'warn' | 'error'
  /** 当前值怎么取 —— 直接给读函数,规则自己决定看什么。 */
  read: () => number | null
  /** 突破判定。返回 true = 有问题。 */
  breach: (v: number) => boolean
  /** 展示用阈值(只进 DB 给人看,判定逻辑在 breach 里)。 */
  threshold: number
  message: (v: number) => string
  /** 恢复文案(可选)。 */
  recovered?: (v: number) => string
}

const rules: AlertRule[] = []

/** 注册一条规则。在 telemetry/index.ts 的 registerAlerts() 里集中调用。 */
export function defineAlert(rule: AlertRule): void {
  rules.push(rule)
}

/** 测试用。 */
export function __rules(): AlertRule[] { return rules }
export function __clearRules(): void { rules.length = 0 }

/**
 * 跑一轮所有规则,对齐 perf_alerts 的状态。
 * 整体包 try/catch:告警系统自己挂了,绝不能把 flush 定时器带崩。
 */
export async function evaluateAlerts(): Promise<void> {
  if (!rules.length) return
  try {
    const active = new Map<string, number>()
    const { rows } = await pool.query<{ id: number; kind: string }>(
      // 只看状态类:API_5XX 是事故,不归这里管(它永不自动恢复)
      `SELECT id, kind FROM perf_alerts WHERE resolved_at IS NULL AND kind <> 'API_5XX'`
    )
    for (const r of rows) active.set(r.kind, r.id)

    for (const rule of rules) {
      let v: number | null = null
      try { v = rule.read() } catch { continue }
      if (v === null || !Number.isFinite(v)) continue

      const breached = rule.breach(v)
      const openId = active.get(rule.kind)

      if (breached && openId === undefined) {
        const message = rule.message(v)
        const ins = await pool.query<{ id: number }>(
          `INSERT INTO perf_alerts (kind, severity, metric, threshold, window_s, message)
           VALUES ($1,$2,$3,$4,60,$5) RETURNING id`,
          [rule.kind, rule.severity, v, rule.threshold, message]
        )
        const ok = await sendAlertEmail(
          `${rule.severity === 'error' ? '🚨' : '⚠️'} Pinzos: ${rule.kind}`,
          `${message}\n\n${APP_URL}/admin/analytics\n\n— 遥测自动发出`
        )
        if (ok) await pool.query(`UPDATE perf_alerts SET emailed = true WHERE id = $1`, [ins.rows[0].id])
      } else if (!breached && openId !== undefined) {
        await pool.query(`UPDATE perf_alerts SET resolved_at = now() WHERE id = $1`, [openId])
        await sendAlertEmail(
          `✅ Pinzos 已恢复: ${rule.kind}`,
          `${rule.recovered ? rule.recovered(v) : `${rule.kind} 已回到正常范围(当前 ${v})。`}\n\n— 遥测自动发出`
        )
      }
    }
  } catch (e) {
    console.error('[telemetry] evaluateAlerts failed:', e)
  }
}
