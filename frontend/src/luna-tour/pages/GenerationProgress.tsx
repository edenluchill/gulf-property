/**
 * Luna Tour — generation progress + tour-structure node diagram.
 *
 * While a tour generates we show a left→right pipeline so it doesn't feel like a
 * dead "生成中…": first the build stages (confirm → real data → AI script), then
 * the REAL tour structure (开场 → each home → 结尾) with the narration-audio
 * backfill lighting up node-by-node. Purely presentational; AgentTours owns the
 * state + polling. Delete with luna-tour/.
 */
import { useTranslation } from 'react-i18next'

const BUILD_STAGE_KEYS = ['confirmProjects', 'fetchRealData', 'aiWritesScript'] as const

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
  const { t: tRaw } = useTranslation('lunaTour')
  const t = tRaw as (k: string, o?: Record<string, unknown>) => string
  // stops are DATA (real place names in the tour's language) — never translated.
  const nodes = phase === 'ready' ? stops : BUILD_STAGE_KEYS.map((k) => t(`gen.stage.${k}`))
  const watchUrl = shareCode ? `${window.location.origin}/?toursession=${shareCode}` : ''
  const audioDone = phase === 'ready' && audioTotal > 0 && audioReady >= audioTotal

  return (
    <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold text-slate-700">
          {phase === 'error' ? t('gen.failed') : phase === 'ready' ? t('gen.structureReady') : t('gen.building')}
        </div>
        {phase === 'building' && <div className="text-xs text-emerald-600">{t('gen.eta')}</div>}
      </div>

      {phase === 'error' ? (
        <div className="text-sm text-rose-600">❌ {error || t('gen.retry')}</div>
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
                  {audioDone ? `✅ ${t('gen.voiceReady')}` : `🎙 ${t('gen.voiceProgress', { done: audioReady, total: audioTotal })}`}
                </span>
                <span className="text-xs text-slate-400">{t('gen.voiceHint')}</span>
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
                    {t('gen.openTour')}
                  </a>
                  <button
                    onClick={() => navigator.clipboard?.writeText(watchUrl)}
                    className="border border-slate-300 text-slate-600 rounded-lg px-3 py-1.5 text-sm"
                  >
                    {t('gen.copyLink')}
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
