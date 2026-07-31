/**
 * Google Analytics 4 —— **全站唯一碰 gtag 的地方**。
 *
 * 脚本本体在 index.html(带 `async`,并 `send_page_view: false`),这里只负责
 * 路由切换时手动补一条 page_view。为什么要手动:这是 SPA,自动上报会在
 * `history.pushState` 的瞬间触发,那时 Helmet 还没把 <title> 换掉 ——
 * GA 报表里每一页都会顶着**上一页**的标题,而且这种错没人会发现。
 *
 * 🔴 **分享短链的 code 绝不能进 GA。** `/v/aB3xK9` 里那串就是访问凭证 ——
 * 谁拿到谁就能看这场带看(客户姓名、他家的报价)。
 *
 * 第一道闸在 index.html:初始路径命中分享短链就**根本不加载 gtag.js**。
 * 那是主力防线 —— 这些页面永远是从外部链接整页打开的,不会 SPA 走进来。
 *
 * 这里是第二道:万一真的从站内路由跳进去(gtag 已经在跑了),用 `gtag('set')`
 * 把后续所有事件的默认 page_location 换成打码版本。**只打码 page_view 是不够的**:
 * GA4 的增强测量会自己发 scroll / user_engagement,那些事件带的是浏览器里的真实
 * URL(scripts/_probe-ga-verify.mjs 实测抓到过),必须改默认值才盖得住。
 *
 * ⚠️ 调用一律走 `window.gtag?.()` 的可选链:墙内脚本永远加载不上,`gtag` 不存在。
 * 少个问号就是每次路由切换抛一个错,还会被 errorCapture 收进错误监控当噪音。
 */

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void
    dataLayer?: unknown[]
  }
}

/**
 * 路径第一段命中这些 = 带凭证的分享短链,后面的 code 一律换成 `:code`。
 * ⚠️ 这份名单在三处出现,必须一致:public/robots.txt 的 Disallow、
 * index.html 里那段 GA 守卫的正则、以及这里。
 */
const SHARE_PREFIXES = ['v', 't', 'pp', 'r', 'cr', 'i', 'factsheet', 'verify']

/** `/v/aB3xK9` → `/v/:code`;`/project/<uuid>` 是公开内容,原样保留 */
export function gaPath(pathname: string): string {
  const seg = pathname.split('/').filter(Boolean)
  if (seg.length >= 2 && SHARE_PREFIXES.includes(seg[0])) return `/${seg[0]}/:code`
  return pathname || '/'
}

export function isSharePath(pathname: string): boolean {
  return gaPath(pathname) !== pathname
}

/**
 * 上报一次 page_view。
 *
 * 用 setTimeout(0) 而不是直接发:Helmet 也是在 effect 里写 <title> 的,
 * 而 effect 的执行顺序取决于组件在树里的位置 —— 不能假设我们一定排在它后面。
 * 甩到宏任务里就保证是**这一轮 commit 的所有 effect 都跑完之后**。
 *
 * ⚠️ GA4 认的是 `page_location`(完整 URL),不认 UA 时代的 `page_path` ——
 * 「Page path」那个维度是 GA 从 page_location 里切出来的。所以打码必须打在
 * page_location 上,写 page_path 是白写(实测 dp 根本不落地)。
 */
export function gaPageView(pathname: string): void {
  const masked = gaPath(pathname)
  const location = window.location.origin + masked
  setTimeout(() => {
    // 先改默认值:之后增强测量自己发的 scroll / user_engagement 也会用这个地址,
    // 否则它们照样把真实 URL(含 code)带出去。
    window.gtag?.('set', { page_location: location, page_title: document.title })
    window.gtag?.('event', 'page_view', { page_location: location, page_title: document.title })
  }, 0)
}
