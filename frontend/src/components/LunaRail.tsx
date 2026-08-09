/**
 * 右边缘那一竖列(Luna 能量条 / Luna 药丸 / 打字)的**挂载点**。
 *
 * 为什么要有这个:那一列是 VoiceAssistantButton 里一个
 * `fixed … end-0 flex flex-col items-end` 的容器。别的东西想跟它排在一起时,
 * 只有两条路 ——
 *   ① 自己再摆一个 fixed,手动算 bottom 去对齐它  → 它一改高度就错位;
 *   ② portal 进那一列,让 flex 自己排。
 * 选 ②。这和 BottomDock 是同一个道理:**右边缘只有一列,别各摆各的**。
 *
 * owner 2026-08-09:「你放左边是什么意思 放上面统一啊大哥」——
 * 之前「找经纪」走的是底部坞的 cta 槽位,而坞会为 Luna 让出右边一截,
 * 结果那颗卡片正好杵在 Luna **左边**,两个悬浮件各行其是。
 *
 * ⚠️ Luna 不是每页都渲染(chromeless / admin / 经纪台都没有),它被隐藏时
 *    整个 rail 也不存在。所以 RailItem 拿不到宿主时**要有兜底**,
 *    别让入口凭空消失 —— 见 FindAgentDock 里的 fallback。
 */
import { useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'

export const LUNA_RAIL_ID = 'app-luna-rail'

/** 数字越小越靠上(flex order)。Luna 自己那几个是默认 0。 */
export const RAIL_ORDER = {
  /** 「找经纪帮我」—— 排在 Luna 上面 */
  agentMatch: -10,
} as const

export function useLunaRailHost(): HTMLElement | null {
  const [host, setHost] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => {
    // Luna 是懒挂的,首帧可能还没有 → 轮询几次再放弃(比一次拿不到就永远没有好)
    let tries = 0
    const tick = () => {
      const el = document.getElementById(LUNA_RAIL_ID)
      if (el) { setHost(el); return }
      if (tries++ < 20) setTimeout(tick, 150)
    }
    tick()
  }, [])
  return host
}

export function LunaRailItem({ order, children }: { order: number; children: React.ReactNode }) {
  const host = useLunaRailHost()
  if (!host) return null
  return createPortal(<div style={{ order }} className="pointer-events-auto">{children}</div>, host)
}
