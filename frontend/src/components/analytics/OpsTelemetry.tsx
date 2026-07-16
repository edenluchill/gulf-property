/**
 * 「AI & 管线」面板 —— 三块之前**完全是盲的**东西:
 *
 *   ① AI 成本    全 backend 原来没有一处读 usageMetadata → 不知道花了多少、哪个功能在烧
 *   ② PDF 管线   跑在独立的 worker 进程,零遥测 → 卡住/失败只有 docker logs 里一行
 *   ③ 钱门       谁被 paywall 挡住、被什么挡的 → 转化漏斗里最值钱的一格
 *   ④ Tour 漏斗  辛苦生成的 tour,到底有没有人看?
 */
import { useEffect, useState } from 'react'
import { Loader2, Cpu, DollarSign, FileStack, Lock, Film, AlertTriangle } from 'lucide-react'
import { fetchOpsTelemetry, type OpsTelemetry as Data } from '../../lib/analyticsApi'

const TOUR_STEP: Record<string, string> = {
  create: '经纪点生成',
  draft_ready: '草稿出来了',
  render: '确认发布(扣额度)',
  audio_ready: '语音全部就绪',
  client_open: '客户真的点开了',
}

const FEATURE_LABEL: Record<string, string> = {
  reports: '买家意向报告', brochures: 'AI 楼书解析', live_tours: '实时带看',
  luna_tours: 'Luna 导览', payplan: 'Sales Offer', live_call: '通话与视频',
}

const money = (usd: number) => (usd < 0.01 && usd > 0 ? '<$0.01' : `$${usd.toFixed(2)}`)

