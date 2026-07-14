/**
 * telemetry/worker — **worker 进程**的遥测启动 + PDF 管线的队列指标与告警。
 *
 * WHY 单独一个:worker 是**独立进程**(独立 Docker 镜像,entry = worker/index.ts)。
 * API 进程里那句 startTelemetry() 它根本跑不到 —— 所以在这之前,**整条 PDF 管线
 * 的内部完全没有任何遥测**(它偏偏又是全站最重、最容易卡住、失败最伤客户的流程:
 * 客户传了 500MB 楼书,失败了只有 docker logs 里一行 console.error)。
 *
 * 这里注册的 gauge 都是 **pull 式查 DB** —— 队列深度这种东西只有 DB 知道真相。
 * (现有的 GET /api/langgraph-progress/queue 读的是 API 进程的内存队列,
 *  worker 模式下**恒为 0**,是个误导人的假指标。)
 */
import pool from '../db/pool'
import { gauge } from './metrics'
import { defineAlert } from './alerts'
import { startRuntimeMetrics, runtimeSnapshot } from './runtime'
import { startTelemetryFlusher } from './flush'

/** 队列快照。5s 缓存 —— gauge 每分钟才被读一次,但告警也读,别把 DB 打穿。 */
let cache = { at: 0, pending: 0, processing: 0, oldestPendingS: 0, stuck: 0 }

async function refresh(): Promise<typeof cache> {
  if (Date.now() - cache.at < 5000) return cache
  try {
    const { rows } = await pool.query<{
      pending: string; processing: string; oldest_pending_s: string | null; stuck: string
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'pending')                              AS pending,
         COUNT(*) FILTER (WHERE status = 'processing')                           AS processing,
         COALESCE(EXTRACT(EPOCH FROM (now() - MIN(created_at) FILTER (WHERE status = 'pending'))), 0) AS oldest_pending_s,
         -- 卡住的任务:之前**完全没人查** —— worker 被 OOM kill 的 job 会永久停在 processing
         COUNT(*) FILTER (WHERE status = 'processing' AND updated_at < now() - interval '20 minutes') AS stuck
       FROM pdf_processing_tasks`
    )
    cache = {
      at: Date.now(),
      pending: Number(rows[0]?.pending || 0),
      processing: Number(rows[0]?.processing || 0),
      oldestPendingS: Math.round(Number(rows[0]?.oldest_pending_s || 0)),
      stuck: Number(rows[0]?.stuck || 0),
    }
  } catch {
    /* DB 抖动不影响 worker 干活 */
  }
  return cache
}

// gauge 是 pull 式的,但读函数必须同步 → 用后台刷新 + 读缓存。
let started = false

export function startWorkerTelemetry(): void {
  if (started) return
  started = true

  startRuntimeMetrics()
  setInterval(() => { void refresh() }, 5000).unref?.()

  gauge('pdf.queue.pending', () => cache.pending)
  gauge('pdf.queue.processing', () => cache.processing)
  gauge('pdf.queue.oldest_wait_s', () => cache.oldestPendingS)
  gauge('pdf.queue.stuck', () => cache.stuck)
  gauge('worker.cpu.pct', () => runtimeSnapshot().cpuPct)
  gauge('worker.rss.mb', () => runtimeSnapshot().rssMb)

  defineAlert({
    kind: 'PDF_QUEUE_BACKLOG',
    severity: 'warn',
    threshold: 900,
    read: () => cache.oldestPendingS,
    // 一个 job 约 2.6 分钟、并发 1。队首等了 15 分钟以上 = 积压了 5 个以上,
    // 或者 worker 挂了/卡住了。客户那头正盯着「处理中」的进度条。
    breach: (v) => v > 900,
    message: (v) =>
      `PDF 队列积压:队首已等 ${Math.round(v / 60)} 分钟(pending ${cache.pending} / processing ${cache.processing})。` +
      `worker 并发=1、单个 job 约 2.6 分钟 —— 要么排队太长,要么 worker 卡死了。`,
    recovered: () => 'PDF 队列已疏通。',
  })

  defineAlert({
    kind: 'PDF_JOB_STUCK',
    severity: 'error',
    threshold: 1,
    read: () => cache.stuck,
    // processing 状态 20 分钟没动过 = worker 进程死了(OOM),而这个 job 永远不会完成、
    // 也永远不会被重试。客户的楼书就这么没了,之前**完全没有任何检测**。
    breach: (v) => v >= 1,
    message: (v) =>
      `${v} 个 PDF 任务卡死(processing 状态 20 分钟无进展)—— 多半是 worker 进程被 OOM kill。` +
      `这些 job 不会自动重试,客户的楼书就卡在那里。`,
    recovered: () => 'PDF 卡死任务已清空。',
  })

  defineAlert({
    kind: 'WORKER_MEMORY_HIGH',
    severity: 'warn',
    threshold: 6000,
    read: () => runtimeSnapshot().rssMb,
    // worker 机器 8GB。PDF 处理很吃内存(500MB 楼书 → 几百页渲染)。
    breach: (v) => v > 6000,
    message: (v) => `Worker 内存 ${v}MB / 共 8GB —— 再涨就要被 OOM kill(在跑的 job 会永久卡在 processing)。`,
    recovered: (v) => `Worker 内存回落到 ${v}MB。`,
  })

  startTelemetryFlusher()
  console.log('📊 Worker telemetry started (队列/卡死/内存 → metrics_minute + perf_alerts)')
}
