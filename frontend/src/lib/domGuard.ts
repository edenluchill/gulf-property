/**
 * 🔴 **浏览器翻译插件 × React = 客户页面整页崩掉。**
 *
 * 2026-08-10 从 `app_events.render_crash` 里翻出来的实锤:一个真实客户
 * (`1758494342@qq.com`,Edge/150)在 07-22 / 07-27 / 07-30 / 08-03 **崩了四次**,
 * 跨三个不同的前端版本,页面是 `/map` 和首页,报错永远是这两句之一:
 *
 *   Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.
 *   Failed to execute 'insertBefore' on 'Node': The node before which ... is not a child of this node.
 *
 * iOS Safari 上同一个病换个说法叫 `The object can not be found here`
 * (07-13 iPad、07-15 两位 iPhone 用户都撞了)。
 *
 * **机制**:浏览器的翻译功能(Edge 自带 / Chrome 自带 / 各种插件)会把文本节点
 * 摘出去,换成它自己包的 `<font>`。React 手里还攥着原来那个文本节点的引用,
 * 下一次 re-render 想把它从父节点上摘掉 —— 那个节点已经不在原来的父节点下面了,
 * 浏览器抛 NotFoundError,**整棵树炸**,直接弹到 AppErrorBoundary 的"出错了"卡片。
 * 客户看到的就是:好好逛着地图,页面突然变成一张报错卡。
 *
 * **为什么不是"让他们别开翻译"**:我们自己有 5 种语言的 i18n,但客户不知道,
 * 浏览器也不问 —— 中文用户打开英文界面,Edge 直接就翻了。这事我们控制不了。
 *
 * **修法**:把 `removeChild` / `insertBefore` 包一层 —— 节点已经不在这个父节点下面时
 * 不要抛,直接返回。对 React 来说"目标已经不在了"和"我把它摘掉了"结果一样,
 * 树不会炸;翻译功能照常可用。这是 React × 翻译插件的标准解法。
 *
 * 副作用:它顺手把这次拦截**上报一条遥测**(每个会话最多一条),这样下次再有人崩,
 * 我们能直接看到"是不是翻译插件干的" —— 上面那个客户崩了四次,我们查了三周才
 * 猜到原因,就是因为没有这条数据。
 */
import { trackEvent } from './track'

/** 页面是不是正被浏览器翻译着 —— 各家翻译器留下的指纹。 */
function translationFingerprint(): string | null {
  try {
    const html = document.documentElement
    if (html.hasAttribute('_msttexthash') || document.querySelector('[_msttexthash]')) return 'edge'
    if (/translated-(ltr|rtl)/.test(html.className)) return 'google'
    if (document.querySelector('font[_mstmutation], ya-tr-span, font.notranslate')) return 'other'
    return null
  } catch {
    return null
  }
}

let reported = false
function reportOnce(method: 'removeChild' | 'insertBefore') {
  if (reported) return
  reported = true
  try {
    trackEvent('api_error', {
      kind: 'dom_mutation_guard',
      message: `${method} on a node that moved — 多半是浏览器翻译`,
      translator: translationFingerprint() ?? 'unknown',
      lang: document.documentElement.lang || null,
      path: window.location.pathname,
    })
  } catch { /* 上报失败无所谓 —— 拦截本身已经生效了 */ }
}

export function installDomGuard(): void {
  if (typeof Node === 'undefined' || !Node.prototype) return

  const originalRemoveChild = Node.prototype.removeChild
  Node.prototype.removeChild = function <T extends Node>(this: Node, child: T): T {
    if (child.parentNode !== this) {
      reportOnce('removeChild')
      return child // React 想要的结果(节点不在树上了)已经达成,没必要抛
    }
    return originalRemoveChild.call(this, child) as T
  }

  const originalInsertBefore = Node.prototype.insertBefore
  Node.prototype.insertBefore = function <T extends Node>(this: Node, node: T, ref: Node | null): T {
    if (ref && ref.parentNode !== this) {
      reportOnce('insertBefore')
      // 参照节点被翻译器搬走了 —— 退化成 append,位置可能不完美,但不炸。
      return originalInsertBefore.call(this, node, null) as T
    }
    return originalInsertBefore.call(this, node, ref) as T
  }
}
