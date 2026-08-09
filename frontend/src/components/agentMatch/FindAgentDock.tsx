/**
 * 地图上的「找经纪帮我」入口 —— 贴底的一颗药丸,点开弹出匹配卡片。
 *
 * 为什么在地图上要单独做一个:入口原本只在**区域弹窗内部**,而那要先点开一个区域
 * 才看得到。owner 2026-08-09 截图:「地图上看不到任何入口」—— 他是对的。
 *
 * 🔴 **必须走 BottomDock,不能自己写 fixed bottom-***(仓库铁律,见 BottomDock.tsx)。
 *    自己写的贴底浮条会和测距条/画笔调色板/带看底栏互相压,而且手机浏览器地址栏
 *    一收一放就会被裁掉。DOCK_ORDER.cta 这个槽位的注释本来写的就是
 *    「买家的『和经纪通话』大入口」—— 正是这个东西。
 *
 * 带看(collab)期间不渲染:那个槽位归 CollabBar,而且带看时客户身边已经有经纪了。
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { UserRound, X } from 'lucide-react'
import { DockItem, DOCK_ORDER } from '../BottomDock'
import FindAgentCard from './FindAgentCard'

export default function FindAgentDock({ hidden }: { hidden?: boolean }) {
  const { t } = useTranslation('misc')
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [open])

  if (hidden) return null

  return (
    <>
      <DockItem order={DOCK_ORDER.cta} className="w-max max-w-full">
        <button type="button" onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-teal-500 to-emerald-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-600/25 transition hover:opacity-95 active:scale-95">
          <UserRound className="h-4 w-4" />
          {t('agentMatch.cta')}
        </button>
      </DockItem>

      {/* 铁律:transform/backdrop-filter 里的 fixed modal 必须 portal 到 body */}
      {open && createPortal(
        <div className="fixed inset-0 z-[9000] flex items-end justify-center bg-slate-950/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
          onClick={() => setOpen(false)}>
          <div onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-t-3xl bg-white p-4 shadow-2xl sm:rounded-3xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">{t('agentMatch.cta')}</h3>
              <button type="button" onClick={() => setOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
                <X className="h-4 w-4" />
              </button>
            </div>
            {/* autoStart:用户点药丸那一下就是「我要找经纪」,不该再让他点第二次。
                这不违反「点了才派单」—— 这个组件只有点开弹窗才会挂载。 */}
            <FindAgentCard source="map" autoStart compact />
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
