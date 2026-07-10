import { useEffect, useRef } from 'react'

/**
 * useResetOnBFCache — 从「后退」回到本页时重置一段瞬时状态(通常是 loading/busy)。
 *
 * 为什么需要:点 Stripe Checkout/Portal 按钮 → `window.location.href` 整页跳走后,
 * 用户按浏览器「后退」时,页面从 **bfcache** 恢复 —— 整个 JS 堆(含 React state)
 * 被原样搬回,组件不重挂,`useState(null)` 初始值不再执行 → 之前设的 `busy` 还在,
 * spinner 永远转。mount 兜底无效(bfcache 不重挂),必须监听 `pageshow`。
 *
 * 只认 `pageshow` 且 `persisted=true`(专指从 bfcache 恢复);正常首次加载不触发。
 * 刻意不用 `visibilitychange`:切标签页回来也会触发,若此刻 checkout 请求正在飞行,
 * 会误清 busy → 可重复点击二次下单。后退场景 pageshow 已足够(主流浏览器都支持)。
 *
 * @param reset 从 bfcache 回来时要跑的重置(如 () => setBusy(null))。用 ref 存最新引用,
 *              调用方无需 useCallback。
 */
export function useResetOnBFCache(reset: () => void): void {
  const ref = useRef(reset)
  ref.current = reset
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) ref.current()
    }
    window.addEventListener('pageshow', onPageShow)
    return () => window.removeEventListener('pageshow', onPageShow)
  }, [])
}
