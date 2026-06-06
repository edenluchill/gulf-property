/**
 * Luna Tour — generation progress + tour-structure node diagram.
 *
 * While a tour generates we show a left→right pipeline so it doesn't feel like a
 * dead "生成中…": first the build stages (confirm → real data → AI script), then
 * the REAL tour structure (开场 → each home → 结尾) with the narration-audio
 * backfill lighting up node-by-node. Purely presentational; AgentTours owns the
 * state + polling. Delete with luna-tour/.
 */

const BUILD_STAGES = ['确认楼盘', '拉取真实数据', 'AI 编写分镜脚本']

type NodeState = 'done' | 'active' | 'pending'

function Node({ label, state }: { label: string; state: NodeState }) {
  const ring =
    state === 'done'
      ? 'bg-emerald-500 border-emerald-500 text-white'
      : state === 'active'
      ? 'bg-white border-emerald-500 text-emerald-600 animate-pulse'
      : 'bg-white border-slate-300 text-slate-300'
  return (
    <div className="flex flex-col items-center gap-1.5 shrink-0" style={{ width: 92 }}>
      <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center text-sm font-bold ${ring}`}>
        {state === 'done' ? '✓' : '●'}
      </div>
      <div className={`text-[11px] leading-tight text-center ${state === 'pending' ? 'text-slate-400' : 'text-slate-700'}`}>
        {label}
      </div>
    </div>
  )
}

function Connector({ filled }: { filled: boolean }) {
  return (
    <div className="flex-1 h-0.5 min-w-[16px] mt-4 rounded-full overflow-hidden bg-slate-200">
      <div className={`h-full transition-all duration-500 ${filled ? 'w-full bg-emerald-500' : 'w-0 bg-emerald-500'}`} />
    </div>
  )
}

export default function GenerationProgress({
  phase,
  stage,
  stops,
  audioReady,
  audioTotal,
  shareCode,
  error,
}: {
  phase: 'building' | 'ready' | 'error'
  stage: number // active build-stage index
  stops: string[]
  audioReady: number
  audioTotal: number
  shareCode: string | null
  error?: string
}) {
  const nodes = phase === 'ready' ? stops : BUILD_STAGES
  const watchUrl = shareCode ? `${window.location.origin}/?toursession=${shareCode}` : ''
  const audioDone = phase === 'ready' && audioTotal > 0 && audioReady >= audioTotal

  return (
    <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold text-slate-700">
          {phase === 'error' ? '生成失败' : phase === 'ready' ? '导览结构已生成' : '正在生成导览…'}
        </div>
        {phase === 'building' && <div className="text-xs text-emerald-600">约 10–20 秒</div>}
      </div>

      {phase === 'error' ? (
        <div className="text-sm text-rose-600">❌ {error || '请重试'}</div>
      ) : (
        <>
          {/* left→right node pipeline */}
          <div className="flex items-start overflow-x-auto pb-1">
            {nodes.map((label, i) => {
              const state: NodeState =
                phase === 'ready' ? 'done' : i < stage ? 'done' : i === stage ? 'active' : 'pending'
              return (
                <div key={i} className="flex items-start flex-1 min-w-0">
                  <Node label={label} state={state} />
                  {i < nodes.length - 1 && <Connector filled={phase === 'ready' || i < stage} />}
                </div>
              )
            })}
          </div>

          {phase === 'ready' && (
            <div className="mt-3 border-t border-emerald-100 pt-3">
              <div className="flex items-center gap-2 text-sm">
                <span className={audioDone ? 'text-emerald-600' : 'text-slate-600'}>
                  {audioDone ? '✅ 语音旁白就绪' : `🎙 生成语音旁白… ${audioReady}/${audioTotal}`}
                </span>
                <span className="text-xs text-slate-400">（可立即打开,旁白会自动补齐)</span>
              </div>
              {audioTotal > 0 && (
                <div className="mt-2 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 transition-all duration-700"
                    style={{ width: `${Math.min(100, Math.round((audioReady / audioTotal) * 100))}%` }}
                  />
                </div>
              )}
              {watchUrl && (
                <div className="flex items-center gap-2 mt-3">
                  <a
                    href={watchUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bg-emerald-500 text-white rounded-lg px-3 py-1.5 text-sm font-medium"
                  >
                    打开导览 →
                  </a>
                  <button
                    onClick={() => navigator.clipboard?.writeText(watchUrl)}
                    className="border border-slate-300 text-slate-600 rounded-lg px-3 py-1.5 text-sm"
                  >
                    复制链接
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
