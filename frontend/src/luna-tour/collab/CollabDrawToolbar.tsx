/**
 * Luna Collaborative Tour — drawing toolbar (pen / eraser / colors).
 *
 * A pencil FAB on the LEFT edge (keeps the map centre clear). Tap it to open a
 * vertical palette; it STAYS open while you draw on the map (it's a separate
 * overlay — drawing never closes it) until you tap ✕. Switch to the hand tool to
 * pan again. Pure presentational; the geo-anchored strokes live in useCollabDraw.
 */
import { useState } from 'react'
import { Pencil, Eraser, Hand, Trash2, X, Palette } from 'lucide-react'
import type { CollabDrawApi } from './useCollabDraw'
import { DRAW_COLORS } from './useCollabDraw'

const ACCENT = '#00E0B8'

export default function CollabDrawToolbar({ draw }: { draw: CollabDrawApi }) {
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => { setOpen(true); draw.setTool('pen') }}
        className="fixed left-3 top-1/2 z-[2150] flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-slate-900/85 text-white shadow-xl ring-1 ring-white/15 backdrop-blur transition hover:bg-slate-900"
        title="画笔 / 标记"
        aria-label="画笔"
      >
        <Pencil className="h-5 w-5" style={{ color: ACCENT }} />
      </button>
    )
  }

  const ToolBtn = ({ t, icon, label }: { t: 'none' | 'pen' | 'eraser'; icon: React.ReactNode; label: string }) => (
    <button
      type="button"
      onClick={() => draw.setTool(t)}
      title={label}
      aria-label={label}
      className="flex h-9 w-9 items-center justify-center rounded-xl transition"
      style={draw.tool === t ? { background: ACCENT, color: '#04211c' } : { color: '#e2e8f0' }}
    >
      {icon}
    </button>
  )

  return (
    <div className="fixed left-3 top-1/2 z-[2150] flex -translate-y-1/2 flex-col items-center gap-1.5 rounded-2xl bg-slate-900/90 p-1.5 shadow-2xl ring-1 ring-white/10 backdrop-blur">
      <ToolBtn t="none" icon={<Hand className="h-4 w-4" />} label="移动地图" />
      <ToolBtn t="pen" icon={<Pencil className="h-4 w-4" />} label="画笔" />
      <ToolBtn t="eraser" icon={<Eraser className="h-4 w-4" />} label="橡皮擦" />

      {/* colors — only meaningful with the pen */}
      <div className="my-0.5 h-px w-6 bg-white/10" />
      {draw.tool === 'pen' ? (
        <div className="flex flex-col items-center gap-1">
          {DRAW_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => draw.setColor(c)}
              aria-label={`颜色 ${c}`}
              className={`h-5 w-5 rounded-full transition ${
                draw.color === c ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-900' : 'ring-1 ring-white/20'
              }`}
              style={{ background: c }}
            />
          ))}
        </div>
      ) : (
        <Palette className="h-4 w-4 text-slate-500" />
      )}

      <div className="my-0.5 h-px w-6 bg-white/10" />
      <button
        type="button"
        onClick={draw.clearAll}
        disabled={!draw.hasStrokes}
        title="清除全部"
        aria-label="清除全部"
        className="flex h-9 w-9 items-center justify-center rounded-xl text-rose-300 transition hover:bg-white/10 disabled:opacity-40"
      >
        <Trash2 className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => { draw.setTool('none'); setOpen(false) }}
        title="关闭"
        aria-label="关闭画笔"
        className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-300 transition hover:bg-white/10"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
