/**
 * 「AI & 管线」面板 —— 三块之前**完全是盲的**东西:
 *
 *   ① AI 成本    全 backend 原来没有一处读 usageMetadata → 不知道花了多少、哪个功能在烧
 *   ② PDF 管线   跑在独立的 worker 进程,零遥测 → 卡住/失败只有 docker logs 里一行
 *   ③ 钱门       谁被 paywall 挡住、被什么挡的 → 转化漏斗里最值钱的一格
 *   ④ Tour 漏斗  辛苦生成的 tour,到底有没有人看?
 */
import { useEffect, useState } from 'react'
import {
  Loader2, Cpu, DollarSign, FileStack, Lock, Film, AlertTriangle,
  TrendingUp, ArrowLeftRight,
} from 'lucide-react'
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

const money = (usd: number) => (usd < 0.01 && usd > 0 ? '<$0.01' : `$${num(usd)}`)

/**
 * 安全的数字格式化。**别在这个面板里直接写 `.toFixed()`。**
 *
 * WHY(2026-08-01 白屏事故):后端字段叫 `projectedUsd`,前端类型手写成
 * `projectedMonthlyUsd` —— 两份类型对不上,tsc 抓不到,`undefined.toFixed()`
 * 直接把**整个运维面板**炸成 error boundary。运维面板恰恰是出事时要看的东西,
 * 它不该因为一个字段改名就整页打不开。
 */
const num = (v: number | null | undefined, p = 2): string =>
  typeof v === 'number' && Number.isFinite(v) ? v.toFixed(p) : '—'

/**
 * 功能名 → 人话。task 是埋点用的低基数枚举,直接显示看不懂是哪块功能。
 * 名字取自生产库里真实出现过的 task 值;没登记的直接显示原名(不会漏数)。
 */
const TASK_LABEL: Record<string, string> = {
  'tour-generator': 'Tour 脚本生成',
  'storyboard-review': 'Tour 分镜自查',
  'revise-instruction': 'Tour 文案修改',
  'luna-tour.tts': 'Tour 旁白合成(TTS)',
  'luna-live': 'Luna 实时语音',
  'luna-summary': 'Luna 会话摘要',
  'collab-report': '带看报告',
  'auto-config': '自动配置',
  'auto-match': '自动选盘',
  'auto-report': '自动报告',
  'client-fit': '客户匹配分析',
  'profile-coach': '客户画像追问',
  // PDF 楼书管线(2026-08-01 才开始计量,之前这条线的钱一分没记)
  'pdf.page-classifier': '楼书·页面分类',
  'pdf.pricing-extractor': '楼书·价格表',
  'pdf.unit-detail-extractor': '楼书·户型',
  'pdf.payment-plan-extractor': '楼书·付款计划',
  'pdf.project-info-extractor': '楼书·项目信息',
  'pdf.project-description-generator': '楼书·项目描述',
  'pdf.amenity-extractor': '楼书·配套',
  'pdf.section-reconstructor': '楼书·章节重建',
  'pdf.text-insights-extractor': '楼书·文本洞察',
}

