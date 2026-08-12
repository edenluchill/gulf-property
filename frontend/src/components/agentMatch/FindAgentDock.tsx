/**
 * 地图右边缘的「找真人帮忙」入口 —— 和 Luna / 打字 排成一列。
 *
 * 🔴 **按钮上不显示是谁**(owner 2026-08-09:「这个点击别显示名字,更像是 Uber,
 *    一开始你不知道谁去联系」)。之前那颗白色横药丸挂着头像和名字,
 *    既和右边这一列的方形玻璃钮格格不入,又提前把人选亮了出来。
 *    现在:图标 + 一行字,规格照抄「打字」那颗(w-[52px] / rounded-s-2xl /
 *    9px 标签 / 玻璃质感),三颗按钮才是一套东西。
 *
 * 🔴 **底色必须跟「打字」的静默态一样是灰玻璃**(owner 2026-08-11:「地图上那个也是」)。
 *    这一列里 **teal 渐变 = 激活态**(打字面板开着时才变青绿),常态就涂成 teal
 *    等于永远显示自己被按下了,跟旁边两颗不是一套。强调只留在图标颜色上。
 *
 * 🔴 **必须走 LunaRail,不能自己写 fixed**(仓库铁律)。自己写会和测距条 /
 *    画笔调色板 / 带看底栏互相压,手机地址栏一收一放还会被裁掉。
 *    Luna 没渲染时兜底回 BottomDock —— 不能让入口凭空消失。
 *
 * 池子空(peek 回 null)时整个不渲染:摆一颗点了说「暂时没有经纪」的按钮,
 * 比没有按钮更伤。
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { UserRoundSearch } from 'lucide-react'
import { DockItem, DOCK_ORDER } from '../BottomDock'
import { LunaRailItem, RAIL_ORDER, useLunaRailHost } from '../LunaRail'
import { peekNextAgent } from '../../lib/agentMatchApi'
import AgentMatchModal from './AgentMatchModal'

export default function FindAgentDock({ hidden }: { hidden?: boolean }) {
  const { t } = useTranslation('misc')
  const [open, setOpen] = useState(false)
  /**
   * 只用来判断**池子里有没有人**,不显示他是谁。
   * peek 是只读的、不落库 —— 每个打开地图的人都会渲染这颗按钮,
   * 用会写库的接口做这件事会把轮换名额全消耗在没想找经纪的人身上。
   */
  const [hasPool, setHasPool] = useState(false)
  const rail = useLunaRailHost()

  useEffect(() => {
    let alive = true
    peekNextAgent().then((a) => { if (alive) setHasPool(!!a) })
    return () => { alive = false }
  }, [])

  if (hidden || !hasPool) return null

  const btn = (
    <button type="button" onClick={() => setOpen(true)}
      data-testid="find-agent"   /* 巡检脚本按它定位 —— 别按中文标签,改名就全瞎 */
      aria-label={t('agentMatch.cta')} title={t('agentMatch.cta')}
      className="flex w-[52px] flex-col items-center gap-0.5 rounded-s-2xl border border-slate-300/50 bg-gradient-to-b from-slate-200/90 to-slate-100/90 px-1.5 py-2 shadow-md backdrop-blur-xl transition-all duration-300 hover:from-slate-200 hover:to-slate-100 hover:shadow-lg">
      <UserRoundSearch className="h-4 w-4 text-teal-600" />
      <span className="text-[9px] font-semibold tracking-wide text-slate-600">{t('agentMatch.dockLabel')}</span>
    </button>
  )

  return (
    <>
      {rail
        ? <LunaRailItem order={RAIL_ORDER.agentMatch}>{btn}</LunaRailItem>
        : <DockItem order={DOCK_ORDER.cta} className="w-max self-end">{btn}</DockItem>}
      <AgentMatchModal open={open} onClose={() => setOpen(false)} source="map" />
    </>
  )
}
