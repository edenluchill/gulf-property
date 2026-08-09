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
import { useTranslation } from 'react-i18next'
import { DockItem, DOCK_ORDER } from '../BottomDock'
import { LunaRailItem, RAIL_ORDER, useLunaRailHost } from '../LunaRail'
import { AgentAvatar } from './FindAgentCard'
import AgentMatchModal from './AgentMatchModal'
import { peekNextAgent, type MatchedAgent } from '../../lib/agentMatchApi'

export default function FindAgentDock({ hidden }: { hidden?: boolean }) {
  const { t } = useTranslation('misc')
  const [open, setOpen] = useState(false)
  /** 值班中的那位。**只读 peek,不落库** —— 每个打开地图的人都会触发一次,
   *  用会写库的接口做这件事会把轮换名额全消耗在没想找经纪的人身上。 */
  const [onDuty, setOnDuty] = useState<(MatchedAgent & { id: string }) | null>(null)
  /**
   * 优先挂进 Luna 那一竖列(和它排成一列,排在它上面)。
   * 那一列只有 Luna 渲染时才存在 —— 拿不到就退回底部坞,**不能让入口凭空消失**。
   */
  const rail = useLunaRailHost()

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

  const pill = (
    <button type="button" onClick={() => setOpen(true)}
      className="group flex items-center gap-2.5 rounded-full bg-white/95 py-1.5 pe-4 ps-1.5 shadow-xl ring-1 ring-black/5 backdrop-blur transition hover:bg-white active:scale-95">
      <span className="relative shrink-0">
        <AgentAvatar agent={onDuty} size={9} />
        <span className="absolute -end-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white" />
      </span>
      <span className="min-w-0 text-start">
        <span className="block truncate text-[13px] font-semibold leading-tight text-slate-900">
          {onDuty.display_name}
        </span>
        <span className="block truncate text-[11px] leading-tight text-emerald-600">{t('agentMatch.askHim')}</span>
      </span>
    </button>
  )

  return (
    <>
      {/* 卫星底图上是彩色噪声,一颗纯色药丸糊在里面很难看(owner:「太丑了」)。
          白底卡片压得住底图,也一眼看出对面是个人不是个功能。
          🔴 位置**跟 Luna 排成一列**(portal 进 LunaRail,order 让它在上面)。
          之前走底部坞的 cta 槽位 —— 而坞会为 Luna 让出右边一截,于是这颗卡片
          正好杵在 Luna 左边,两个悬浮件各歪各的(owner:「你放左边是什么意思
          放上面统一啊大哥」)。 */}
      {rail
        ? <LunaRailItem order={RAIL_ORDER.agentMatch}>{pill}</LunaRailItem>
        : <DockItem order={DOCK_ORDER.cta} className="w-max max-w-[92vw] self-end">{pill}</DockItem>}

      <AgentMatchModal open={open} onClose={() => setOpen(false)} source="map" />
    </>
  )
}
