/**
 * Luna Collaborative Tour — mode frame + session bar (§7.5).
 *
 * Wraps the live map in a visual "you are in a session" envelope so browse vs
 * collab is obvious at a glance:
 *   • an accent-colour border + soft glow ring laid over the map container as a
 *     pointer-events-none overlay (CSS only — NEVER enters the maplibre render
 *     pipeline, zero perf cost).
 *   • a persistent top session bar「🟢 实时带看中 · 与 {对方名}」.
 *   • Following → soft accent breathing edge; Free → neutral edge.
 *
 * Renders NOTHING for browse mode (the caller simply doesn't mount it), so the
 * normal map has zero session decoration.
 */
import type { FollowMode } from './useCollabFollow'

const ACCENT = '#00E0B8'

export interface CollabFrameProps {
  /** presenter | viewer — drives copy + which side the "peer" is */
  role: 'presenter' | 'viewer'
  /** the other party's display name (presenter sees the viewer, vice-versa) */
  peerName?: string
  /** viewer follow state; presenter passes undefined (always "live") */
  followMode?: FollowMode
  /** presenter share link to copy; undefined for viewer */
  shareUrl?: string
  onCopyShare?: () => void
  /** true briefly after a successful copy */
  copied?: boolean
  onExit: () => void
}

export default function CollabFrame({
  role,
  peerName,
  followMode,
  shareUrl,
  onCopyShare,
  copied,
  onExit,
}: CollabFrameProps) {
  // Free (viewer self-exploring) → neutral edge; everything else → accent.
  const neutral = followMode === 'free'
  const ringColor = neutral ? 'rgba(148,163,184,0.6)' : ACCENT
  const glow = neutral
    ? '0 0 0 2px rgba(148,163,184,0.5) inset'
    : `0 0 0 2px ${ACCENT} inset, 0 0 28px 2px ${ACCENT}66 inset`

  return (
    <>
      {/* mode frame — pure CSS overlay, never touches the GL canvas */}
      <div
        className="pointer-events-none absolute inset-0 z-[1004] rounded-sm transition-[box-shadow] duration-500"
        style={{ boxShadow: glow, border: `1px solid ${ringColor}` }}
        aria-hidden
      />

      {/* persistent session bar, top-center */}
      <div className="absolute top-3 left-1/2 z-[1005] -translate-x-1/2">
        <div className="flex items-center gap-2 rounded-full bg-slate-900/80 px-3.5 py-1.5 text-sm text-white shadow-lg backdrop-blur">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: neutral ? '#94a3b8' : ACCENT }}
          />
          <span className="font-medium">实时带看中</span>
          {peerName && (
            <>
              <span className="text-slate-400">·</span>
              <span className="text-slate-200">与 {peerName}</span>
            </>
          )}
          <button
            type="button"
            onClick={onExit}
            className="ml-1.5 rounded-full px-2 py-0.5 text-xs text-slate-300 transition hover:bg-white/10 hover:text-white"
          >
            结束
          </button>
        </div>
      </div>

      {/* presenter share strip — bottom-left, out of the CollabBar's way */}
      {role === 'presenter' && shareUrl && (
        <div className="absolute bottom-4 left-3 z-[1005] flex max-w-[min(420px,calc(100vw-1.5rem))] items-center gap-2 rounded-2xl bg-slate-900/85 px-3 py-2 shadow-xl backdrop-blur">
          <span className="hidden text-xs text-slate-400 sm:inline">分享链接</span>
          <code className="min-w-0 flex-1 truncate rounded-md bg-black/30 px-2 py-1 text-xs text-slate-200">
            {shareUrl}
          </code>
          <button
            type="button"
            onClick={onCopyShare}
            className="flex-shrink-0 rounded-md px-2.5 py-1 text-xs font-semibold text-slate-900 transition hover:opacity-90"
            style={{ backgroundColor: ACCENT }}
          >
            {copied ? '已复制' : '复制'}
          </button>
        </div>
      )}
    </>
  )
}
