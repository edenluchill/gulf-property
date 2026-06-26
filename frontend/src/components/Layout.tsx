import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import Header from './Header'
import MobileNav from './MobileNav'
import { FavoritesDrawer } from './favorites'
import { VoiceAssistantButton } from './voice-assistant'
import { useTourMode } from '../luna-tour/TourModeContext'
import MapPage from '../pages/MapPage'
import { isMapPath } from '../lib/isMapPath'

export default function Layout({ children }: { children: React.ReactNode }) {
  // Luna Tour: hide all app chrome when a shared tour/demo is playing full-screen.
  const { active: tourMode } = useTourMode()
  // Collab viewer (/t/:code) is the CLIENT's immersive guided view — usually on a
  // phone. Drop the site header + bottom nav so the map fills the screen; the
  // in-session collab UI (frame, bar, drawer) is rendered inside the page.
  const loc = useLocation()
  const path = loc.pathname
  const isCollabViewer = path.startsWith('/t/')

  // Agent-branded shareable report (/r/:code) — a clean client-facing page with NO
  // app chrome (no header/nav/Luna), but it must scroll (unlike the full-screen map).
  if (path.startsWith('/r/') || path.startsWith('/cr/')) {
    // h-screen + overflow-y-auto = a real scroll container (the parent is height-
    // constrained, so min-h-screen alone clips and won't scroll).
    return <div className="h-screen overflow-y-auto bg-slate-50">{children}</div>
  }

  // The WebGL map is EXPENSIVE to create/destroy. Instead of mounting it per-route
  // (which re-initialised maplibre on every tab switch — the source of the jank),
  // mount MapPage ONCE here and keep it alive; just toggle its visibility. Switching
  // to /pricing etc. now only hides the map (instant) instead of tearing it down,
  // and switching back shows it exactly as the user left it (pan/zoom preserved).
  const onMap = isMapPath(path, loc.search)
  const chromeless = tourMode || isCollabViewer

  // Lazily mount the map the first time a map route is seen, so a user who lands
  // directly on /pricing doesn't pay the map's init cost until they need it.
  const [mapMounted, setMapMounted] = useState(onMap)
  useEffect(() => { if (onMap) setMapMounted(true) }, [onMap])

  return (
    <div className={`h-screen flex flex-col overflow-hidden ${chromeless ? 'bg-black' : 'bg-white'}`}>
      {/* Header (hidden during full-screen tour / collab viewer) */}
      {!chromeless && <Header />}

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

      {/* Voice Assistant - Global, works on all pages */}
      {!chromeless && <VoiceAssistantButton />}

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
