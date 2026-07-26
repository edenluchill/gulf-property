/**
 * 画笔调色板 —— 底部居中的一条横向工具条(和测距状态条同一位置带,永不和右上
 * 工具卡重叠)。触发按钮(铅笔)在地图右上那张工具卡里,点开这条 → 选笔/箭头/文字/
 * 图钉/圈 + 颜色 + 撤销/清空。收起(hand 或 ✕)→ 条消失、地图恢复平移。
 *
 * 和 collab 的 CollabDrawToolbar 共用同一个 useCollabDraw 引擎(geo-anchored marks),
 * 只是换了个不挡地图中心的落位:经纪线下当面演示时,底部条比右缘竖排 FAB 更顺手。
 */
import { useTranslation } from 'react-i18next'
import { Eraser, Hand, Trash2, X, ArrowUpRight, Type, MapPin, Circle, Undo2, Pencil } from 'lucide-react'
import type { CollabDrawApi, DrawTool } from './useCollabDraw'
import { DRAW_COLORS, PIN_ICONS } from './useCollabDraw'

const ACCENT = '#00E0B8'

export default function DrawPalette({ draw }: { draw: CollabDrawApi }) {
  const { t: tRaw } = useTranslation('lunaTour')
  const t = tRaw as (k: string, o?: Record<string, unknown>) => string

  const ToolBtn = ({ tool, icon, label }: { tool: DrawTool; icon: React.ReactNode; label: string }) => (
    <button
      type="button"
      onClick={() => draw.setTool(tool)}
      title={label}
      aria-label={label}
      className="flex h-8 w-8 items-center justify-center rounded-lg transition"
      style={draw.tool === tool ? { background: ACCENT, color: '#04211c' } : { color: '#e2e8f0' }}
    >
      {icon}
    </button>
  )

  const showColors = draw.tool === 'pen' || draw.tool === 'arrow' || draw.tool === 'text' || draw.tool === 'circle'
  const showIcons = draw.tool === 'pin'

  return (
    <div className="pointer-events-auto fixed bottom-24 left-1/2 z-[2150] flex max-w-[94vw] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-2xl bg-slate-900/90 px-2 py-1.5 shadow-2xl ring-1 ring-white/10 backdrop-blur [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <ToolBtn tool="none" icon={<Hand className="h-4 w-4" />} label={t('draw.tool.pan')} />
      <ToolBtn tool="pen" icon={<Pencil className="h-4 w-4" />} label={t('draw.tool.pen')} />
      <ToolBtn tool="arrow" icon={<ArrowUpRight className="h-4 w-4" />} label={t('draw.tool.arrow')} />
      <ToolBtn tool="text" icon={<Type className="h-4 w-4" />} label={t('draw.tool.text')} />
      <ToolBtn tool="pin" icon={<MapPin className="h-4 w-4" />} label={t('draw.tool.pin')} />
      <ToolBtn tool="circle" icon={<Circle className="h-4 w-4" />} label={t('draw.tool.circle')} />
      <ToolBtn tool="eraser" icon={<Eraser className="h-4 w-4" />} label={t('draw.tool.eraser')} />

      {(showColors || showIcons) && <div className="mx-0.5 h-6 w-px shrink-0 bg-white/10" />}

      {showColors && DRAW_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => draw.setColor(c)}
          aria-label={t('draw.color', { color: c })}
          className={`h-5 w-5 shrink-0 rounded-full transition ${
            draw.color === c ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-900' : 'ring-1 ring-white/20'
          }`}
          style={{ background: c }}
        />
      ))}
      {showIcons && PIN_ICONS.map((ic) => (
        <button
          key={ic}
          type="button"
          onClick={() => draw.setPinIcon(ic)}
          aria-label={t('draw.pinIcon', { icon: ic })}
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-base transition ${
            draw.pinIcon === ic ? 'bg-white/20 ring-1 ring-white/60' : 'hover:bg-white/10'
          }`}
        >
          {ic}
        </button>
      ))}

      <div className="mx-0.5 h-6 w-px shrink-0 bg-white/10" />
      <button
        type="button"
        onClick={draw.undo}
        disabled={!draw.canUndo}
        title={t('draw.undoTitle')}
        aria-label={t('draw.undo')}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-200 transition hover:bg-white/10 disabled:opacity-40"
      >
        <Undo2 className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={draw.clearAll}
        disabled={!draw.hasMarks}
        title={t('draw.clearAll')}
        aria-label={t('draw.clearAll')}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-rose-300 transition hover:bg-white/10 disabled:opacity-40"
      >
        <Trash2 className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => draw.setTool('none')}
        title={t('draw.close')}
        aria-label={t('draw.closeToolbar')}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-300 transition hover:bg-white/10"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
