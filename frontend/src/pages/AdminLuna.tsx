/**
 * Admin · Luna 体验看板 + 自测台
 *
 * owner 的原话：**「要一个完整 admin 能人手或者 AI 直接测试的系统，并能根据
 * live chat 完整知道体验 —— 客户说话到 AI 回话隔了多久、回了什么。」**
 *
 * 三块：
 *   1. 顶部指标 —— 最要紧的是 **「没查就说」** 那一格（见下）
 *   2. 真实会话 → 逐轮时间线（延迟 / 说了什么 / 有没有问 Brain，异常标红）
 *   3. 自测台 —— 点一下就跑，AI 走同一个 API，结果留档可对比
 *
 * 🔴 **「没查就说」是这个页面的核心指标。** 所有护栏（数据边界/诚实规则/
 * 澄清出路）都在 Brain 里；Live 不问 Brain 直接开口的轮次 = 护栏全失效。
 * 2026-08-10「AI 说自己能卖二手房」就是这么冒出来的 —— 同样的问题直接问
 * Brain，答案是对的。
 */
import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  lunaHealth, lunaSessions, lunaSession, lunaTests, lunaTest, startLunaTest, lunaScenarios,
  lunaTools, lunaToolCalls,
  type LunaHealth, type LunaSessionRow, type LunaTurn, type TestRun, type TestCase,
  type ToolStat, type ToolCallSample,
} from '../lib/lunaAdminApi'

