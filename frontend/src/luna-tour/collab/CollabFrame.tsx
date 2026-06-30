/**
 * Luna Collaborative Tour — mode frame + session bar (§7.5).
 *
 * Two pieces:
 *   • the accent mode-frame border — laid over the MAP only (a pointer-events-none
 *     CSS overlay, never enters the maplibre render pipeline), so it stays inline.
 *   • the session bar (+ presenter share strip) — PORTALED to <body> as a fixed
 *     overlay so it stays visible on EVERY page (the session now survives in-app
 *     navigation; the client can roam project pages etc. and still see "you're in
 *     a tour · back to map · leave").
 *
 * Renders NOTHING for browse mode (the caller doesn't mount it).
 */
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Globe } from 'lucide-react'
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
  /** the user has navigated off the synced map (e.g. a project page) */
  offMap?: boolean
  /** jump back to the synced map */
  onReturnToMap?: () => void
  /** viewer re-follows the presenter (when detached / Free) */
  onReturnToPresenter?: () => void
  /** viewer detaches to explore on their own (when following). Detach is now
   *  EXPLICIT — only this button does it (no more accidental gesture-detach). */
  onDetach?: () => void
}

export default function CollabFrame({
  role,
  peerName,
  followMode,
  shareUrl,
  onCopyShare,
  copied,
  onExit,
  offMap,
  onReturnToMap,
  onReturnToPresenter,
  onDetach,
}: CollabFrameProps) {
  const { i18n } = useTranslation()
  const zh = (i18n.language || 'en').startsWith('zh')
  const toggleLang = () => i18n.changeLanguage(zh ? 'en' : 'zh-CN')
  const neutral = followMode === 'free'
  const ringColor = neutral ? 'rgba(148,163,184,0.6)' : ACCENT
  const glow = neutral
    ? '0 0 0 2px rgba(148,163,184,0.5) inset'
    : `0 0 0 2px ${ACCENT} inset, 0 0 28px 2px ${ACCENT}66 inset`

  return (
    <>
      {/* mode frame — pure CSS overlay over the map, never touches the GL canvas */}
      <div
        className="pointer-events-none absolute inset-0 z-[1004] rounded-sm transition-[box-shadow] duration-500"
        style={{ boxShadow: glow, border: `1px solid ${ringColor}` }}
        aria-hidden
      />

      {createPortal(
        <>
          {/* persistent session bar — fixed, bottom-center, above the project drawer
              (z>2100) so it's reachable everywhere; clears the mobile nav. */}
          <div className="fixed bottom-20 left-1/2 z-[2150] -translate-x-1/2 md:bottom-6">
            <div className="flex items-center gap-1.5 rounded-full bg-slate-900/90 px-3 py-1.5 text-sm text-white shadow-lg ring-1 ring-white/10 backdrop-blur">
              <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: neutral ? '#94a3b8' : ACCENT }} />
              <span className="font-medium">{zh ? '实时带看中' : 'Live tour'}</span>
              {peerName && (
                <span className="hidden text-slate-300 sm:inline">· {zh ? '与' : 'with'} {peerName}</span>
              )}

              {/* follow ↔ detach toggle. Following is the locked default; the
                  client must tap「自己看」to break away (no accidental detach). */}
              {neutral && onReturnToPresenter && (
                <button
                  type="button"
                  onClick={onReturnToPresenter}
                  className="ml-0.5 rounded-full px-2.5 py-0.5 text-xs font-semibold text-slate-900"
                  style={{ backgroundColor: ACCENT }}
                >
                  {zh ? '回到经纪视角' : 'Rejoin'}
                </button>
              )}
              {followMode === 'following' && onDetach && (
                <button
                  type="button"
                  onClick={onDetach}
                  className="ml-0.5 rounded-full px-2.5 py-0.5 text-xs font-medium text-white ring-1 ring-white/25 transition hover:bg-white/10"
                >
                  {zh ? '自己看' : 'Explore'}
                </button>
              )}
              {offMap && onReturnToMap && (
                <button
                  type="button"
                  onClick={onReturnToMap}
                  className="ml-0.5 rounded-full px-2.5 py-0.5 text-xs font-medium text-slate-900"
                  style={{ backgroundColor: ACCENT }}
                >
                  {zh ? '回到地图' : 'Map'}
                </button>
              )}

              {/* language toggle — always reachable so the client can read in their
                  language no matter which panel they're in (auto-detected at first
                  load from the browser, this lets them override). */}
              <button
                type="button"
                onClick={toggleLang}
                className="ml-0.5 flex items-center gap-1 rounded-full px-2 py-0.5 text-xs text-slate-200 transition hover:bg-white/10"
                title={zh ? '切换语言' : 'Switch language'}
              >
                <Globe className="h-3.5 w-3.5" />
                {zh ? 'EN' : '中'}
              </button>

              <button
                type="button"
                onClick={onExit}
                className="rounded-full px-2 py-0.5 text-xs text-slate-300 transition hover:bg-white/10 hover:text-white"
              >
                {role === 'viewer' ? (zh ? '退出' : 'Leave') : (zh ? '结束' : 'End')}
              </button>
            </div>
          </div>

          {/* presenter share strip — fixed, bottom-left */}
          {role === 'presenter' && shareUrl && (
            <div className="fixed bottom-4 left-3 z-[2150] flex max-w-[min(420px,calc(100vw-1.5rem))] items-center gap-2 rounded-2xl bg-slate-900/90 px-3 py-2 shadow-xl ring-1 ring-white/10 backdrop-blur">
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
        </>,
        document.body,
      )}
    </>
  )
}
