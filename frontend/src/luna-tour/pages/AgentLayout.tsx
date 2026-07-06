/**
 * Luna Tour — agent dashboard shell (route: /agent/*).
 *
 * Left sidebar tabs + an <Outlet/> for the active tab. GATED server-side by
 * approval: login (Supabase magic-link) → /api/agents/me → only 'approved'
 * (or the owner) reaches the console; 'pending'/'rejected' see a status screen.
 */
import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { Loader2, MailCheck, Clock, ShieldX, ArrowRight } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { fetchAgentStatus, type AgentStatus } from '../../lib/agentApi'
import { setMyRole } from '../../lib/billingApi'

/** 自助开通:记角色为经纪 → 去选档页(付款成功 webhook 自动 approve,无需等审批)。 */
function GoPlansButton() {
  const [busy, setBusy] = useState(false)
  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        await setMyRole('agent').catch(() => {})
        try { sessionStorage.setItem('pinzos-role', 'agent') } catch { /* noop */ }
        window.location.href = '/agent/plans'
      }}
      className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:opacity-60"
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <>选择套餐,立即开通(7 天免费试用)<ArrowRight className="h-4 w-4" /></>}
    </button>
  )
}

const NAV = [
  { to: '/agent', end: true, label: '概览', icon: '📊' },
  { to: '/agent/clients', end: false, label: '客户', icon: '👥' },
  { to: '/agent/tour', end: false, label: '生成导览', icon: '🎬' },
  { to: '/agent/report', end: false, label: '快速提案', icon: '📄' },
  { to: '/agent/billing', end: false, label: '订阅', icon: '💳' },
]

/** Sign in so the agent's tours/clients are scoped to their own account (else
 *  everything runs on the shared demo agent). Magic-link email — no password. */
function AgentAuthBox() {
  const { user, signInWithOtp, signOut } = useAuth()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  if (user) {
    return (
      <div className="mt-4 px-2 text-xs">
        <div className="text-slate-500 truncate" title={user.email || ''}>✅ {user.email}</div>
        <button onClick={() => signOut()} className="mt-1 text-slate-400 hover:text-slate-600 hover:underline">退出登录</button>
      </div>
    )
  }
  return (
    <div className="mt-4 px-2 text-xs">
      <div className="text-amber-600 mb-1">⚠ 未登录(数据存到共享 demo)</div>
      {sent ? (
        <div className="text-slate-500">已发送登录链接到 {email},去邮箱点开。</div>
      ) : (
        <>
          <input
            className="w-full border rounded px-2 py-1 mb-1"
            placeholder="邮箱登录(存到你的账户)"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button
            disabled={!/.+@.+\..+/.test(email)}
            onClick={async () => {
              const { error } = await signInWithOtp(email.trim())
              if (!error) setSent(true)
            }}
            className="w-full bg-emerald-500 text-white rounded px-2 py-1 disabled:opacity-50"
          >
            发送登录链接
          </button>
        </>
      )}
    </div>
  )
}

/** Centered status card for the gate states (login / pending / rejected). */
function GateCard({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-900/[0.06]">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-50">{icon}</div>
        <h2 className="text-lg font-bold text-slate-900">{title}</h2>
        <div className="mt-2 text-sm text-slate-500">{children}</div>
      </div>
    </div>
  )
}

function LoginGate() {
  const { signInWithOtp } = useAuth()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  return (
    <GateCard icon={<MailCheck className="h-6 w-6 text-emerald-600" />} title="经纪登录">
      {sent ? (
        <p>已发送登录链接到 <span className="font-medium text-slate-700">{email}</span>,去邮箱点开即可。</p>
      ) : (
        <>
          <p className="mb-3">用邮箱登录,申请使用经纪台。</p>
          <input
            className="mb-2 w-full rounded-lg border px-3 py-2 text-sm"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button
            disabled={!/.+@.+\..+/.test(email)}
            onClick={async () => { const { error } = await signInWithOtp(email.trim()); if (!error) setSent(true) }}
            className="w-full rounded-lg bg-emerald-500 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            发送登录链接
          </button>
        </>
      )}
    </GateCard>
  )
}

export default function AgentLayout() {
  const { user, loading, signOut } = useAuth()
  const [status, setStatus] = useState<AgentStatus>('loading')

  useEffect(() => {
    if (loading) return
    if (!user) { setStatus('none'); return }
    setStatus('loading')
    // 付款成功回跳(?status=success)时 webhook 可能还没把审批落库 —— 轮询
    // 最多 ~12s,别让刚付完钱的人卡在"审核中"门外(role/勋章逻辑都在门内)。
    let stale = false
    let tries = 0
    const attempt = () => {
      void fetchAgentStatus().then((s) => {
        if (stale) return
        setStatus(s)
        const paidReturn = window.location.search.includes('status=success')
        if (paidReturn && s !== 'approved' && tries < 6) {
          tries += 1
          setTimeout(attempt, 2000)
        }
      })
    }
    attempt()
    return () => { stale = true }
  }, [user, loading])

  if (loading || (user && status === 'loading')) {
    return <div className="flex flex-1 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-emerald-500" /></div>
  }
  if (!user) return <LoginGate />
  if (status === 'pending') {
    return (
      <GateCard icon={<Clock className="h-6 w-6 text-amber-500" />} title="申请已提交">
        <p>你的经纪账号正在审核中。不想等?选择套餐即可立即开通全部经纪功能。</p>
        <GoPlansButton />
        <div className="mt-3 text-xs text-slate-400">{user.email}</div>
        <button onClick={() => signOut()} className="mt-3 text-xs text-slate-400 hover:underline">退出登录</button>
      </GateCard>
    )
  }
  if (status === 'rejected') {
    return (
      <GateCard icon={<ShieldX className="h-6 w-6 text-rose-500" />} title="暂未开通">
        <p>当前账号还没有经纪台使用权限。选择套餐即可立即开通,或联系我们了解详情。</p>
        <GoPlansButton />
        <button onClick={() => signOut()} className="mt-3 text-xs text-slate-400 hover:underline">退出登录</button>
      </GateCard>
    )
  }
  if (status !== 'approved') return <LoginGate />

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
            <AgentAuthBox />
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
