/**
 * 「实时带看」遥测面板 —— WebSocket 之前是 **100% 全盲** 的那一块。
 *
 * 2026-07-13 合伙人报「带看有半分钟延迟」时,我们没有任何现成数据可查,只能临时写
 * 探针脚本去生产实测。这个面板就是为了让那种事不再发生:
 *
 *   ① 现状 + 容量  —— 单核 CPU(压测:1000 人同时带看 ≈ 105% = 打满)
 *   ② 进房漏斗     —— 客户到底卡在哪一步(那批 peak_participants=1 的房间)
 *   ③ 客户端体感   —— 真凶所在(首屏 + 4.8MB 卫星瓦片)
 *   ④ Agora 成本   —— 唯一真正花钱的东西(WS 同步边际成本是 0)
 */
import { useEffect, useState } from 'react'
import { Loader2, Wifi, Cpu, Gauge, DollarSign, Users, Timer } from 'lucide-react'
import { fetchLiveTourTelemetry, type LiveTourTelemetry as Data } from '../../lib/analyticsApi'

const STEP_LABEL: Record<string, string> = {
  link_open: '点开链接',
  identity_submit: '填了称呼',
  ws_connect: 'WS 连上',
  sync: '进房成功',
  first_cam: '画面跟上',
}

const RUM_LABEL: Record<string, { label: string; unit: 'ms' | 'bytes'; hint?: string }> = {
  'rum.collab.ws_open.ms': { label: 'WS 连上', unit: 'ms' },
  'rum.collab.ttfc.ms': { label: '看到经纪第一帧', unit: 'ms', hint: '点「进入带看」→ 画面开始跟随(4G 实测 1.2s)' },
  'rum.collab.tiles.ms': { label: '瓦片追完', unit: 'ms' },
  'rum.collab.tiles.bytes': { label: '首屏瓦片字节', unit: 'bytes', hint: '实测 4.8MB —— 「半分钟延迟」的真凶' },
  'rum.page.dcl.ms': { label: '首屏(DOMContentLoaded)', unit: 'ms', hint: '弱网实测 7.8s' },
}

