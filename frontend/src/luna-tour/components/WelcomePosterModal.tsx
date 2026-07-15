/**
 * 入驻海报弹窗 (2026-07-14) — docs/referral-program-spec.md
 *
 * 「入驻」与「推广」是**两件事**(owner 2026-07-14 定,别合在一起):
 *   - 入驻海报(这里):注册/登录成功自动弹一次,分享它 = 纯品牌扩散 → 一次性 +7 天。
 *     二维码 = **通用加入链接**(不是推荐链接;推广的折扣走另一条链接,见推广有礼 tab)。
 *   - 推广有礼(AgentPromo tab):/i/:code 推荐链接,被推荐人 20% off + 推荐人免费月。
 *
 * 两种用法:
 *   - 不传 open → 自动弹一次(localStorage per-agent),用于登录后的入驻时刻。
 *   - 传 open/onClose → 受控,用于「我的入驻海报」按钮手动重开。
 *
 * ⚠️ fixed 全屏弹层必须 createPortal 到 body(见 memory: fixed-modal-portal-backdrop-filter)。
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { fetchReferral, type ReferralStats } from '../../lib/referralApi'
import { lunaFetch } from '../lunaApi'
import CelebrationPoster from './CelebrationPoster'

const SEEN_PREFIX = 'pz-welcome-poster:'

/** 入驻海报二维码指向的通用加入链接(纯扩散,不带推荐归因)。 */
function joinLink(): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://www.pinzos.com'
  return `${origin}/?from=welcome`
}

export default function WelcomePosterModal({ open: openProp, onClose }: { open?: boolean; onClose?: () => void } = {}) {
  const controlled = openProp !== undefined
  const { user } = useAuth()
  const [stats, setStats] = useState<ReferralStats | null>(null)
  const [autoOpen, setAutoOpen] = useState(false)
  const [cardPhoto, setCardPhoto] = useState<string | null>(null)

  const email = user?.email || ''
  const name = (user?.user_metadata?.name as string) || email.split('@')[0] || '经纪'
  // 头像优先级:经纪名片职业照 > Google 头像 > 首字母(CelebrationPoster 兜底)
  const avatarUrl = cardPhoto || (user?.user_metadata?.avatar_url as string) || (user?.user_metadata?.picture as string) || null

  // 拉经纪名片拿职业照(海报头像优先用它)
  useEffect(() => {
    if (!email) return
    lunaFetch('/profile').then((r) => r.json()).then((j) => setCardPhoto(j?.agent?.photo_url || null)).catch(() => {})
  }, [email])

  // 拉一次(拿 shareReward 领取状态);受控模式每次打开都拉,自动模式只在没看过时拉。
  useEffect(() => {
    if (!email) return
    if (controlled) {
      if (openProp) fetchReferral().then((s) => s && setStats(s)).catch(() => {})
      return
    }
    let seen = false
    try { seen = localStorage.getItem(SEEN_PREFIX + email) === '1' } catch { /* noop */ }
    if (seen) return
    fetchReferral().then((s) => {
      if (!s) return
      setStats(s); setAutoOpen(true)
      try { localStorage.setItem(SEEN_PREFIX + email, '1') } catch { /* noop */ }
    }).catch(() => {})
  }, [email, controlled, openProp])

  const isOpen = controlled ? !!openProp : autoOpen
  if (!isOpen || !stats) return null

  const close = () => { if (controlled) onClose?.(); else setAutoOpen(false) }

  return createPortal(
    // 外层只管滚动;内层 flex min-h-full 居中 —— 海报很高时(桌面/平板)顶部也能滚到,不被裁。
    <div className="fixed inset-0 z-[100] overflow-y-auto bg-slate-900/50 backdrop-blur-sm" onClick={close}>
      <div className="flex min-h-full items-center justify-center p-4">
        {/* 响应式:手机近满宽,桌面/平板更大 */}
        <div className="relative my-8 w-full max-w-[min(92vw,540px)]" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={close}
            className="absolute -top-3 -right-3 z-10 w-9 h-9 rounded-full bg-white shadow-lg flex items-center justify-center text-slate-500 hover:text-slate-900"
            aria-label="关闭"
          >
            <X className="w-5 h-5" />
          </button>
          <CelebrationPoster
            name={name}
            avatarUrl={avatarUrl}
            link={joinLink()}
            shareRewardClaimed={stats.shareRewardClaimed}
            shareRewardDays={stats.shareRewardDays}
          />
        </div>
      </div>
    </div>,
    document.body
  )
}
