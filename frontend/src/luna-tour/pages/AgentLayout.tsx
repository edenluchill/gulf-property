/**
 * Luna Tour — agent console gate (route: /agent/*).
 *
 * 2026-07-07 起经纪台归入「个人中心」外壳(pages/profile/ProfileShell):
 * 侧栏 tab / 滚动容器 / 未登录门都由 shell 提供,这里只剩审批门 ——
 * /api/agents/me → 'approved'(或 owner)放行 <Outlet/>,
 * 'pending'/'rejected' 显示状态卡 + 自助开通入口。
 */
import { useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Loader2, ShieldX, ArrowRight } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { fetchAgentStatus, type AgentStatus } from '../../lib/agentApi'
import { setMyRole } from '../../lib/billingApi'
import AgentCoach from '../../components/AgentCoach'
import TrialBanner from '../../components/TrialBanner'

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
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <>免费试用 7 天,无需信用卡<ArrowRight className="h-4 w-4 rtl:-scale-x-100" /></>}
    </button>
  )
}

/** Centered status card for the gate states (pending / rejected). */
function GateCard({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-center py-16">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-900/[0.06]">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-50">{icon}</div>
        <h2 className="text-lg font-bold text-slate-900">{title}</h2>
        <div className="mt-2 text-sm text-slate-500">{children}</div>
      </div>
    </div>
  )
}

export default function AgentLayout() {
  const { user, loading } = useAuth()
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

  // 未登录由 ProfileShell 的登录门拦截,这里只处理登录后的审批状态。
  if (loading || (user && status === 'loading')) {
    return <div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-emerald-500" /></div>
  }
  // 2026-08-17:'pending' 这条分支已经**不可能出现** —— /me 现在默认建 approved,
  // 存量 pending 也会在那里就地升级。原来的「申请已提交/审核中」墙拦住的从来只是
  // 「还没开试用的人」(和误点进来的买家),那正是最该让他进来看看的人。
  // 剩下的 'rejected'/'none' 才走下面这道门:owner 主动封的人 + 拿不到状态的异常。
  if (status !== 'approved') {
    return (
      <GateCard icon={<ShieldX className="h-6 w-6 text-rose-500" />} title="暂未开通">
        <p>当前账号还没有经纪台使用权限。选择套餐即可立即开通,或联系我们了解详情。</p>
        <GoPlansButton />
      </GateCard>
    )
  }

  // 试用没有信用卡兜底,到期就是真的停 —— 剩余天数/积分常驻在眼前,别等撞 402 才知道。
  return (
    <>
      <TrialBanner />
      <Outlet />
      {/* 产品教练 —— 只在**审批通过的经纪台内**出现。
          2026-08-11:经纪一直在 Luna 里问「怎么把软件发给客人」这类操作问题,
          而 Luna 是对客户说话的房产顾问。把教学挪出来,各归各位。 */}
      <AgentCoach />
    </>
  )
}
