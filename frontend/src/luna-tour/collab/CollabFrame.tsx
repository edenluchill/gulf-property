/**
 * Luna Collaborative Tour — mode frame + presenter share strip (§7.5).
 *
 *   • accent mode-frame border — a pointer-events-none CSS overlay over the MAP
 *     (never enters the maplibre render pipeline), inline.
 *   • presenter share strip — portaled to <body> (fixed), bottom-left.
 *
 * The session controls (status / follow toggle / language / leave / participants
 * / chat / voice) now live in ONE unified bar — see CollabBar. CollabFrame keeps
 * only the things that don't belong there.
 */
import { Check, Link2 } from 'lucide-react'
import { DockItem, DOCK_ORDER } from '../../components/BottomDock'
import type { FollowMode } from './useCollabFollow'

const ACCENT = '#00E0B8'

export interface CollabFrameProps {
  role: 'presenter' | 'viewer'
  /** viewer follow state — drives the border colour (Free = neutral) */
  followMode?: FollowMode
  /** presenter share link to copy; undefined for viewer */
  shareUrl?: string
  onCopyShare?: () => void
  /** true briefly after a successful copy */
  copied?: boolean
}

export default function CollabFrame({ role, followMode, shareUrl, onCopyShare, copied }: CollabFrameProps) {
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

      {/* 经纪的分享链接 —— 挂进底部坞(不再自己算 bottom-32/md:bottom-4,那套坐标
          一开画笔就和调色板、底栏叠在一起)。
          📱 手机上**只留一颗按钮**:那条 URL 经纪根本不会照着念,却整整吃掉一行
          (手机底部本来就只剩三行的位置)。桌面才把完整链接摊开给他看。 */}
      {role === 'presenter' && shareUrl && (
        <DockItem order={DOCK_ORDER.share} className="max-w-full">
          <button
            type="button"
            onClick={onCopyShare}
            className="flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold text-slate-900 shadow-xl transition hover:opacity-90 active:scale-95 sm:hidden"
            style={{ backgroundColor: ACCENT }}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
            {copied ? '已复制' : '复制客户链接'}
          </button>

          <div className="hidden max-w-[420px] items-center gap-2 rounded-2xl bg-slate-900/90 px-3 py-2 shadow-xl ring-1 ring-white/10 backdrop-blur sm:flex">
            <span className="shrink-0 text-xs text-slate-400">分享链接</span>
            <code className="min-w-0 flex-1 truncate rounded-md bg-black/30 px-2 py-1 text-xs text-slate-200">{shareUrl}</code>
            <button
              type="button"
              onClick={onCopyShare}
              className="flex-shrink-0 rounded-md px-2.5 py-1 text-xs font-semibold text-slate-900 transition hover:opacity-90"
              style={{ backgroundColor: ACCENT }}
            >
              {copied ? '已复制' : '复制'}
            </button>
          </div>
        </DockItem>
      )}
    </>
  )
}
