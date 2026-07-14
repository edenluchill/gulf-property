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
  window.location.reload()
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
import './i18n'
import './index.css'
import 'leaflet/dist/leaflet.css'

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
