/**
 * PerfMonitor — owner dashboard "性能/负载" tab.
 *
 * Polls /api/admin/analytics/perf every 15s. Shows live KPIs (RPS, p95, error
 * rate, concurrency, DB pool), p95 + RPS trend (minute rollups), and the alert
 * history with a manual "标记已解决" action. The cross-dashboard red banner for
 * active alerts lives in AdminAnalytics.tsx (uses /perf/alerts/active).
 */
import { useEffect, useState, useMemo } from 'react'
import { Activity, AlertTriangle, CheckCircle2, Database, Gauge, Loader2, Timer, Zap } from 'lucide-react'
import { fetchPerf, ackAlert, PerfData } from '../../lib/analyticsApi'
import StatCard from './StatCard'
import TrendChart from './TrendChart'

const KIND_LABEL: Record<string, string> = {
  API_5XX: '接口报错',
  HIGH_LATENCY: '延迟过高',
  HIGH_ERROR_RATE: '错误率过高',  // 已废弃的旧规则,历史记录里还有
  SLOW_QUERIES: '慢查询过多',
  DB_POOL_SATURATION: '连接池打满',
}

// 事故(incident)≠ 状态告警。5xx 是发生过的事,不会"恢复"——它只能被人查清根因后
// 关闭。状态告警(延迟/连接池)才有"当前是否还超阈值"这回事。两者的关闭语义不同,
// UI 必须说不同的话,否则「已恢复」就是在骗人。
const INCIDENT_KINDS = new Set(['API_5XX'])

