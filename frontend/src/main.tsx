/**
 * 🔴 **部署竞态导致的白屏 —— 必须在这里拦。**
 *
 * 现象(owner 实测):「打开完,再按 browser back,这个页面就坏了」,控制台:
 *   Failed to load module script: Expected a JavaScript-or-Wasm module script but
 *   the server responded with a MIME type of "text/html".
 *
 * 原因:
 *   • index.html 是 `Cache-Control: no-cache`(永远最新),但**已经打开的标签页里
 *     跑的是旧的那一份**,它引用的是**上一次部署的 chunk 名**(带 hash)。
 *   • Cloudflare Pages **只保留最新一次部署的资源** —— 旧 chunk 404 →
 *     SPA fallback 返回 index.html(text/html)→ 浏览器拒绝把 HTML 当模块执行 → **整页白**。
 *   • 所以:**我每部署一次,所有开着页面的人一按 back / 一进懒加载路由就可能白屏。**
 *
 * 修:chunk 加载失败 = 版本过期。**强刷一次**(sessionStorage 上锁,绝不循环刷)。
 */
const RELOAD_KEY = 'pz-stale-chunk-reloaded'
function reloadOnceForStaleChunk(why: string) {
  if (sessionStorage.getItem(RELOAD_KEY)) return   // 已经刷过一次还坏 → 别再刷,让错误暴露出来
  sessionStorage.setItem(RELOAD_KEY, '1')
  console.warn('[pinzos] 检测到过期的构建产物,强刷一次:', why)
  /**
   * 🔴 **必须换 URL,不能裸 reload()。**
   *
   * 同一个病、同一批浏览器,index.html 里的 CSS 兜底早就是这么做的:微信 X5 **无视
   * no-cache**,`location.reload()` 很可能**还是拿那份缓存的旧 HTML** —— 于是刷一次
   * 仍是旧 chunk 名,上面那把锁又不让刷第二次,客户就永远停在白屏上。
   * 这里以前是裸 reload(),等于两条兜底一条带破缓存、一条不带 —— 漏的正是最难自愈的那批人。
   *
   * `_r` 是一次性的,启动成功后下面那个 load 处理器会把它从地址栏擦掉
   * (不擦的话客户复制/分享出去的链接会带着它到处跑)。
   */
  const { pathname, search, hash } = window.location
  window.location.replace(
    pathname + (search ? search + '&' : '?') + '_r=' + Date.now() + hash
  )
}
// Vite 的懒加载预取失败
window.addEventListener('vite:preloadError', (e) => {
  e.preventDefault()
  reloadOnceForStaleChunk('vite:preloadError')
})
// 动态 import 失败 / 模块 MIME 错误
window.addEventListener('error', (e) => {
  const msg = String((e as ErrorEvent).message || '')
  if (/Failed to fetch dynamically imported module|Importing a module script failed|MIME type of "text\/html"/i.test(msg)) {
    reloadOnceForStaleChunk(msg.slice(0, 80))
  }
})
window.addEventListener('unhandledrejection', (e) => {
  const msg = String((e as PromiseRejectionEvent).reason?.message || '')
  if (/Failed to fetch dynamically imported module|Importing a module script failed/i.test(msg)) {
    reloadOnceForStaleChunk(msg.slice(0, 80))
  }
})
// 成功跑起来了 → 清掉锁,下次部署还能再救一次
window.addEventListener('load', () => {
  setTimeout(() => sessionStorage.removeItem(RELOAD_KEY), 5000)
})

/**
 * 样式表过期的兜底在 **index.html 的内联脚本**里(不能放这儿 —— 这个文件本身就在 JS bundle
 * 里,而且 <link> 的 error 早在模块执行前就烧完了)。这里只做善后:
 *   • 清掉它的锁 —— 下次部署还能再救一次
 *   • 把它为了绕开微信 X5 缓存而加的一次性 `_r` 从地址栏擦掉 —— 否则客户复制/分享出去的
 *     链接会带着这个参数到处跑
 */
window.addEventListener('load', () => {
  setTimeout(() => {
    sessionStorage.removeItem('pz-stale-css-reloaded')
    const url = new URL(window.location.href)
    if (url.searchParams.has('_r')) {
      url.searchParams.delete('_r')
      // search 清空后 URL 里不该剩个光秃秃的 '?'
      const clean = url.pathname + (url.searchParams.toString() ? `?${url.searchParams}` : '') + url.hash
      window.history.replaceState(null, '', clean)
    }
  }, 5000)
})

import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import App from './App.tsx'
import AppErrorBoundary from './components/AppErrorBoundary'
import { AuthProvider } from './contexts/AuthContext'
import { FavoritesProvider } from './contexts/FavoritesContext'
import { UserProfileProvider } from './contexts/UserProfileContext'
import { startPagePerf } from './lib/pagePerf'
import { installDomGuard } from './lib/domGuard'
import './i18n'
import './index.css'
import 'leaflet/dist/leaflet.css'

// 浏览器翻译插件搬走文本节点 → React removeChild 抛错 → 整页崩。必须在 render 之前装。
installDomGuard()

// 客户端真实体验上报(首屏 / 瓦片字节)。全站自动覆盖,不用逐页埋点。
startPagePerf()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
    <HelmetProvider>
      <AuthProvider>
        <UserProfileProvider>
          <FavoritesProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </FavoritesProvider>
        </UserProfileProvider>
      </AuthProvider>
    </HelmetProvider>
    </AppErrorBoundary>
  </React.StrictMode>,
)
