import { useEffect, useState } from 'react'

/**
 * 手机软键盘弹起时,被键盘盖住的那段高度(px);没弹起时是 0。
 *
 * 为什么需要:app 根是 h-screen overflow-hidden,window 从不滚动(见滚动收纳机制),
 * 所以 iOS/Android 弹键盘时浏览器不会帮你把底部的输入框顶上来 —— 贴底的元素
 * (地图底部搜索 dock)会直接被键盘吃掉。visualViewport 是唯一能拿到键盘高度的途径。
 *
 * 阈值 120px:滤掉地址栏收缩/工具条这类小幅 viewport 变化,只在真键盘弹起时才抬。
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const sync = () => {
      const covered = window.innerHeight - vv.height - vv.offsetTop
      setInset(covered > 120 ? Math.round(covered) : 0)
    }
    vv.addEventListener('resize', sync)
    vv.addEventListener('scroll', sync)
    sync()
    return () => {
      vv.removeEventListener('resize', sync)
      vv.removeEventListener('scroll', sync)
    }
  }, [])

  return inset
}
