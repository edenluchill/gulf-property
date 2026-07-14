/**
 * telemetry/flush — 每 60s 把内存里的指标落进 metrics_minute,然后跑告警。
 *
 * 一次批量 INSERT(不是一条一句),失败只打日志 —— **遥测挂了业务必须照跑**。
 * 落库前包 beginMaintenance/endMaintenance:这些写入是后台任务,不该被算成
 * 「慢查询」而把告警刷屏(见 perfSink 那段注释,这坑踩过)。
 */
import pool from '../db/pool'
import { drain, type Snapshot } from './metrics'
import { evaluateAlerts } from './alerts'
import { beginMaintenance, endMaintenance } from '../services/perfSink'

const FLUSH_MS = 60_000
const RETENTION_DAYS = Number(process.env.METRICS_RETENTION_DAYS) || 90
const SWEEP_MS = 6 * 60 * 60 * 1000

let started = false

async function writeSnapshots(rows: Snapshot[]): Promise<void> {
  if (!rows.length) return
  const values: unknown[] = []
  const tuples = rows.map((s, i) => {
    const b = i * 10
    values.push(
      s.name, JSON.stringify(s.labels), s.kind,
      s.count, s.value, s.sum, s.min, s.max, s.p50, s.p95
    )
    return `(date_trunc('minute', now()), $${b + 1}, $${b + 2}::jsonb, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}, $${b + 10})`
  })
  // 同一分钟重复 flush(重启/时钟抖动)→ 覆盖,不重复插。
  await pool.query(
    `INSERT INTO metrics_minute (minute, name, labels, kind, count, value, sum, min, max, p50, p95)
     VALUES ${tuples.join(',')}
     ON CONFLICT (minute, name, labels) DO UPDATE SET
       count = EXCLUDED.count, value = EXCLUDED.value, sum = EXCLUDED.sum,
       min = EXCLUDED.min, max = EXCLUDED.max, p50 = EXCLUDED.p50, p95 = EXCLUDED.p95`,
    values
  )
}

export function startTelemetryFlusher(): void {
  if (started) return
  started = true

  setInterval(async () => {
    beginMaintenance()
    try {
      await writeSnapshots(drain())
    } catch (e) {
      console.error('[telemetry] flush failed:', e)
    } finally {
      endMaintenance()
    }
    // 告警独立于落库:即使写库失败,该报的警还是要报。
    await evaluateAlerts()
  }, FLUSH_MS).unref?.()

  // 保留期清理
  const sweep = async () => {
    beginMaintenance()
    try {
      const { rowCount } = await pool.query(
        `DELETE FROM metrics_minute WHERE minute < now() - ($1 || ' days')::interval`,
        [String(RETENTION_DAYS)]
      )
      if (rowCount) console.log(`🧹 telemetry: purged ${rowCount} metric rows older than ${RETENTION_DAYS}d`)
    } catch (e) {
      console.error('[telemetry] retention sweep failed:', e)
    } finally {
      endMaintenance()
    }
  }
  setInterval(sweep, SWEEP_MS).unref?.()

  console.log('📊 Telemetry flusher started (60s → metrics_minute)')
}

/** 测试用:立刻 flush 一次。 */
export async function flushNow(): Promise<number> {
  const rows = drain()
  await writeSnapshots(rows)
  return rows.length
}