const fmt = (v: number, unit: 'ms' | 'bytes') =>
  unit === 'bytes'
    ? v > 1e6 ? `${(v / 1e6).toFixed(1)} MB` : `${Math.round(v / 1e3)} KB`
    : v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`

function Stat({ icon, label, value, sub, danger }: {
  icon: React.ReactNode; label: string; value: string; sub?: string; danger?: boolean
}) {
  return (
    <div className={`rounded-2xl bg-white p-4 shadow-sm ring-1 ${danger ? 'ring-rose-200' : 'ring-slate-900/[0.06]'}`}>
      <div className="flex items-center gap-1.5 text-xs text-slate-400">{icon}{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${danger ? 'text-rose-600' : 'text-slate-800'}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-slate-400">{sub}</div>}
    </div>
  )
}

export default function LiveTourTelemetry() {
  const [d, setD] = useState<Data | null>(null)

  useEffect(() => {
    const load = () => fetchLiveTourTelemetry(24).then(setD).catch(() => setD(null))
    load()
    const t = setInterval(load, 15_000)   // 现状要实时感
    return () => clearInterval(t)
  }, [])

  if (!d) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-teal-500" /></div>

  const { live, funnel, rum, agora } = d
  const cpuDanger = live.cpuPct >= live.capacity.cpuWarnPct
  const lagDanger = live.loopLagMs > 100

  return (
    <div className="space-y-5">
      {/* ① 现状 + 容量 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={<Wifi className="h-3.5 w-3.5" />} label="WS 连接" value={String(live.wsConnections)}
          sub={`${live.activeRooms} 个房间在进行`} />
        <Stat icon={<Cpu className="h-3.5 w-3.5" />} label="单核 CPU" value={`${live.cpuPct}%`}
          sub={cpuDanger ? '⚠️ 接近天花板' : '100% = 开始积压'} danger={cpuDanger} />
        <Stat icon={<Gauge className="h-3.5 w-3.5" />} label="事件循环滞后" value={`${live.loopLagMs}ms`}
          sub={lagDanger ? '⚠️ 所有接口都在排队' : '主线程健康'} danger={lagDanger} />
        <Stat icon={<DollarSign className="h-3.5 w-3.5" />} label="Agora 通话(30天)" value={`$${agora.totalUsd}`}
          sub={`${agora.totalUnits} units · WS 同步成本 $0`} />
      </div>
      <p className="-mt-2 px-1 text-[11px] text-slate-400">
        容量:{live.capacity.note}。加核没用(单线程用不上)—— 到顶了先把 cam 从 20Hz 降到 10Hz,容量直接翻倍。
      </p>

      {/* ② 进房漏斗 */}
      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-900/[0.06]">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-slate-400" />
          <h3 className="text-sm font-semibold text-slate-800">客户进房漏斗 · 24h</h3>
          <span className="text-xs text-slate-400">断崖在哪,客户就卡在哪</span>
        </div>
        {funnel.every((s) => s.count === 0) ? (
          <p className="py-6 text-center text-xs text-slate-400">这 24 小时还没有客户进过带看。</p>
        ) : (
          <div className="mt-3 space-y-2">
            {funnel.map((s) => {
              const pct = s.fromFirstPct ?? 0
              const drop = s.fromPrevPct !== null && s.fromPrevPct < 70
              return (
                <div key={s.step} className="flex items-center gap-3">
                  <div className="w-24 shrink-0 text-xs text-slate-600">{STEP_LABEL[s.step] || s.step}</div>
                  <div className="h-5 flex-1 overflow-hidden rounded bg-slate-50">
                    <div className={`h-full ${drop ? 'bg-rose-400' : 'bg-teal-400'}`} style={{ width: `${Math.max(2, pct)}%` }} />
                  </div>
                  <div className="w-28 shrink-0 text-right text-xs tabular-nums text-slate-500">
                    {s.count}
                    {s.fromPrevPct !== null && (
                      <span className={drop ? 'ml-1 font-semibold text-rose-600' : 'ml-1 text-slate-400'}>
                        {s.fromPrevPct}%
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ③ 客户端体感(真凶) */}
      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-900/[0.06]">
        <div className="flex items-center gap-2">
          <Timer className="h-4 w-4 text-slate-400" />
          <h3 className="text-sm font-semibold text-slate-800">客户端真实体感 · 24h</h3>
          <span className="text-xs text-slate-400">「半分钟延迟」的真凶在这里,不在网络</span>
        </div>
        {rum.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-400">还没有客户端上报(要等真实客户打开带看)。</p>
        ) : (
          <div className="mt-3 divide-y divide-slate-50">
            {rum.map((r) => {
              const meta = RUM_LABEL[r.name] || { label: r.name, unit: 'ms' as const }
              return (
                <div key={r.name} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-slate-700">{meta.label}</div>
                    {meta.hint && <div className="text-[10px] text-slate-400">{meta.hint}</div>}
                  </div>
                  <div className="w-20 shrink-0 text-right text-xs tabular-nums text-slate-500">
                    p50 {fmt(r.p50, meta.unit)}
                  </div>
                  <div className="w-24 shrink-0 text-right text-xs font-semibold tabular-nums text-slate-700">
                    p95 {fmt(r.p95, meta.unit)}
                  </div>
                  <div className="w-16 shrink-0 text-right text-[10px] text-slate-300">{r.samples} 次</div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ④ Agora 成本 */}
      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-900/[0.06]">
        <div className="flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-slate-400" />
          <h3 className="text-sm font-semibold text-slate-800">通话成本 · 30 天</h3>
          <span className="text-xs text-slate-400">
            语音 1 分钟 = 1 unit = ${agora.usdPerUnit} · 视频是 4 倍 · WebSocket 同步是免费的
          </span>
        </div>
        {agora.top.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-400">30 天内没有通话消耗。</p>
        ) : (
          <div className="mt-3 divide-y divide-slate-50">
            {agora.top.map((t) => (
              <div key={t.email} className="flex items-center gap-3 py-2 text-xs">
                <span className="min-w-0 flex-1 truncate text-slate-700">{t.email}</span>
                <span className="w-20 shrink-0 text-right tabular-nums text-slate-400">{t.units} units</span>
                <span className="w-16 shrink-0 text-right font-semibold tabular-nums text-slate-700">${t.usd}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
