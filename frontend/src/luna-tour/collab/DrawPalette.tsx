/**
 * 画笔调色板 —— 底部横向工具条。触发按钮(铅笔)在地图右上那张工具卡里,点开这条 →
 * 选笔/箭头/文字/图钉/圈 + 颜色 + 撤销/清空。收起(hand 或 ✕)→ 条消失、地图恢复平移。
 *
 * 🔴 **落位交给底部坞(BottomDock)**,这里不写 fixed/bottom:以前写死 `bottom-24`,
 * 而带看底栏写 5rem、分享链接写 bottom-32 —— 一开带看就三条互相压。
 *
 * 🔴 **默认只露一颗当前色**(2026-07-27,owner:「颜色有必要一次显示这么多么」)。
 * 5 个色块常驻,在 367px 的手机上占掉整条的 1/3,而一次带看里换色是**低频**动作 ——
 * 高频的是选工具。点一下色点才摊开 5 色,选完自动收回。
 *
 * 🔴 **橡皮擦已下架**(同上,「有些是不是多余的」)。触屏上要精准点中一笔本来就难,
 * 而「撤销」覆盖了绝大多数场景(刚画错的那一笔),「清空」覆盖剩下的。留着它等于
 * 用一颗常驻按钮换一个几乎点不准的功能。引擎里的 'eraser' 工具仍在,想恢复只要
 * 把这颗按钮加回来。
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Hand, Trash2, X, ArrowUpRight, Type, MapPin, Circle, Undo2, Pencil } from 'lucide-react'
import type { CollabDrawApi, DrawTool } from './useCollabDraw'
import { DRAW_COLORS, PIN_ICONS } from './useCollabDraw'
import { DockItem, DOCK_ORDER } from '../../components/BottomDock'

const ACCENT = '#00E0B8'

export default function DrawPalette({ draw }: { draw: CollabDrawApi }) {
  const { t: tRaw } = useTranslation('lunaTour')
  const t = tRaw as (k: string, o?: Record<string, unknown>) => string
  const [colorsOpen, setColorsOpen] = useState(false)

  const ToolBtn = ({ tool, icon, label }: { tool: DrawTool; icon: React.ReactNode; label: string }) => (
    <button
      type="button"
      onClick={() => draw.setTool(tool)}
      title={label}
      aria-label={label}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition sm:h-8 sm:w-8"
      style={draw.tool === tool ? { background: ACCENT, color: '#04211c' } : { color: '#e2e8f0' }}
    >
      {icon}
    </button>
  )

  const showColors = draw.tool === 'pen' || draw.tool === 'arrow' || draw.tool === 'text' || draw.tool === 'circle'
  const showIcons = draw.tool === 'pin'

  return (
    <DockItem
      order={DOCK_ORDER.tools}
      // 窄屏**换行**,不横向滚:367px 的手机上这条可能装不下,而 overflow-x-auto 会把
      // 尾巴上的按钮裁到屏幕外 —— 滚动条还被藏了,等于一颗永远点不到的按钮。
      className="flex max-w-full flex-wrap items-center justify-center gap-0.5 rounded-2xl bg-slate-900/90 px-1.5 py-1.5 shadow-2xl ring-1 ring-white/10 backdrop-blur sm:flex-nowrap sm:gap-1 sm:px-2"
    >
      <ToolBtn tool="none" icon={<Hand className="h-4 w-4" />} label={t('draw.tool.pan')} />
      <ToolBtn tool="pen" icon={<Pencil className="h-4 w-4" />} label={t('draw.tool.pen')} />
      <ToolBtn tool="arrow" icon={<ArrowUpRight className="h-4 w-4" />} label={t('draw.tool.arrow')} />
      <ToolBtn tool="text" icon={<Type className="h-4 w-4" />} label={t('draw.tool.text')} />
      <ToolBtn tool="pin" icon={<MapPin className="h-4 w-4" />} label={t('draw.tool.pin')} />
      <ToolBtn tool="circle" icon={<Circle className="h-4 w-4" />} label={t('draw.tool.circle')} />

      {(showColors || showIcons) && <div className="mx-0.5 h-6 w-px shrink-0 bg-white/10" />}

      {/* 颜色:默认一颗当前色,点开才摊开 5 色,选完自动收回 */}
      {showColors && (colorsOpen ? (
        DRAW_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => { draw.setColor(c); setColorsOpen(false) }}
            aria-label={t('draw.color', { color: c })}
            className={`h-5 w-5 shrink-0 rounded-full transition ${
              draw.color === c ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-900' : 'ring-1 ring-white/20'
            }`}
            style={{ background: c }}
          />
        ))
      ) : (
        <button
          type="button"
          onClick={() => setColorsOpen(true)}
          aria-label={t('draw.color', { color: draw.color })}
          title={t('draw.color', { color: draw.color })}
          className="h-5 w-5 shrink-0 rounded-full ring-2 ring-white/70 transition active:scale-90"
          style={{ background: draw.color }}
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
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-200 transition hover:bg-white/10 disabled:opacity-40 sm:h-8 sm:w-8"
      >
        <Undo2 className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={draw.clearAll}
        disabled={!draw.hasMarks}
        title={t('draw.clearAll')}
        aria-label={t('draw.clearAll')}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-rose-300 transition hover:bg-white/10 disabled:opacity-40 sm:h-8 sm:w-8"
      >
        <Trash2 className="h-4 w-4" />
      </button>
      {/* 收起 ✕ —— 手机上藏起来:窄屏这条本来就紧,而右上工具卡那颗铅笔本身就是
          「画笔/退出」的开关,收起走它。 */}
      <button
        type="button"
        onClick={() => draw.setTool('none')}
        title={t('draw.close')}
        aria-label={t('draw.closeToolbar')}
        className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-300 transition hover:bg-white/10 sm:flex sm:h-8 sm:w-8"
      >
        <X className="h-4 w-4" />
      </button>
    </DockItem>
  )
}
