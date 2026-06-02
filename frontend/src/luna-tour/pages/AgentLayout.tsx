/**
 * Luna Tour — agent dashboard shell (route: /agent/*).
 *
 * Left sidebar tabs + an <Outlet/> for the active tab. All agent-facing tools
 * live under here; add a tab by appending to NAV and adding a nested <Route> in
 * App.tsx. GATED: non-agents are bounced to /agent/join (the become-an-agent
 * entry). MVP gate = localStorage profile.agent; swap for real auth later.
 */
import { NavLink, Outlet, Navigate } from 'react-router-dom'
import { useUserProfile } from '../../contexts/UserProfileContext'

const NAV = [
  { to: '/agent', end: true, label: '概览', icon: '📊' },
  { to: '/agent/tour', end: false, label: '生成导览', icon: '🎬' },
  { to: '/agent/report', end: false, label: '选房报告', icon: '📄' },
]

export default function AgentLayout() {
  const { profile, saveProfile, isLoading } = useUserProfile()

  if (isLoading) return null
  if (!profile?.agent) return <Navigate to="/agent/join" replace />

  return (
    // own scroll container (Layout's <main> is overflow-hidden); overflow-y-scroll
    // always reserves the scrollbar gutter so content width never shifts between tabs.
    <div className="flex-1 overflow-y-scroll">
      <div className="max-w-6xl mx-auto p-4 md:p-6">
      <div className="flex gap-6">
        {/* sidebar */}
        <aside className="w-48 shrink-0 hidden md:block">
          <div className="sticky top-6">
            <div className="px-2 mb-4">
              <div className="font-bold text-lg">Luna 经纪台</div>
              <div className="text-xs text-slate-400">demo 经纪账户</div>
            </div>
            <nav className="space-y-1">
              {NAV.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  end={n.end}
                  className={({ isActive }) =>
                    `flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
                      isActive ? 'bg-emerald-50 text-emerald-700' : 'text-slate-600 hover:bg-slate-50'
                    }`
                  }
                >
                  <span>{n.icon}</span>
                  <span>{n.label}</span>
                </NavLink>
              ))}
            </nav>
            <button
              onClick={() => saveProfile({ agent: undefined })}
              className="mt-6 px-3 text-xs text-slate-400 hover:text-slate-600 hover:underline"
            >
              退出经纪模式
            </button>
          </div>
        </aside>

        {/* mobile tabs */}
        <div className="md:hidden fixed top-16 left-0 right-0 z-10 bg-white border-b flex">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `flex-1 text-center py-2 text-sm font-medium ${isActive ? 'text-emerald-700 border-b-2 border-emerald-500' : 'text-slate-500'}`
              }
            >
              {n.icon} {n.label}
            </NavLink>
          ))}
        </div>

        {/* content */}
        <main className="flex-1 min-w-0 md:pt-0 pt-12">
          <Outlet />
        </main>
      </div>
      </div>
    </div>
  )
}
