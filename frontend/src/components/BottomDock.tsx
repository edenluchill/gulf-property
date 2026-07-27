/**
 * 底部浮层坞 —— 所有「贴着屏幕底边」的浮条统一挂进这里，由一个 flex 竖列排开。
 *
 * 为什么必须收口:
 *   以前每条都是各写各的 `fixed bottom-XX`（带看底栏 5rem / 画笔调色板 bottom-24 /
 *   分享链接 bottom-32 md:bottom-4 / 测距状态条 bottom-24 …）。只要同时出现两条，
 *   数字就必然对不上 —— 桌面端画笔条压住带看底栏、手机上「分享链接 + 画笔条 + 底栏」
 *   叠成一坨，再被底部导航吃掉一截。**这是坐标各写各的必然结果，不是某一条写错了。**
 *
 * 挂进同一个 flex 列之后：
 *   • 重叠在结构上不可能发生（flex 会一条条排开）
 *   • 谁在上谁在下只由 `DOCK_ORDER` 决定，和挂载顺序无关（portal 顺序不可控）
 *   • 底部导航 / iOS 手势条的让位只在这一个地方算一次
 *
 * 用法：`<DockItem order={DOCK_ORDER.tools}>…</DockItem>`，里面**不要再写 fixed / bottom**。
 */
import { useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useVoiceAssistantContext } from '../contexts/VoiceAssistantContext'

export const DOCK_ID = 'app-bottom-dock'

/** 自下而上的层序：数字越大越靠近屏幕底边。 */
export const DOCK_ORDER = {
  /** 聊天面板（最高，展开时压在所有条之上） */
  chat: 10,
  /** 额度/错误提示条 */
  notice: 20,
  /** 买家的「和经纪通话」大入口 */
  cta: 30,
  /** 经纪的分享链接 */
  share: 40,
  /** 测距 / 路线状态条 */
  status: 50,
  /** 画笔调色板 */
  tools: 60,
  /** 手机端区域搜索**展开后**的那一行（收起时不占行，见 DockBaseRowItem） */
  search: 65,
  /** 带看底栏（主控制条，永远贴最底） */
  bar: 70,
} as const

/**
 * 最底那一行是**共享**的：搜索圆钮靠左、带看底栏居中，两者并排。
 *
 * 为什么不各占一行：搜索钮只有 40px 宽，独占一行等于白白多吃一条（owner 截图里
 * 它孤零零悬在调色板和底栏之间，右边一大片空）。手机底部本来就只剩三行的位置。
 * 并排后它也就真的贴在 app 导航正上方了 —— owner 要的位置。
 *
 * 用绝对定位放搜索钮，而不是 flex 左推：这样**底栏永远是相对屏幕真居中的**，
 * 不会因为左边多了颗按钮就偏心。
 */
export const DOCK_BASE_ROW_ID = 'app-bottom-dock-base-row'

/**
 * 坞本体。Layout 渲染，全站唯一一个。
 *
 * `navOffset` = 页面底部有 app 导航（手机/pad 的 MobileNav，xl 以上没有）。
 * 带看客户端（/t/:code）和全屏 tour 是 chromeless → 直接贴边，只让 safe-area。
 *
 * `lunaMounted` = 这个页面渲染 Luna 药丸（chromeless / admin 后台 / 经纪台都不渲染）。
 *
 * 🔴 **右侧那颗 Luna 药丸不在坞里**（`fixed bottom-[76px] md:bottom-[92px] end-0`），
 * 却和坞的最底一行**同一条带**。坞是整行居中的，手机上一行几乎铺满 → 会钻到它下面。
 * 所以 Luna 在显示时，坞整体让出右边一截；它被藏起来（带看中）时全宽可用。
 * ⚠️ 这条不能靠"目测没撞"，`_shot-livetour-dock.mjs` 里会把 Luna 和搜索钮一起量。
 */
export default function BottomDock({ navOffset, lunaMounted }: { navOffset: boolean; lunaMounted: boolean }) {
  // Luna 自己在 hidden 时 return null（MapPage 开带看时会把它藏掉）
  const { hidden: lunaHidden } = useVoiceAssistantContext()
  const lunaVisible = lunaMounted && !lunaHidden

  return (
    <div
      id={DOCK_ID}
      // pointer-events-none：坞本身横跨整个屏幕底部，绝不能吃掉地图的拖动。
      // 每个 DockItem 自己 pointer-events-auto。
      className={`pointer-events-none fixed inset-x-0 bottom-0 z-[2150] flex flex-col items-center gap-1.5 ${
        // ⚠️ 让位是**所有断点**都要让,别偷懒写「桌面屏够宽撞不上」——
        //    那只对"内容宽度"的行成立,一条满宽的行照样压上去(2026-07-27 实测 xl 叠 36px)。
        //    桌面两侧对称留白，行仍然真居中；手机只让右边(左边给不起,底栏就 246px 宽)。
        lunaVisible ? 'ps-3 pe-[4.25rem] xl:ps-[4.25rem]' : 'px-3'
      } ${
        navOffset
          ? 'pb-[calc(env(safe-area-inset-bottom,0px)+4.5rem)] md:pb-[calc(env(safe-area-inset-bottom,0px)+5.5rem)] xl:pb-[calc(env(safe-area-inset-bottom,0px)+1rem)]'
          : 'pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)]'
      }`}
    >
      {/* 最底一行：搜索钮(绝对靠左) + 带看底栏(真居中)。
          ⚠️ `min-h-10` 不能省:搜索钮是 absolute 的,如果这一行只有它一个孩子,
             行高会塌成 0 → 那颗钮整个挂到坞的内边距外面,压在 app 导航栏上
             (2026-07-27 截图实锤)。min-h 撑住这一行,absolute 的孩子才被容纳。
             只有底栏时 min-h(40) 也只比底栏(36)高 4px,看不出来。
          空的时候(非地图页 + 没带看)`empty:hidden` 让它彻底不占位。 */}
      <div
        id={DOCK_BASE_ROW_ID}
        style={{ order: DOCK_ORDER.bar }}
        className="relative flex min-h-10 w-full items-center justify-center gap-2 empty:hidden empty:min-h-0"
      />
    </div>
  )
}

/**
 * 找到坞节点。DOM 在 layout effect 之前就已经提交，所以一次就能拿到；
 * 拿不到（理论上只有坞没渲染的页面）就什么都不画，绝不退回 body 裸浮 ——
 * 那正是要根除的东西。
 */
function useDockHost(id: string): HTMLElement | null {
  const [host, setHost] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => { setHost(document.getElementById(id)) }, [id])
  return host
}

/**
 * 挂进最底那一行(和带看底栏并排),而不是自己占一行。
 * `anchor='start'` → 绝对贴左，不影响底栏的居中。
 */
export function DockBaseRowItem({
  anchor,
  className = '',
  children,
}: {
  anchor: 'start' | 'center'
  className?: string
  children: React.ReactNode
}) {
  const host = useDockHost(DOCK_BASE_ROW_ID)
  if (!host) return null
  return createPortal(
    <div
      className={`pointer-events-auto ${anchor === 'start' ? 'absolute start-0' : ''} ${className}`}
      children={children}
    />,
    host,
  )
}

export function DockItem({
  order,
  className = '',
  children,
}: {
  order: number
  /** 只写宽度/自身对齐这类，**不要写 fixed / bottom / z**。 */
  className?: string
  children: React.ReactNode
}) {
  const host = useDockHost(DOCK_ID)
  if (!host) return null
  return createPortal(
    <div style={{ order }} className={`pointer-events-auto ${className}`}>
      {children}
    </div>,
    host,
  )
}
