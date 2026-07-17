import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import Header from './Header'
import MobileNav from './MobileNav'
import { FavoritesDrawer } from './favorites'
import { VoiceAssistantButton } from './voice-assistant'
import { useTourMode } from '../luna-tour/TourModeContext'
import MapPage from '../pages/MapPage'
import RoleSelectModal from './RoleSelectModal'
import GlobalQuotaGate from './GlobalQuotaGate'
import { isMapPath } from '../lib/isMapPath'
import { useAppHeaderHidden } from '../hooks/useScrollChrome'

export default function Layout({ children }: { children: React.ReactNode }) {
  // 手机/pad 下滑收起顶部导航(由各页面的滚动容器经 useScrollChrome 驱动)
  const headerHidden = useAppHeaderHidden()
  // Luna Tour: hide all app chrome when a shared tour/demo is playing full-screen.
  const { active: tourMode } = useTourMode()
  // Collab viewer (/t/:code) is the CLIENT's immersive guided view — usually on a
  // phone. Drop the site header + bottom nav so the map fills the screen; the
  // in-session collab UI (frame, bar, drawer) is rendered inside the page.
  const loc = useLocation()
  const path = loc.pathname
  const isCollabViewer = path.startsWith('/t/')
  // Luna 是面向买家/客户的助手 —— admin 后台(任务审核/项目管理/分析)和经纪台
  // (/agent/*:tour 编辑器、选档、CRM…)都用不到,反而挡住操作区,这里统一不渲染。
  // ⚠️ 面向客户的分享页不在 /agent 下(/v/·/t/·?toursession),不受影响。
  const isBackstage = path.startsWith('/admin') || path.startsWith('/agent')

  // Agent-branded shareable report (/r/:code), client report (/cr/:code) and
  // payment-plan quote (/pp/:code) — clean client-facing pages with NO app
  // chrome (no header/nav/Luna), but they must scroll (unlike the full-screen map).
  // ⚠️ 只算 flag,early-return 必须放在下面所有 hooks 之后:站内导航进出 /pp
  // (报价单生成后 navigate 过去)会让同一个 Layout 实例换分支,提前 return 会
  // 跳过 useState/useEffect → "Rendered fewer hooks"(2026-07-07 实锤;以前
  // /pp 只被新标签页打开所以从没触发)。
  const bareSharePage = path.startsWith('/r/') || path.startsWith('/cr/') || path.startsWith('/pp/') || path.startsWith('/verify/')

  // The WebGL map is EXPENSIVE to create/destroy. Instead of mounting it per-route
  // (which re-initialised maplibre on every tab switch — the source of the jank),
  // mount MapPage ONCE here and keep it alive; just toggle its visibility. Switching
  // to /pricing etc. now only hides the map (instant) instead of tearing it down,
  // and switching back shows it exactly as the user left it (pan/zoom preserved).
  const onMap = isMapPath(path, loc.search)
  // 经纪选档页:付费决策页去掉全部导航(一个页面一个决定,页内自带 logo 与软出口)
  const isPlansPage = path.startsWith('/agent/plans')
  const chromeless = tourMode || isCollabViewer || isPlansPage

  // Lazily mount the map the first time a map route is seen, so a user who lands
  // directly on /pricing doesn't pay the map's init cost until they need it.
  const [mapMounted, setMapMounted] = useState(onMap)
  useEffect(() => { if (onMap) setMapMounted(true) }, [onMap])

  if (bareSharePage) {
    // h-screen + overflow-y-auto = a real scroll container (the parent is height-
    // constrained, so min-h-screen alone clips and won't scroll).
    return <div className="h-screen overflow-y-auto bg-slate-50">{children}</div>
  }

  return (
    <div className={`h-screen flex flex-col overflow-hidden ${chromeless ? 'bg-black' : 'bg-white'}`}>
      {/* Header (hidden during full-screen tour / collab viewer)。
          手机/pad 下滑时用 grid-rows 0fr 平滑收起(既滑走也把高度还给内容);
          只有页面滚回顶部才放出来(useScrollChrome 的规则)。 */}
      {!chromeless && (
        <div
          className="shrink-0 grid transition-[grid-template-rows] duration-300 ease-out"
          style={{ gridTemplateRows: headerHidden ? '0fr' : '1fr' }}
        >
          {/* overflow-hidden 只在收起时加:常驻会把 Header 里 absolute 的下拉
              (管理菜单/用户菜单)整个裁掉——桌面端 header 从不收纳却一直被裁。 */}
          <div className={`min-h-0 ${headerHidden ? 'overflow-hidden' : 'overflow-visible'}`}>
            <Header />
          </div>
        </div>
      )}

      {/* Main Content - pb-16 on mobile, pb-20 on tablet for bottom nav (no
          bottom padding when chromeless, so the map fills the screen). */}
      <main className={`flex-1 flex flex-col overflow-hidden ${chromeless ? '' : 'pb-16 md:pb-20 xl:pb-0'}`}>
        {/* Persistent map: mounted once, shown only on map routes, hidden (but
            kept alive) everywhere else. */}
        {mapMounted && (
          <div className={onMap ? 'flex-1 flex flex-col min-h-0' : 'hidden'}>
            <MapPage />
          </div>
        )}
        {/* Every non-map route renders here. */}
        {!onMap && children}
      </main>

      {/* Mobile Bottom Navigation */}
      {!chromeless && <MobileNav />}

      {/* Favorites Drawer - Global, not inside Header */}
      {!chromeless && <FavoritesDrawer />}

      {/* Voice Assistant - Global, works on all pages (但 admin 后台 + 经纪台不显示) */}
      {!chromeless && !isBackstage && <VoiceAssistantButton />}

      {/* 登录后未选过用户类型(买家/经纪)→ 一次性选择;分享页/回调页内部自静音 */}
      {!chromeless && <RoleSelectModal />}

      {/* 非地图页撞上配额 429 → 登录引导(地图页由 MapMeterGuard 处理) */}
      {!chromeless && <GlobalQuotaGate />}

      {/* Footer - Hidden on mobile, visible on desktop */}
      {/* <footer className="hidden md:block bg-slate-900/50 backdrop-blur-sm border-t border-slate-800/50 text-slate-400 py-12">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div>
              <div className="flex items-center space-x-2 mb-4">
                <Building2 className="h-5 w-5 text-slate-400" />
                <span className="text-lg font-semibold text-slate-200">Pinzos</span>
              </div>
              <p className="text-sm text-slate-500 leading-relaxed">
                Your trusted partner for Dubai's finest off-plan properties. 
                Connecting international buyers with premium developments.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-slate-300 mb-4 text-sm tracking-wide uppercase">Quick Links</h3>
              <ul className="space-y-2.5 text-sm">
                <li><Link to="/map" className="text-slate-500 hover:text-slate-300 transition-colors">Map Explore</Link></li>
                <li><Link to="/favorites" className="text-slate-500 hover:text-slate-300 transition-colors">Favorites</Link></li>
                <li><Link to="/developer/upload" className="text-slate-500 hover:text-slate-300 transition-colors">For Developers</Link></li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold text-slate-300 mb-4 text-sm tracking-wide uppercase">Contact</h3>
              <p className="text-sm text-slate-500 leading-relaxed">
                Email: info@pinzos.com<br />
                Phone: +971 4 XXX XXXX
              </p>
            </div>
          </div>
          <div className="border-t border-slate-800/50 mt-10 pt-8 text-center text-xs text-slate-600 tracking-wide">
            © 2026 Pinzos. All rights reserved.
          </div>
        </div>
      </footer> */}
    </div>
  )
}