/** ISO minute → "MM-DD HH:MM" (TrendChart slices off the first 5 chars). */
function fmtMinute(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function PerfMonitor() {
  const [data, setData] = useState<PerfData | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(false)
  const [acking, setAcking] = useState<number | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let alive = true
    fetchPerf(180)
      .then((d) => { if (alive) { setData(d); setErr(false) } })
      .catch(() => alive && setErr(true))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [tick])

  // Poll every 15s.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 15_000)
    return () => clearInterval(id)
  }, [])

  const p95Trend = useMemo(
    () => (data?.rollups || []).map((r) => ({ day: fmtMinute(r.minute), value: r.p95 })),
    [data]
  )
  const rpsTrend = useMemo(
    () => (data?.rollups || []).map((r) => ({ day: fmtMinute(r.minute), value: Math.round(r.req / 60) })),
    [data]
  )

  const onAck = async (id: number) => {
    setAcking(id)
    try { await ackAlert(id); setTick((t) => t + 1) } finally { setAcking(null) }
  }

  if (loading) {
    return (
      <div className="flex min-h-[30vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-teal-500" />
      </div>
    )
  }
  if (err || !data) {
    return <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700">无法加载性能数据。</p>
  }

  const { live, alerts } = data
  const endpoints = data.endpoints || []
  const slow = data.slow || []
  const m1 = live.last1m
  const m3 = live.last3m
  const poolPct = live.pool.max ? Math.round((live.pool.total / live.pool.max) * 100) : 0
  const p95Hot = m3.p95 > live.thresholds.p95_ms
  const errHot = m3.errPct > live.thresholds.err_pct
  const poolHot = live.pool.waiting >= live.thresholds.pool_wait

  return (
    <div className="space-y-5">
      {/* Live KPI strip — 15s 自动刷新 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard
          label="RPS（近 1 分钟）" value={m1.rps}
          icon={<Zap className="h-4 w-4" />}
          hint={`近 1 分钟 ${m1.req} 请求`}
        />
        <StatCard
          label="p95 延迟（近 3 分钟）"
          value={<span className={p95Hot ? 'text-rose-600' : ''}>{m3.p95}ms</span>}
          icon={<Timer className="h-4 w-4" />}
          hint={`p50 ${m3.p50}ms · p99 ${m3.p99}ms · 阈值 ${live.thresholds.p95_ms}ms`}
        />
        <StatCard
          label="错误率（近 3 分钟）"
          value={<span className={errHot ? 'text-rose-600' : ''}>{m3.errPct}%</span>}
          icon={<AlertTriangle className="h-4 w-4" />}
          hint={`5xx ${m3.err5} · 4xx ${m3.err4} / ${m3.req} 请求`}
        />
        <StatCard
          label="当前并发" value={m1.activeConcurrency}
          icon={<Activity className="h-4 w-4" />}
          hint={`近 3 分钟峰值 ${m3.peakConcurrency}`}
        />
        <StatCard
          label="数据库连接池"
          value={<span className={poolHot ? 'text-rose-600' : ''}>{live.pool.total}/{live.pool.max}</span>}
          icon={<Database className="h-4 w-4" />}
          hint={`空闲 ${live.pool.idle} · 排队 ${live.pool.waiting}（${poolPct}%）`}
        />
      </div>

      {/* Slow query / load secondary row */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="慢请求（近 3 分钟）" value={m3.slowReq} hint={`>${1000}ms 的请求`} icon={<Gauge className="h-4 w-4" />} />
        <StatCard label="慢查询（近 3 分钟）" value={<span className={m3.slowQuery > live.thresholds.slowq_3min ? 'text-rose-600' : ''}>{m3.slowQuery}</span>} hint={`阈值 ${live.thresholds.slowq_3min}`} icon={<Database className="h-4 w-4" />} />
        <StatCard label="DB 查询数（近 3 分钟）" value={m3.query} icon={<Database className="h-4 w-4" />} />
        <StatCard label="总请求（近 3 分钟）" value={m3.req} icon={<Zap className="h-4 w-4" />} />
      </div>

      {/* Trends */}
      <div className="grid gap-3 md:grid-cols-2">
        <TrendChart title="p95 延迟（每分钟 · ms）" points={p95Trend} />
        <TrendChart title="RPS（每分钟均值）" points={rpsTrend} />
      </div>

      {/* Per-endpoint usage + speed (last 5 min) */}
      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/[0.06]">
        <div className="border-b border-slate-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-800">各接口用量 / 速度（近 5 分钟）</h3>
          <p className="text-xs text-slate-400">按请求数排序。p95 标红 = 超过 {live.thresholds.p95_ms}ms。错误为 5xx。</p>
        </div>
        {endpoints.length === 0 ? (
          <p className="px-4 py-6 text-xs text-slate-400">近 5 分钟暂无流量。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-left text-slate-400">
                  <th className="px-4 py-2 font-medium">接口</th>
                  <th className="px-3 py-2 text-right font-medium">请求</th>
                  <th className="px-3 py-2 text-right font-medium">RPS</th>
                  <th className="px-3 py-2 text-right font-medium">错误</th>
                  <th className="px-3 py-2 text-right font-medium">慢</th>
                  <th className="px-3 py-2 text-right font-medium">p50</th>
                  <th className="px-3 py-2 text-right font-medium">p95</th>
                  <th className="px-3 py-2 text-right font-medium">p99</th>
                  <th className="px-3 py-2 text-right font-medium">max</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {endpoints.map((e) => (
                  <tr key={e.key} className="text-slate-600 hover:bg-slate-50/60">
                    <td className="px-4 py-2 font-mono text-[11px] text-slate-700">{e.key}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{e.req}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{e.rps}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${e.err > 0 ? 'text-rose-600' : ''}`}>{e.err}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${e.slow > 0 ? 'text-amber-600' : ''}`}>{e.slow}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{e.p50}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${e.p95 > live.thresholds.p95_ms ? 'font-semibold text-rose-600' : ''}`}>{e.p95}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{e.p99}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-400">{e.max}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 慢请求留证 —— 延迟告警的根因就在这张表里 */}
      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/[0.06]">
        <div className="border-b border-slate-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-800">慢请求(全量留证)</h3>
          <p className="text-xs text-slate-400">
            每个超过 1000ms 的请求都记在这里,带真实 URL 和是谁在等 —— 延迟告警查根因先看这张表。
          </p>
        </div>
        {!slow.length ? (
          <p className="px-4 py-6 text-xs text-slate-400">近期没有慢请求 ✅</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-slate-400">
                <tr className="border-b border-slate-100">
                  <th className="px-4 py-2 font-medium">时间</th>
                  <th className="px-4 py-2 font-medium">接口</th>
                  <th className="px-4 py-2 text-right font-medium">耗时</th>
                  <th className="px-4 py-2 font-medium">谁在等</th>
                  <th className="px-4 py-2 font-medium">URL</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {slow.map((s, i) => (
                  <tr key={i} className="text-slate-600">
                    <td className="whitespace-nowrap px-4 py-2 text-slate-400">
                      {s.at.slice(5, 16).replace('T', ' ')}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 font-mono text-[11px]">{s.endpoint}</td>
                    <td className={`whitespace-nowrap px-4 py-2 text-right font-medium ${s.duration_ms >= 2000 ? 'text-rose-600' : 'text-amber-600'}`}>
                      {(s.duration_ms / 1000).toFixed(1)}s
                      {/* 客户端放弃 = 用户真的等不下去关掉了,比单纯的慢更严重 */}
                      {s.aborted && <span className="ml-1 text-[10px] text-rose-500">已放弃</span>}
                    </td>
                    <td className="max-w-[160px] truncate px-4 py-2 text-slate-500">{s.who || '匿名'}</td>
                    <td className="max-w-[280px] truncate px-4 py-2 font-mono text-[10px] text-slate-400" title={s.url || ''}>
                      {s.url}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Alerts */}
      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/[0.06]">
        <div className="border-b border-slate-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-800">告警记录</h3>
          <p className="text-xs text-slate-400">
            <span className="text-rose-500">接口报错</span> = 事故,永不自动关闭,必须查清根因后手动关。
            延迟/连接池 = 状态,有流量且回到阈值内才会自动关。
          </p>
        </div>
        {alerts.length === 0 ? (
          <p className="px-4 py-6 text-xs text-slate-400">暂无告警 — 一切正常 ✅</p>
        ) : (
          <div className="divide-y divide-slate-50">
            {alerts.map((a) => {
              const incident = INCIDENT_KINDS.has(a.kind)
              const rootCause = (a.detail?.rootCause as string) || ''
              return (
              <div key={a.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 items-start gap-2">
                  {a.active
                    ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
                    : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`text-sm font-medium ${a.active ? 'text-rose-700' : 'text-slate-600'}`}>
                        {KIND_LABEL[a.kind] || a.kind}
                      </span>
                      {a.active
                        ? (
                          <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] text-rose-600">
                            {incident ? '待查根因' : '进行中'}
                          </span>
                        )
                        : (
                          // 事故被关掉 = 有人查清并修了。状态告警被关掉 = 指标回落。
                          // 这两件事完全不同,别都叫「已恢复」。
                          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                            {incident ? '已定位并修复' : '已恢复'}
                          </span>
                        )}
                      {a.emailed && <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-400">已邮件</span>}
                    </div>
                    <p className="truncate text-xs text-slate-500">{a.message}</p>
                    {rootCause && (
                      <p className="mt-0.5 truncate text-[11px] text-emerald-700" title={rootCause}>
                        根因:{rootCause}
                      </p>
                    )}
                    <p className="text-[10px] text-slate-400">
                      {a.created_at.slice(0, 16).replace('T', ' ')}
                      {a.resolved_at ? ` → ${a.resolved_at.slice(11, 16)} ${incident ? '关闭' : '恢复'}` : ''}
                    </p>
                  </div>
                </div>
                {a.active && (
                  <button
                    onClick={() => onAck(a.id)}
                    disabled={acking === a.id}
                    className="shrink-0 rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200 disabled:opacity-50"
                  >
                    {acking === a.id ? '...' : incident ? '已查清根因,关闭' : '标记已解决'}
                  </button>
                )}
              </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
