import Header from './Header'
import MobileNav from './MobileNav'
import { FavoritesDrawer } from './favorites'
import { VoiceAssistantButton } from './voice-assistant'
import { useTourMode } from '../luna-tour/TourModeContext'

export default function Layout({ children }: { children: React.ReactNode }) {
  // Luna Tour: hide all app chrome when a shared tour/demo is playing full-screen.
  const { active: tourMode } = useTourMode()

  if (tourMode) {
    return (
      <div className="h-screen flex flex-col bg-black overflow-hidden">
        <main className="flex-1 flex flex-col overflow-hidden">{children}</main>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-white overflow-hidden">
      {/* Header */}
      <Header />

      {/* Main Content - pb-16 on mobile, pb-20 on tablet for bottom nav */}
      <main className="flex-1 flex flex-col overflow-hidden pb-16 md:pb-20 xl:pb-0">
        {children}
      </main>

      {/* Mobile Bottom Navigation */}
      <MobileNav />

      {/* Favorites Drawer - Global, not inside Header */}
      <FavoritesDrawer />

      {/* Voice Assistant - Global, works on all pages */}
      <VoiceAssistantButton />

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
