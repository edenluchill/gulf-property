import { useEffect, useState, useSyncExternalStore, type RefObject } from 'react'

/**
 * 滚动收纳 app 顶栏(手机/pad 通用机制,2026-07-03 用户定的体验规则):
 *   · 下滑 → 顶部导航栏 + 页面二级栏(如项目详情的 tab 栏)一起平滑收起,给内容让空间
 *   · 上滑 → 二级栏立即回来(客户随手就能切户型/付款计划)
 *   · 只有滚回到顶,顶部导航栏才重新出现
 *   · 仅 <xl(1280) 生效——桌面空间充足不折腾
 *
 * 为什么要这套机制:app 根是 h-screen overflow-hidden,真正的滚动发生在各页面
 * 内部容器里 → Header 自己监听 window 永远收不到事件(旧实现就是这么死掉的)。
 * 所以由页面调 useScrollChrome(containerRef) 驱动,经模块级 store 广播给 Layout
 * 收放全局 Header;二级栏的显隐由返回值交给页面自己贴到 sticky 栏上。
 *
 * 新页面接入(所有可滚动页面通用):
 *   const { secondaryHidden } = useScrollChrome(scrollRef, ready)
 *   滚动容器: <div ref={scrollRef} className="overflow-auto ...">
 *   二级栏(可选): className={`sticky top-0 transition-transform duration-300
 *     ease-out ${secondaryHidden ? '-translate-y-full' : ''}`}
 */
let headerHidden = false
const subs = new Set<() => void>()
function setHeaderHidden(next: boolean) {
  if (headerHidden === next) return
  headerHidden = next
  subs.forEach((fn) => fn())
}

/** Layout 用:全局顶部导航是否收起 */
export function useAppHeaderHidden(): boolean {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => { subs.delete(cb) } },
    () => headerHidden
  )
}

/** 页面用:把自己的滚动容器接入收纳机制;active=false 时(数据未加载等)不挂监听 */
export function useScrollChrome(ref: RefObject<HTMLElement | null>, active = true) {
  const [secondaryHidden, setSecondaryHidden] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el || !active) return
    if (window.matchMedia('(min-width: 1280px)').matches) return

    let lastY = el.scrollTop
    let ticking = false
    const onScroll = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        ticking = false
        const y = el.scrollTop
        const dy = y - lastY
        if (y <= 4) {
          // 只有到顶,导航栏才回来
          setHeaderHidden(false)
          setSecondaryHidden(false)
          lastY = y
          return
        }
        if (Math.abs(dy) < 6) return // 惯性抖动阈值
        if (dy > 0 && y > 48) {
          // 下滑:双栏一起收
          setHeaderHidden(true)
          setSecondaryHidden(true)
        } else {
          // 上滑:先回二级栏
          setSecondaryHidden(false)
        }
        lastY = y
      })
    }

    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      setHeaderHidden(false) // 离开页面/容器卸载 → 复位
    }
  }, [ref, active])

  return { secondaryHidden }
}
