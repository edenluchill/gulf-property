/**
 * Luna Collaborative Tour — markup toolbar (pen / arrow / text / pin / circle +
 * eraser / undo / clear).
 *
 * A pencil FAB on the RIGHT edge (keeps the map centre clear). Tap it to open a
 * vertical palette; it STAYS open while you mark the map (it's a separate overlay
 * — marking never closes it) until you tap ✕. Switch to the hand tool to pan.
 * Colours show for pen/arrow/text/circle; an icon picker shows for pins. The
 * inline text input appears at the tapped point when the text tool places a label.
 * Pure presentational; the geo-anchored marks live in useCollabDraw.
 */
import { useEffect, useRef, useState } from 'react'
import { Pencil, Eraser, Hand, Trash2, X, ArrowUpRight, Type, MapPin, Circle, Undo2, Check } from 'lucide-react'
import type { CollabDrawApi, DrawTool } from './useCollabDraw'
import { DRAW_COLORS, PIN_ICONS } from './useCollabDraw'

const ACCENT = '#00E0B8'

export default function CollabDrawToolbar({ draw }: { draw: CollabDrawApi }) {
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => { setOpen(true); draw.setTool('pen') }}
        className="fixed end-3 top-1/2 z-[2150] flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-slate-900/85 text-white shadow-xl ring-1 ring-white/15 backdrop-blur transition hover:bg-slate-900"
        title="画笔 / 标记"
        aria-label="画笔"
      >
        <Pencil className="h-5 w-5" style={{ color: ACCENT }} />
      </button>
    )
  }

  const ToolBtn = ({ t, icon, label }: { t: DrawTool; icon: React.ReactNode; label: string }) => (
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

  const showColors = draw.tool === 'pen' || draw.tool === 'arrow' || draw.tool === 'text' || draw.tool === 'circle'
  const showIcons = draw.tool === 'pin'

  return (
    <>
      <div className="fixed end-3 top-1/2 z-[2150] flex -translate-y-1/2 flex-col items-center gap-1 rounded-2xl bg-slate-900/90 p-1.5 shadow-2xl ring-1 ring-white/10 backdrop-blur">
        <ToolBtn t="none" icon={<Hand className="h-4 w-4" />} label="移动地图" />
        <ToolBtn t="pen" icon={<Pencil className="h-4 w-4" />} label="画笔" />
        <ToolBtn t="arrow" icon={<ArrowUpRight className="h-4 w-4" />} label="箭头" />
        <ToolBtn t="text" icon={<Type className="h-4 w-4" />} label="文字标签" />
        <ToolBtn t="pin" icon={<MapPin className="h-4 w-4" />} label="图钉标记" />
        <ToolBtn t="circle" icon={<Circle className="h-4 w-4" />} label="圈选(出区域数据)" />
        <ToolBtn t="eraser" icon={<Eraser className="h-4 w-4" />} label="橡皮擦" />

        {(showColors || showIcons) && <div className="my-0.5 h-px w-6 bg-white/10" />}

        {showColors && (
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
        )}

        {showIcons && (
          <div className="grid grid-cols-2 gap-0.5">
            {PIN_ICONS.map((ic) => (
              <button
                key={ic}
                type="button"
                onClick={() => draw.setPinIcon(ic)}
                aria-label={`图钉 ${ic}`}
                className={`flex h-6 w-6 items-center justify-center rounded-lg text-base transition ${
                  draw.pinIcon === ic ? 'bg-white/20 ring-1 ring-white/60' : 'hover:bg-white/10'
                }`}
              >
                {ic}
              </button>
            ))}
          </div>
        )}

        <div className="my-0.5 h-px w-6 bg-white/10" />
        <button
          type="button"
          onClick={draw.undo}
          disabled={!draw.canUndo}
          title="撤销上一步"
          aria-label="撤销"
          className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-200 transition hover:bg-white/10 disabled:opacity-40"
        >
          <Undo2 className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={draw.clearAll}
          disabled={!draw.hasMarks}
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

      {draw.pendingText && (
        <TextInputOverlay
          x={draw.pendingText.x}
          y={draw.pendingText.y}
          onCommit={draw.commitText}
          onCancel={draw.cancelText}
        />
      )}
    </>
  )
}

function TextInputOverlay({ x, y, onCommit, onCancel }: { x: number; y: number; onCommit: (t: string) => void; onCancel: () => void }) {
  const [val, setVal] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  // Focus after mount settles (a mousedown-driven open can otherwise blur us on the
  // trailing mouseup). No blur-to-commit — map/canvas focus churn used to unmount
  // the input the instant it appeared; commit is explicit via ✓ / Enter.
  useEffect(() => { const id = setTimeout(() => ref.current?.focus(), 30); return () => clearTimeout(id) }, [])
  return (
    <div
      className="fixed z-[2200] flex items-center gap-1"
      style={{ left: Math.min(x, window.innerWidth - 260), top: y }}
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
    >
      <input
        ref={ref}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onCommit(val)
          else if (e.key === 'Escape') onCancel()
        }}
        placeholder="输入标注文字…"
        maxLength={40}
        className="w-52 rounded-lg border border-teal-400 bg-white/95 px-2.5 py-1.5 text-sm text-slate-900 shadow-xl outline-none backdrop-blur placeholder:text-slate-400"
      />
      <button
        type="button"
        onClick={() => onCommit(val)}
        aria-label="确定"
        className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-500 text-white shadow-lg transition hover:bg-teal-600"
      >
        <Check className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onCancel}
        aria-label="取消"
        className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/90 text-slate-500 shadow-lg transition hover:bg-white"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