export default function OpsTelemetry() {
  const [d, setD] = useState<Data | null>(null)
  useEffect(() => {
    const load = () => fetchOpsTelemetry(24).then(setD).catch(() => setD(null))
    load()
    const t = setInterval(load, 30_000)
    return () => clearInterval(t)
  }, [])

  if (!d) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-teal-500" /></div>

  const { ai, forecast, whatIf, pdf, paywall, tourFunnel } = d
  const q = pdf.queue
  const maxDay = Math.max(...forecast.daily.map((x) => x.usd), 0.0001)
  const cheaper = whatIf.candidates.filter((c) => c.projectedMonthlyUsd < whatIf.current)

  return (
    <div className="space-y-5">
      {/* ⓪ 月成本预测 —— 唯一能和收入比较的数 */}
      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-900/[0.06]">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-slate-400" />
          <h3 className="text-sm font-semibold text-slate-800">AI 月成本预测</h3>
          <span className="text-xs text-slate-400">按最近 7 天速率外推 —— 别等账单来了才知道</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-xl bg-slate-900 p-3 text-white">
            <div className="text-[10px] text-slate-400">预计本月</div>
            <div className="mt-0.5 text-2xl font-semibold tabular-nums">
              ${num(forecast.projectedMonthlyUsd)}
            </div>
          </div>
          {[
            { label: '近 7 天 / 日均', v: money(forecast.perDay7) },
            { label: '近 30 天 / 日均', v: money(forecast.perDay30) },
          ].map((s) => (
            <div key={s.label} className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-100">
              <div className="text-[10px] text-slate-400">{s.label}</div>
              <div className="mt-0.5 text-lg font-semibold tabular-nums text-slate-800">{s.v}</div>
            </div>
          ))}
          <div className={`rounded-xl p-3 ring-1 ${
            forecast.trend > 1.5 ? 'bg-rose-50 ring-rose-200' : 'bg-slate-50 ring-slate-100'}`}
            title="7 日均 ÷ 30 日均。>1 = 在涨">
            <div className="text-[10px] text-slate-400">趋势</div>
            <div className={`mt-0.5 text-lg font-semibold tabular-nums ${
              forecast.trend > 1.5 ? 'text-rose-600' : 'text-slate-800'}`}>
              {forecast.trend > 0 ? `${num(forecast.trend)}×` : '—'}
            </div>
          </div>
        </div>

        {/* 每日花费趋势 */}
        {forecast.daily.length > 1 && (
          <div className="mt-4">
            <div className="mb-1 text-[11px] text-slate-400">近 30 天每天花了多少</div>
            <div className="flex h-16 items-end gap-px">
              {forecast.daily.map((x) => (
                <div key={x.date} className="flex-1 rounded-t bg-teal-400/70 hover:bg-teal-500"
                  style={{ height: `${Math.max(2, (x.usd / maxDay) * 100)}%` }}
                  title={`${x.date} — ${money(x.usd)}`} />
              ))}
            </div>
          </div>
        )}

        {/* 按功能拆:每个功能的月成本 + 单次成本 */}
        {forecast.tasks.length > 0 && (
          <div className="mt-4 border-t border-slate-50 pt-2">
            <div className="mb-1 flex items-center gap-2 text-[11px] text-slate-400">
              <span className="flex-1">按功能拆(近 7 天)</span>
              <span className="w-20 text-end">调用</span>
              <span className="w-24 text-end">单次成本</span>
              <span className="w-24 text-end">预计月成本</span>
            </div>
            {forecast.tasks.map((t) => (
              <div key={t.task} className="flex items-center gap-2 py-1.5 text-xs">
                <span className="min-w-0 flex-1 truncate font-medium text-slate-700">
                  {TASK_LABEL[t.task] || t.task}
                </span>
                <span className="w-20 text-end tabular-nums text-slate-400">{t.calls7}</span>
                <span className="w-24 text-end tabular-nums text-slate-500">
                  {t.usdPerCall > 0 ? `$${num(t.usdPerCall, 4)}` : '—'}
                </span>
                <span className="w-24 text-end font-semibold tabular-nums text-slate-800">
                  ${num(t.projectedMonthlyUsd)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ⓪′ 换模型试算 */}
      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-900/[0.06]">
        <div className="flex items-center gap-2">
          <ArrowLeftRight className="h-4 w-4 text-slate-400" />
          <h3 className="text-sm font-semibold text-slate-800">换模型要多少钱</h3>
          <span className="text-xs text-slate-400">
            拿近 7 天真实的 {num(whatIf.basis.inTokens / 1e6, 1)}M 进 /{' '}
            {num(whatIf.basis.outTokens / 1e6, 1)}M 出,按各家单价重算
          </span>
        </div>
        <div className="mt-3 divide-y divide-slate-50">
          {whatIf.candidates.map((c) => {
            const diff = c.projectedMonthlyUsd - whatIf.current
            return (
              <div key={c.model} className="flex items-center gap-3 py-2 text-xs">
                <span className="w-16 shrink-0 rounded bg-slate-50 px-1.5 py-0.5 text-center text-[10px] text-slate-500">
                  {c.provider}
                </span>
                <span className="min-w-0 flex-1 truncate text-slate-700">
                  {c.model.split(':')[1]}
                  {c.note && <span className="ms-2 text-slate-400">{c.note}</span>}
                </span>
                {!c.verified && (
                  <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700"
                    title={`单价录于 ${c.asOf},未对官方价目表核对`}>
                    单价待核对
                  </span>
                )}
                <span className={`w-20 shrink-0 text-end tabular-nums ${
                  diff < 0 ? 'text-emerald-600' : diff > 0 ? 'text-slate-400' : 'text-slate-300'}`}>
                  {diff === 0 ? '—' : `${diff < 0 ? '' : '+'}${num(diff, 0)}`}
                </span>
                <span className="w-24 shrink-0 text-end font-semibold tabular-nums text-slate-700">
                  ${num(c.projectedMonthlyUsd)}
                </span>
              </div>
            )
          })}
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
          ⚠️ 各家 tokenizer 切分不同(±10~30% 常见),这里按等量 token 估算 ——
          用来排序和判断量级,不是报价单。
          {cheaper.length > 0 && (
            <> 目前有 <b className="text-slate-600">{cheaper.length}</b> 个候选比现状便宜。</>
          )}
          {whatIf.stale.length > 0 && (
            <> 另有 <b className="text-amber-600">{whatIf.stale.length}</b> 条单价过期或未核对
            (跑 <code className="text-slate-500">scripts/check-ai-pricing.ts</code>)。</>
          )}
        </p>
      </div>

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
                <span className="w-20 shrink-0 text-end tabular-nums text-slate-400">p95 {num(t.p95 / 1000, 1)}s</span>
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
