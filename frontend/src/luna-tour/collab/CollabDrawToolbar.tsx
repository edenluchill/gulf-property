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
import { useTranslation } from 'react-i18next'
import { Pencil, Eraser, Hand, Trash2, X, ArrowUpRight, Type, MapPin, Circle, Undo2, Check } from 'lucide-react'
import type { CollabDrawApi, DrawTool } from './useCollabDraw'
import { DRAW_COLORS, PIN_ICONS } from './useCollabDraw'

const ACCENT = '#00E0B8'

export default function CollabDrawToolbar({ draw }: { draw: CollabDrawApi }) {
  const [open, setOpen] = useState(false)
  const { t: tRaw } = useTranslation('lunaTour')
  const t = tRaw as (k: string, o?: Record<string, unknown>) => string

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => { setOpen(true); draw.setTool('pen') }}
        className="fixed end-3 top-1/2 z-[2150] flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-slate-900/85 text-white shadow-xl ring-1 ring-white/15 backdrop-blur transition hover:bg-slate-900"
        title={t('draw.openTitle')}
        aria-label={t('draw.tool.pen')}
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
        <ToolBtn t="none" icon={<Hand className="h-4 w-4" />} label={t('draw.tool.pan')} />
        <ToolBtn t="pen" icon={<Pencil className="h-4 w-4" />} label={t('draw.tool.pen')} />
        <ToolBtn t="arrow" icon={<ArrowUpRight className="h-4 w-4" />} label={t('draw.tool.arrow')} />
        <ToolBtn t="text" icon={<Type className="h-4 w-4" />} label={t('draw.tool.text')} />
        <ToolBtn t="pin" icon={<MapPin className="h-4 w-4" />} label={t('draw.tool.pin')} />
        <ToolBtn t="circle" icon={<Circle className="h-4 w-4" />} label={t('draw.tool.circle')} />
        <ToolBtn t="eraser" icon={<Eraser className="h-4 w-4" />} label={t('draw.tool.eraser')} />

        {(showColors || showIcons) && <div className="my-0.5 h-px w-6 bg-white/10" />}

        {showColors && (
          <div className="flex flex-col items-center gap-1">
            {DRAW_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => draw.setColor(c)}
                aria-label={t('draw.color', { color: c })}
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
                aria-label={t('draw.pinIcon', { icon: ic })}
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
          title={t('draw.undoTitle')}
          aria-label={t('draw.undo')}
          className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-200 transition hover:bg-white/10 disabled:opacity-40"
        >
          <Undo2 className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={draw.clearAll}
          disabled={!draw.hasMarks}
          title={t('draw.clearAll')}
          aria-label={t('draw.clearAll')}
          className="flex h-9 w-9 items-center justify-center rounded-xl text-rose-300 transition hover:bg-white/10 disabled:opacity-40"
        >
          <Trash2 className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => { draw.setTool('none'); setOpen(false) }}
          title={t('draw.close')}
          aria-label={t('draw.closeToolbar')}
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

export function TextInputOverlay({ x, y, onCommit, onCancel }: { x: number; y: number; onCommit: (t: string) => void; onCancel: () => void }) {
  const [val, setVal] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  const { t: tRaw } = useTranslation('lunaTour')
  const t = tRaw as (k: string, o?: Record<string, unknown>) => string
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
        placeholder={t('draw.textPlaceholder')}
        maxLength={40}
        className="w-52 rounded-lg border border-teal-400 bg-white/95 px-2.5 py-1.5 text-sm text-slate-900 shadow-xl outline-none backdrop-blur placeholder:text-slate-400"
      />
      <button
        type="button"
        onClick={() => onCommit(val)}
        aria-label={t('draw.confirm')}
        className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-500 text-white shadow-lg transition hover:bg-teal-600"
      >
        <Check className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onCancel}
        aria-label={t('draw.cancel')}
        className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/90 text-slate-500 shadow-lg transition hover:bg-white"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
