/**
 * 🔴 **禁止「整页」被手指捏放大 —— 但只在应用型页面。**
 *
 * 现象(2026-07-14 经纪转述客户,截图):手机上打开地图,整个页面被等比放大并偏移 ——
 * 左侧工具栏被切掉、右上指标卡溢出、底部 nav 的「登录」被裁掉一半。经纪以为是
 * "不能自适应屏幕大小",其实**布局是对的**:是浏览器级的 pinch-zoom(visual viewport
 * 缩放)。客户两根手指在地图/底部 nav 上一捏,整页就放大了,而且**再也回不去**
 * (缩不回精确的 1.0,于是从此每次看都是歪的)。
 *
 * 这个 app 的外壳是 h-screen + overflow-hidden 的**应用**(不是文档):
 * 整页缩放在这里**永远是 bug,从来不是 feature** —— 地图自己有双指缩放,
 * 底部 nav / 工具卡被放大只会被裁掉。
 *
 * ⚠️ 但**文档型页面例外**(报价单 /pp/、报告 /r/ /cr/、事实清单 /factsheet/):
 *    那些是给客户看细节的 A4 文档,**必须让他能放大**。所以按路由分流,不能一刀切。
 *
 * ⚠️ 两个平台要两套手段,缺一不可:
 *    • 安卓(含微信 X5)—— 认 meta viewport 的 `user-scalable=no`
 *    • iOS(微信是 WKWebView)—— **忽略** user-scalable=no(苹果为可访问性硬性无视),
 *      只能 preventDefault 掉 WebKit 私有的 `gesture*` 事件。
 *
 * ⚠️ 这**不会**影响地图自己的双指缩放:地图库(MapLibre/Leaflet)用的是 touch events,
 *    而 gesture events 是 WebKit 私有的、与 touch events **并行**触发。拦掉 gesture
 *    只挡住"浏览器缩放整页",地图照常收到 touchmove。
 */

/** 文档型页面 —— 客户要放大看细节,**放行**。 */
const DOC_ROUTES = /^\/(pp|r|cr|factsheet|verify)\//

const APP_VIEWPORT = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no'
const DOC_VIEWPORT = 'width=device-width, initial-scale=1.0'

const blockGesture = (e: Event) => e.preventDefault()

let installed = false

/**
 * 按路径决定这一页允不允许整页缩放。在 App 里随 location 变化调用。
 */
export function applyPinchZoomPolicy(pathname: string) {
  const isDoc = DOC_ROUTES.test(pathname)

  const meta = document.querySelector('meta[name="viewport"]')
  if (meta) {
    const want = isDoc ? DOC_VIEWPORT : APP_VIEWPORT
    // 只在真的变了的时候写 —— 每次都写会让部分 WebView 重新布局
    if (meta.getAttribute('content') !== want) meta.setAttribute('content', want)
  }

  // iOS/WKWebView:meta 不管用,只能拦 gesture 事件
  if (isDoc) {
    if (installed) {
      document.removeEventListener('gesturestart', blockGesture)
      document.removeEventListener('gesturechange', blockGesture)
      document.removeEventListener('gestureend', blockGesture)
      installed = false
    }
  } else if (!installed) {
    // passive: false —— 不写这个 preventDefault() 会被浏览器忽略
    document.addEventListener('gesturestart', blockGesture, { passive: false })
    document.addEventListener('gesturechange', blockGesture, { passive: false })
    document.addEventListener('gestureend', blockGesture, { passive: false })
    installed = true
  }
}