export default function OpsTelemetry() {
  const [d, setD] = useState<Data | null>(null)
  useEffect(() => {
    const load = () => fetchOpsTelemetry(24).then(setD).catch(() => setD(null))
    load()
    const t = setInterval(load, 30_000)
    return () => clearInterval(t)
  }, [])

  if (!d) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-teal-500" /></div>

  const { ai, pdf, paywall, tourFunnel } = d
  const q = pdf.queue

  return (
    <div className="space-y-5">
      {/* ① AI 成本 */}
      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-900/[0.06]">
        <div className="flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-slate-400" />
          <h3 className="text-sm font-semibold text-slate-800">AI 成本 · 24h</h3>
          <span className="text-xs text-slate-400">按功能拆开 —— 谁在烧钱、谁在失败</span>
          <span className="ms-auto text-lg font-semibold tabular-nums text-slate-800">{money(ai.totalUsd)}</span>
        </div>
        {ai.tasks.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-400">24 小时内没有 AI 调用。</p>
        ) : (
          <div className="mt-3 divide-y divide-slate-50">
            {ai.tasks.map((t) => (
              <div key={t.task} className="flex items-center gap-3 py-2 text-xs">
                <span className="min-w-0 flex-1 truncate font-medium text-slate-700">{t.task}</span>
                {t.fallback > 0 && (
                  <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700"
                    title="退到了备用模型 —— 说明主模型有问题(废弃/限流/挂了)">
                    降级 {t.fallback}
                  </span>
                )}
                {t.failed > 0 && (
                  <span className="shrink-0 rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">
                    失败 {t.failed}
                  </span>
                )}
                <span className="w-16 shrink-0 text-end tabular-nums text-slate-400">{t.calls} 次</span>
                <span className="w-20 shrink-0 text-end tabular-nums text-slate-400">p95 {(t.p95 / 1000).toFixed(1)}s</span>
                <span className="w-20 shrink-0 text-end font-semibold tabular-nums text-slate-700">{money(t.usd)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ② PDF 管线 */}
      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-900/[0.06]">
        <div className="flex items-center gap-2">
          <FileStack className="h-4 w-4 text-slate-400" />
          <h3 className="text-sm font-semibold text-slate-800">楼书处理管线(worker 进程)</h3>
          <span className="text-xs text-slate-400">之前这条线内部完全没有遥测</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-5">
          {[
            { label: '排队中', v: q.pending, danger: q.pending > 5 },
            { label: '处理中', v: q.processing },
            { label: '队首等待', v: `${Math.round(q.oldestWaitS / 60)}分`, danger: q.oldestWaitS > 900 },
            { label: '卡死', v: q.stuck, danger: q.stuck > 0, hint: 'worker 被 OOM kill 的孤儿,永远不会重试' },
            { label: 'Worker 内存', v: `${q.workerRssMb}MB`, danger: q.workerRssMb > 6000 },
          ].map((s) => (
            <div key={s.label} className={`rounded-xl p-3 ring-1 ${s.danger ? 'bg-rose-50 ring-rose-200' : 'bg-slate-50 ring-slate-100'}`} title={s.hint}>
              <div className="text-[10px] text-slate-400">{s.label}</div>
              <div className={`mt-0.5 text-lg font-semibold tabular-nums ${s.danger ? 'text-rose-600' : 'text-slate-800'}`}>{s.v}</div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex gap-4 text-xs text-slate-500">
          <span>24h 完成 <b className="tabular-nums text-slate-700">{pdf.jobs.completed}</b></span>
          <span>失败 <b className={`tabular-nums ${pdf.jobs.failed > 0 ? 'text-rose-600' : 'text-slate-700'}`}>{pdf.jobs.failed}</b></span>
        </div>
        {pdf.agents.length > 0 && (
          <div className="mt-3 border-t border-slate-50 pt-2">
            <div className="mb-1 text-[11px] text-slate-400">各抽取 agent 的成败(某个 agent 全挂 = 客户的楼书缺那块数据)</div>
            {pdf.agents.map((a) => (
              <div key={a.agent} className="flex items-center gap-3 py-1 text-xs">
                <span className="min-w-0 flex-1 truncate text-slate-600">{a.agent}</span>
                {a.failed > 0 && <span className="flex items-center gap-0.5 text-rose-600"><AlertTriangle className="h-3 w-3" />{a.failed} 失败</span>}
                {a.invalid > 0 && <span className="text-amber-600">{a.invalid} 校验没过</span>}
                <span className="w-12 text-end tabular-nums text-slate-400">{a.ok} ok</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ③ Tour 漏斗 */}
      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-900/[0.06]">
        <div className="flex items-center gap-2">
          <Film className="h-4 w-4 text-slate-400" />
          <h3 className="text-sm font-semibold text-slate-800">Luna Tour:生成 → 客户观看 · 24h</h3>
          <span className="text-xs text-slate-400">辛苦生成的 tour,到底有没有人看?</span>
        </div>
        {tourFunnel.every((s) => s.count === 0) ? (
          <p className="py-6 text-center text-xs text-slate-400">24 小时内没有生成过 tour。</p>
        ) : (
          <div className="mt-3 space-y-2">
            {tourFunnel.map((s) => {
              const drop = s.fromPrevPct !== null && s.fromPrevPct < 70
              return (
                <div key={s.step} className="flex items-center gap-3">
                  <div className="w-32 shrink-0 text-xs text-slate-600">{TOUR_STEP[s.step] || s.step}</div>
                  <div className="h-5 flex-1 overflow-hidden rounded bg-slate-50">
                    <div className={`h-full ${drop ? 'bg-rose-400' : 'bg-teal-400'}`}
                      style={{ width: `${Math.max(2, s.fromFirstPct ?? 0)}%` }} />
                  </div>
                  <div className="w-24 shrink-0 text-end text-xs tabular-nums text-slate-500">
                    {s.count}
                    {s.fromPrevPct !== null && (
                      <span className={drop ? 'ms-1 font-semibold text-rose-600' : 'ms-1 text-slate-400'}>{s.fromPrevPct}%</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ④ 钱门 */}
      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-900/[0.06]">
        <div className="flex items-center gap-2">
          <Lock className="h-4 w-4 text-slate-400" />
          <h3 className="text-sm font-semibold text-slate-800">被 paywall 挡住的人 · 7 天</h3>
          <span className="text-xs text-slate-400">想用但用不了 —— 最热的线索</span>
        </div>
        {paywall.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-400">7 天内没有人撞到收费门。</p>
        ) : (
          <div className="mt-3 divide-y divide-slate-50">
            {paywall.map((p, i) => (
              <div key={i} className="flex items-center gap-3 py-2 text-xs">
                <span className="min-w-0 flex-1 text-slate-700">{FEATURE_LABEL[p.feature] || p.feature}</span>
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${
                  p.reason === 'insufficient_credits' ? 'bg-amber-50 text-amber-700' : 'bg-sky-50 text-sky-700'}`}>
                  {p.reason === 'insufficient_credits' ? '积分用完了' : '需要订阅'}
                </span>
                {p.trial && <span className="shrink-0 text-[10px] text-violet-600">试用中</span>}
                <span className="w-12 shrink-0 text-end font-semibold tabular-nums text-slate-700">{p.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5 px-1 text-[11px] text-slate-400">
        <Cpu className="h-3 w-3" />
        全部来自通用遥测(docs/telemetry-spec.md)—— 加新功能的埋点只需三行,不用建表。
      </div>
    </div>
  )
}
