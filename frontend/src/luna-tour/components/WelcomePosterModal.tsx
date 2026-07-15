/**
 * 首登欢迎海报弹窗 (2026-07-14) — docs/referral-program-spec.md
 *
 * 注册/登录成功(含试用)后**自动弹一次**恭喜入驻海报(owner 要求)。
 * 一辈子弹一次:localStorage 标记 per-agent-email。之后想再看去「推广有礼」tab。
 *
 * ⚠️ fixed 全屏弹层必须 createPortal 到 body(见 memory: fixed-modal-portal-backdrop-filter)——
 *    经纪台外壳有 transform 容器,不 portal 会被裁。
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { fetchReferral, type ReferralStats } from '../../lib/referralApi'
import CelebrationPoster from './CelebrationPoster'

const SEEN_PREFIX = 'pz-welcome-poster:'

export default function WelcomePosterModal() {
  const { user } = useAuth()
  const [stats, setStats] = useState<ReferralStats | null>(null)
  const [open, setOpen] = useState(false)

  const email = user?.email || ''
  const name = (user?.user_metadata?.name as string) || email.split('@')[0] || '经纪'

  useEffect(() => {
    if (!email) return
    let seen = false
    try { seen = localStorage.getItem(SEEN_PREFIX + email) === '1' } catch { /* noop */ }
    if (seen) return
    // 拉推荐链接(顺带懒生成推荐码)。拿到才弹 —— 海报二维码要真链接。
    fetchReferral().then((s) => {
      if (!s) return
      setStats(s)
      setOpen(true)
      try { localStorage.setItem(SEEN_PREFIX + email, '1') } catch { /* noop */ }
    }).catch(() => {})
  }, [email])

  if (!open || !stats) return null

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-md my-8">
        <button
          onClick={() => setOpen(false)}
          className="absolute -top-3 -right-3 z-10 w-9 h-9 rounded-full bg-white shadow-lg flex items-center justify-center text-slate-500 hover:text-slate-900"
          aria-label="关闭"
        >
          <X className="w-5 h-5" />
        </button>
        <CelebrationPoster
          name={name}
          link={stats.link}
          shareRewardClaimed={stats.shareRewardClaimed}
          shareRewardDays={stats.shareRewardDays}
        />
      </div>
    </div>,
    document.body
  )
}