const fmtMs = (v: number | string | null | undefined) => {
  const n = typeof v === 'string' ? parseFloat(v) : v
  if (n == null || !Number.isFinite(n)) return '—'
  return n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${Math.round(n)}ms`
}
const fmtTime = (s: string) => new Date(s).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })

/** 体感延迟的红线 —— 语音里超过 3 秒客户就以为掉线了。 */
const SLOW_MS = 3000

function Stat({ label, value, hint, bad }: { label: string; value: string; hint?: string; bad?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${bad ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white'}`}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${bad ? 'text-red-600' : 'text-slate-800'}`}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-slate-400">{hint}</div>}
    </div>
  )
}

export default function AdminLuna() {
  const [health, setHealth] = useState<LunaHealth | null>(null)
  const [sessions, setSessions] = useState<LunaSessionRow[]>([])
  const [openSession, setOpenSession] = useState<string | null>(null)
  const [turns, setTurns] = useState<LunaTurn[]>([])
  const [runs, setRuns] = useState<TestRun[]>([])
  const [openRun, setOpenRun] = useState<string | null>(null)
  const [cases, setCases] = useState<TestCase[]>([])
  const [scenarioCount, setScenarioCount] = useState(0)
  const [tools, setTools] = useState<ToolStat[]>([])
  const [neverCalled, setNeverCalled] = useState<Array<{ tool: string; description: string }>>([])
  const [openTool, setOpenTool] = useState<string | null>(null)
  const [toolCalls, setToolCalls] = useState<ToolCallSample[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [h, s, t, sc, tl] = await Promise.all([
        lunaHealth(7), lunaSessions(14), lunaTests(), lunaScenarios(), lunaTools(30),
      ])
      setHealth(h); setSessions(s.sessions); setRuns(t.runs); setScenarioCount(sc.scenarios.length)
      setTools(tl.tools); setNeverCalled(tl.neverCalled)
      setErr(null)
    } catch (e) { setErr(String((e as Error)?.message || e)) }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  // 有测试在跑就自动轮询 —— 不用手动刷。
  useEffect(() => {
    if (!runs.some(r => r.status === 'running')) return
    const t = setInterval(() => {
      lunaTests().then(x => setRuns(x.runs)).catch(() => {})
      if (openRun) lunaTest(openRun).then(x => setCases(x.cases)).catch(() => {})
    }, 4000)
    return () => clearInterval(t)
  }, [runs, openRun])

  const openT = async (name: string) => {
    if (openTool === name) { setOpenTool(null); return }
    setOpenTool(name); setToolCalls([])
    try { setToolCalls((await lunaToolCalls(name)).calls) } catch (e) { setErr(String(e)) }
  }
  const openS = async (id: string) => {
    setOpenSession(id); setTurns([])
    try { setTurns((await lunaSession(id)).turns) } catch (e) { setErr(String(e)) }
  }
  const openR = async (id: string) => {
    setOpenRun(id); setCases([])
    try { setCases((await lunaTest(id)).cases) } catch (e) { setErr(String(e)) }
  }
  const run = async (kind: 'brain' | 'live') => {
    setBusy(true)
    try {
      const { runId } = await startLunaTest({ kind })
      await refresh(); await openR(runId)
    } catch (e) { setErr(String((e as Error)?.message || e)) } finally { setBusy(false) }
  }

  const uncheckedN = parseInt(health?.unchecked_turns || '0')

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-800">Luna 体验看板</h1>
            <p className="text-xs text-slate-500">真实会话逐轮回放 · 延迟 · 自测台（近 7 天指标 / 14 天会话）</p>
          </div>
          <Link to="/admin/analytics" className="text-sm text-slate-500 hover:text-slate-700">← 数据看板</Link>
        </div>

        {err && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{err}</div>}

        {/* ── 指标 ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat label="会话" value={health?.sessions ?? '—'} />
          <Stat label="Luna 开口轮次" value={health?.spoken_turns ?? '—'} />
          <Stat
            label="🔴 没查就说"
            value={String(uncheckedN)}
            hint="绕过 Brain = 护栏全失效"
            bad={uncheckedN > 0}
          />
          <Stat
            label="体感延迟 p50"
            value={fmtMs(health?.p50_first_audio_ms)}
            hint={`p95 ${fmtMs(health?.p95_first_audio_ms)} · 说完到出声`}
            bad={parseFloat(health?.p50_first_audio_ms || '0') > SLOW_MS}
          />
          <Stat label="Brain 平均耗时" value={fmtMs(health?.avg_brain_ms)} hint={`降级 ${health?.degraded_turns ?? '—'} · 纯澄清 ${health?.clarifying_turns ?? '—'}`} />
        </div>

        {/* ── 自测台 ───────────────────────────────────────────── */}
        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
            <div>
              <h2 className="text-sm font-medium text-slate-700">自测台</h2>
              <p className="text-[11px] text-slate-400">{scenarioCount} 个场景，全部取自真实生产事故。AI 走同一个 API，结果可比。</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => run('brain')} disabled={busy}
                className="rounded bg-slate-800 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
                跑大脑层（快·几分钱）
              </button>
              <button onClick={() => run('live')} disabled={busy}
                className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-50">
                跑真模型（慢·烧额度）
              </button>
            </div>
          </div>

          <div className="divide-y divide-slate-100">
            {runs.length === 0 && <p className="px-4 py-6 text-center text-xs text-slate-400">还没跑过</p>}
            {runs.map(r => (
              <div key={r.id}>
                <button onClick={() => openR(r.id)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${
                    r.status === 'running' ? 'animate-pulse bg-amber-400'
                    : r.status === 'failed' ? 'bg-red-500'
                    : r.passed === r.total ? 'bg-emerald-500' : 'bg-orange-400'}`} />
                  <span className="w-28 shrink-0 text-xs text-slate-500">{fmtTime(r.created_at)}</span>
                  <span className="w-16 shrink-0 text-xs font-medium text-slate-600">{r.kind === 'live' ? '真模型' : '大脑层'}</span>
                  <span className="text-sm text-slate-700">
                    {r.status === 'running' ? '跑分中…' : `${r.passed ?? '?'}/${r.total ?? '?'} 通过`}
                    {r.avg_score && <span className="ml-2 text-slate-500">裁判 {parseFloat(r.avg_score).toFixed(2)}/5</span>}
                  </span>
                  {r.error && <span className="truncate text-xs text-red-600">{r.error}</span>}
                  <span className="ml-auto text-xs text-slate-400">{r.triggered_by}</span>
                </button>

                {openRun === r.id && (
                  <div className="space-y-2 bg-slate-50 px-4 py-3">
                    {cases.length === 0 && <p className="text-xs text-slate-400">载入中…</p>}
                    {cases.map(c => (
                      <div key={c.scenario_id} className={`rounded border p-2.5 ${c.passed ? 'border-slate-200 bg-white' : 'border-red-200 bg-red-50'}`}>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-medium ${c.passed ? 'text-emerald-600' : 'text-red-600'}`}>{c.passed ? '✓' : '✗'}</span>
                          <span className="text-xs font-medium text-slate-700">{c.scenario_id}</span>
                          {c.score != null && <span className="text-[11px] text-slate-500">裁判 {c.score}/5</span>}
                          <span className="ml-auto text-[11px] text-slate-400">{fmtMs(c.ms)}</span>
                        </div>
                        {(c.failures || []).map((f, i) => (
                          <p key={i} className="mt-1 text-[11px] text-red-600">→ {f}</p>
                        ))}
                        <p className="mt-1 text-[11px] text-slate-500">{c.verdict}</p>
                        {(c.turns || []).map((t, i) => (
                          <div key={i} className="mt-1.5 border-l-2 border-slate-200 pl-2">
                            <p className="text-[11px] text-slate-500">👤 {t.user}</p>
                            <p className="text-[11px] text-slate-700">🤖 {t.reply || '(沉默)'}</p>
                            <p className="text-[10px] text-slate-400">
                              {t.askedBrain ? `🔧 ${t.tools.join(', ') || '—'}` : '⚠️ 没调工具'} · {fmtMs(t.ms)}
                            </p>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* ── 工具使用与犯错率 ──────────────────────────────────── */}
        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-medium text-slate-700">工具使用与犯错率（近 30 天）</h2>
            <p className="text-[11px] text-slate-400">
              点开看真实调用：<b>客户原话</b> 和 <b>模型填的参数</b> 并排 —— 光看失败率不知道该改 description 还是改工具
            </p>
          </div>

          {/* 三档失败要分开看：not_found=数据缺口 · ambiguous=匹配器该调 · empty=条件太窄 */}
          <div className="grid grid-cols-[1fr_auto] gap-x-4 px-4 py-2 text-[10px] uppercase tracking-wide text-slate-400">
            <span>工具</span>
            <span>调用 · ok / 空 / 查无 / 歧义 / 错</span>
          </div>

          <div className="divide-y divide-slate-100">
            {tools.length === 0 && <p className="px-4 py-6 text-center text-xs text-slate-400">近 30 天还没有工具调用记录</p>}
            {tools.map(t => {
              const n = parseInt(t.calls)
              const bad = parseInt(t.empty) + parseInt(t.not_found) + parseInt(t.ambiguous) + parseInt(t.errored)
              const badPct = n ? Math.round((bad / n) * 100) : 0
              return (
                <div key={t.tool}>
                  <button onClick={() => openT(t.tool)} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-slate-50">
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-700">{t.tool}</span>
                    <span className="shrink-0 text-xs text-slate-500">{t.calls} 次</span>
                    <span className="shrink-0 text-[11px] tabular-nums">
                      <span className="text-emerald-600">{t.ok}</span>
                      <span className="text-slate-300"> / </span>
                      <span className={parseInt(t.empty) ? 'text-amber-600' : 'text-slate-300'}>{t.empty}</span>
                      <span className="text-slate-300"> / </span>
                      <span className={parseInt(t.not_found) ? 'text-orange-600' : 'text-slate-300'}>{t.not_found}</span>
                      <span className="text-slate-300"> / </span>
                      <span className={parseInt(t.ambiguous) ? 'text-blue-600' : 'text-slate-300'}>{t.ambiguous}</span>
                      <span className="text-slate-300"> / </span>
                      <span className={parseInt(t.errored) ? 'text-red-600' : 'text-slate-300'}>{t.errored}</span>
                    </span>
                    <span className={`w-12 shrink-0 text-right text-xs font-medium ${badPct >= 40 ? 'text-red-600' : badPct >= 20 ? 'text-amber-600' : 'text-slate-400'}`}>
                      {badPct}%
                    </span>
                    <span className="w-14 shrink-0 text-right text-[11px] text-slate-400">{fmtMs(t.avg_ms)}</span>
                  </button>

                  {openTool === t.tool && (
                    <div className="space-y-1.5 bg-slate-50 px-4 py-3">
                      {toolCalls.length === 0 && <p className="text-xs text-slate-400">载入中…</p>}
                      {toolCalls.map((c, i) => (
                        <div key={i} className={`rounded border p-2 ${c.outcome === 'ok' ? 'border-slate-200 bg-white' : 'border-amber-200 bg-amber-50'}`}>
                          <div className="flex flex-wrap items-center gap-2 text-[10px]">
                            <span className={`rounded px-1.5 py-0.5 font-medium ${
                              c.outcome === 'ok' ? 'bg-emerald-100 text-emerald-700' :
                              c.outcome === 'error' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{c.outcome}</span>
                            {c.intended && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">Live 点名</span>}
                            <span className="ml-auto text-slate-400">{fmtTime(c.created_at)}</span>
                          </div>
                          {c.user_said && <p className="mt-1 text-[11px] text-slate-600">👤 {c.user_said}</p>}
                          <p className="mt-0.5 break-all font-mono text-[10px] text-slate-500">
                            {typeof c.params === 'string' ? c.params : JSON.stringify(c.params)}
                          </p>
                          {c.summary && <p className="mt-0.5 text-[10px] text-slate-400">{c.summary.slice(0, 200)}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {neverCalled.length > 0 && (
            <div className="border-t border-slate-100 px-4 py-2.5">
              <p className="text-[11px] text-slate-400">
                <b className="text-slate-500">从没被调用过（{neverCalled.length}）</b> —— 要么 description 模型看不懂，要么这个能力没人要：
                <span className="font-mono"> {neverCalled.map(t => t.tool).join(' · ')}</span>
              </p>
            </div>
          )}
        </section>

        {/* ── 真实会话 ─────────────────────────────────────────── */}
        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-medium text-slate-700">真实会话</h2>
            <p className="text-[11px] text-slate-400">逐轮落库，不等会话结束 —— 客户关掉标签页也看得到</p>
          </div>
          <div className="divide-y divide-slate-100">
            {sessions.length === 0 && <p className="px-4 py-6 text-center text-xs text-slate-400">近 14 天没有会话</p>}
            {sessions.map(s => {
              const unchecked = parseInt(s.unchecked || '0')
              const slow = (s.worst_first_audio_ms ?? 0) > SLOW_MS
              return (
                <div key={s.session_id}>
                  <button onClick={() => openS(s.session_id)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50">
                    <span className="w-24 shrink-0 text-xs text-slate-500">{fmtTime(s.started_at)}</span>
                    <span className="w-12 shrink-0 text-xs text-slate-600">{s.turns} 轮</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{s.first_question || <span className="text-slate-400">（无转写）</span>}</span>
                    {unchecked > 0 && <span className="shrink-0 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700">{unchecked} 轮没查</span>}
                    {slow && <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">最慢 {fmtMs(s.worst_first_audio_ms)}</span>}
                  </button>

                  {openSession === s.session_id && (
                    <div className="space-y-2 bg-slate-50 px-4 py-3">
                      {turns.length === 0 && <p className="text-xs text-slate-400">载入中…</p>}
                      {turns.map(t => (
                        <div key={t.id} className={`rounded border p-2.5 ${
                          t.source === 'live' && t.asked_brain === false ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white'}`}>
                          <div className="flex flex-wrap items-center gap-2 text-[11px]">
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">{t.source === 'live' ? 'Luna 开口' : 'Brain'}</span>
                            {t.source === 'live' && t.asked_brain === false &&
                              <span className="rounded bg-red-100 px-1.5 py-0.5 font-medium text-red-700">🔴 没查就说（绕过护栏）</span>}
                            {t.intended_tool && <span className="text-slate-500">想调 {t.intended_tool}</span>}
                            {t.degraded && <span className="rounded bg-orange-100 px-1.5 py-0.5 text-orange-700">降级</span>}
                            {t.clarifying && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700">纯澄清</span>}
                            {t.out_of_scope && <span className="rounded bg-blue-100 px-1.5 py-0.5 text-blue-700">越界 {t.out_of_scope}</span>}
                            <span className="ml-auto text-slate-400">{fmtTime(t.created_at)}</span>
                          </div>
                          {(t.user_said || t.question) && <p className="mt-1.5 text-xs text-slate-600">👤 {t.user_said || t.question}</p>}
                          {t.speech && <p className="mt-1 text-xs text-slate-800">🤖 {t.speech}</p>}
                          <div className="mt-1.5 flex flex-wrap gap-3 text-[10px] text-slate-400">
                            {t.tools?.length ? <span>🔧 {t.tools.join(', ')}</span> : null}
                            {/* 延迟瀑布 —— 「客户说话到 AI 回话隔了多久」 */}
                            {t.user_speech_ms != null && <span>说了 {fmtMs(t.user_speech_ms)}</span>}
                            {t.to_first_audio_ms != null && (
                              <span className={t.to_first_audio_ms > SLOW_MS ? 'font-medium text-red-500' : ''}>
                                → 出声 {fmtMs(t.to_first_audio_ms)}
                              </span>
                            )}
                            {t.total_ms != null && <span>→ 说完 {fmtMs(t.total_ms)}</span>}
                            {t.source === 'brain' && t.ms != null && <span>Brain {fmtMs(t.ms)}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      </div>
    </div>
  )
}
