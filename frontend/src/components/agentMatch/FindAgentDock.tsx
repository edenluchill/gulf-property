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
import { X } from 'lucide-react'
import { DockItem, DOCK_ORDER } from '../BottomDock'
import FindAgentCard, { AgentAvatar } from './FindAgentCard'
import { peekNextAgent, type MatchedAgent } from '../../lib/agentMatchApi'

export default function FindAgentDock({ hidden }: { hidden?: boolean }) {
  const { t } = useTranslation('misc')
  const [open, setOpen] = useState(false)
  /** 值班中的那位。**只读 peek,不落库** —— 每个打开地图的人都会触发一次,
   *  用会写库的接口做这件事会把轮换名额全消耗在没想找经纪的人身上。 */
  const [onDuty, setOnDuty] = useState<(MatchedAgent & { id: string }) | null>(null)

  useEffect(() => {
    let alive = true
    peekNextAgent().then((a) => { if (alive) setOnDuty(a) })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (!open) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [open])

  // 池子空(peek 回 null)就整个不渲染 —— 摆一个点了说「暂时没有经纪」的按钮
  // 比没有按钮更伤。
  if (hidden || !onDuty) return null

  return (
    <>
      {/* 卫星底图上是彩色噪声,一颗纯色药丸糊在里面很难看(owner:「太丑了」)。
          改成白底卡片 + 真人头像:既压得住底图,又一眼看出对面是个人不是个功能。 */}
      <DockItem order={DOCK_ORDER.cta} className="w-max max-w-[92vw]">
        <button type="button" onClick={() => setOpen(true)}
          className="group flex items-center gap-2.5 rounded-full bg-white/95 py-1.5 pe-4 ps-1.5 shadow-xl ring-1 ring-black/5 backdrop-blur transition hover:bg-white active:scale-95">
          <span className="relative shrink-0">
            <AgentAvatar agent={onDuty} size={9} />
            <span className="absolute -end-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white" />
          </span>
          <span className="min-w-0 text-start">
            <span className="block truncate text-[13px] font-semibold leading-tight text-slate-900">
              {onDuty?.display_name}
            </span>
            <span className="block truncate text-[11px] leading-tight text-emerald-600">{t('agentMatch.askHim')}</span>
          </span>
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
