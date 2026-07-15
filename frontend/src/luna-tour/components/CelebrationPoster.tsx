/**
 * 恭喜入驻海报 (2026-07-14) — docs/referral-program-spec.md
 *
 * 登录/注册成功(含试用)后展示:恭喜 + 认证徽章 + slogan + 分享到微信/朋友圈/小红书/抖音。
 * 海报里嵌推荐链接的二维码 —— 别人扫码注册/付费走推荐奖励(累计 3 个换 1 个月)。
 *
 * 🔴 海报图上**只有**恭喜/认证徽章/slogan,**绝不印「分享送 7 天」**(owner 明确要求):
 *    海报会被转发到朋友圈,印着返利文案显得像薅羊毛、掉价,还暴露激励。
 *    「首次分享再得 7 天」只作为分享按钮**旁边的 UI 文案**,不进海报。
 *
 * 分享验证:微信/朋友圈/小红书/抖音的分享技术上无法回调确认(见 spec §7)。
 * 所以首次分享 +7 天靠「一辈子一次」防刷(后端 claimShareReward 原子占位)。
 */
import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { BadgeCheck, Copy, Check, Share2, Gift } from 'lucide-react'
import { claimShareReward } from '../../lib/referralApi'

interface Props {
  name: string
  link: string            // 推荐链接 https://pinzos.com/i/:code
  shareRewardClaimed: boolean
  shareRewardDays: number
  onClaimed?: (days: number) => void  // 首次分享 +7 天到账回调(刷新面板)
}

// 分享渠道:微信/朋友圈/小红书/抖音都没有网页直连分享 API。移动端走系统分享面板
// (navigator.share,能唤起微信等 app);桌面端只能复制链接让用户手动发。
const CHANNELS: Array<{ key: string; label: string; emoji: string; ring: string }> = [
  { key: 'wechat', label: '微信', emoji: '💬', ring: 'ring-green-200' },
  { key: 'moments', label: '朋友圈', emoji: '🌤️', ring: 'ring-orange-200' },
  { key: 'xhs', label: '小红书', emoji: '📕', ring: 'ring-red-200' },
  { key: 'douyin', label: '抖音', emoji: '🎵', ring: 'ring-slate-300' },
]

export default function CelebrationPoster({ name, link, shareRewardClaimed, shareRewardDays, onClaimed }: Props) {
  const [qr, setQr] = useState<string>('')
  const [copied, setCopied] = useState(false)
  const [claimed, setClaimed] = useState(shareRewardClaimed)
  const [toast, setToast] = useState<string>('')

  useEffect(() => {
    QRCode.toDataURL(link, { margin: 1, width: 200, color: { dark: '#1e1b4b', light: '#ffffff' } })
      .then(setQr).catch(() => {})
  }, [link])

  // 首次分享 → 领 +7 天(一辈子一次)。无论走哪个渠道、能不能验证真的分享了,都在
  // 用户主动点分享的那一刻发放;后端「一次」防刷。
  async function grantOnce(): Promise<void> {
    if (claimed) return
    const r = await claimShareReward()
    if (r.ok && r.days > 0) {
      setClaimed(true)
      setToast(`🎁 已到账 ${r.days} 天免费使用`)
      onClaimed?.(r.days)
      setTimeout(() => setToast(''), 3000)
    } else if (r.code === 'already_claimed') {
      setClaimed(true)
    } else if (r.code === 'no_trial_to_extend') {
      setClaimed(true) // 已是订阅用户,无需延长试用
    }
  }

  async function share(channel: string): Promise<void> {
    const text = '迪拜买房新方式,让位置说话 —— 我在用 Pinzos,推荐给你 👇'
    // 移动端:唤起系统分享面板(微信/小红书/抖音都在里面)
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: 'Pinzos · 迪拜买房新方式', text, url: link })
        await grantOnce()
        return
      } catch {
        /* 用户取消分享面板 → 不发奖,继续走复制兜底 */
        return
      }
    }
    // 桌面端 / 不支持 Web Share:复制链接,提示手动发到对应渠道
    await copyLink()
    setToast(`链接已复制,去${CHANNELS.find((c) => c.key === channel)?.label || ''}粘贴分享`)
    await grantOnce()
    setTimeout(() => setToast(''), 3000)
  }

  async function copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard 不可用 → 用户手动选中 */
    }
  }

  return (
    <div className="relative">
      {/* ── 海报卡(可截图分享的部分;绝不含「+7天」)────────────── */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-b from-indigo-50 via-white to-white ring-1 ring-indigo-100 shadow-xl shadow-indigo-500/10">
        {/* 顶部装饰光 */}
        <div className="absolute -top-16 left-1/2 -translate-x-1/2 w-72 h-72 bg-gradient-to-br from-indigo-300/40 to-violet-300/30 blur-3xl rounded-full" />

        <div className="relative px-7 pt-9 pb-7 text-center">
          {/* 徽章 */}
          <div className="mx-auto w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/40 ring-4 ring-white">
            <BadgeCheck className="w-11 h-11 text-white" strokeWidth={2.2} />
          </div>

          <h1 className="mt-5 text-3xl font-black text-slate-900 tracking-tight">恭喜你!</h1>

          <div className="mt-4 flex items-center justify-center gap-3">
            <div className="w-11 h-11 rounded-full bg-gradient-to-br from-indigo-400 to-violet-500 flex items-center justify-center text-white font-bold text-lg">
              {name.slice(0, 1).toUpperCase()}
            </div>
            <div className="text-left">
              <div className="text-lg font-bold text-slate-900 leading-tight">{name}</div>
              <div className="text-sm text-slate-500">已成功注册入驻 <span className="font-bold text-indigo-600">Pinzos</span></div>
            </div>
          </div>

          {/* 认证条(boss 要求「迪拜买房新方式」大字) */}
          <div className="mt-5 mx-auto max-w-xs rounded-2xl bg-gradient-to-r from-indigo-500 to-violet-600 px-5 py-3.5 shadow-md">
            <div className="flex items-center justify-center gap-2 text-white">
              <BadgeCheck className="w-5 h-5 shrink-0" />
              <span className="text-xl font-black tracking-tight">迪拜买房新方式</span>
            </div>
            <div className="text-indigo-100 text-xs font-medium mt-0.5">专业经纪人用 Pinzos</div>
          </div>

          <p className="mt-4 text-slate-600 font-semibold">让位置说话,让成交更简单 💜</p>

          {/* 二维码(海报里的推荐入口) */}
          {qr && (
            <div className="mt-5 inline-flex flex-col items-center gap-1.5 rounded-2xl bg-white px-4 py-3 ring-1 ring-slate-100 shadow-sm">
              <img src={qr} alt="扫码加入" className="w-24 h-24" />
              <span className="text-[11px] text-slate-400">扫码 · 开启你的专业卖房之旅</span>
            </div>
          )}
        </div>
      </div>

      {/* ── 分享区(不属于海报图;「+7天」提示在这里,不进海报)────── */}
      <div className="mt-4 rounded-2xl bg-white ring-1 ring-slate-100 p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <Share2 className="w-4 h-4 text-indigo-500" /> 分享给更多朋友
          </div>
          {!claimed && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
              <Gift className="w-3.5 h-3.5" /> 首次分享再得 {shareRewardDays} 天
            </span>
          )}
        </div>

        <div className="mt-3 grid grid-cols-4 gap-2">
          {CHANNELS.map((c) => (
            <button
              key={c.key}
              onClick={() => share(c.key)}
              className={`flex flex-col items-center gap-1.5 rounded-xl py-3 ring-1 ${c.ring} bg-slate-50 hover:bg-white transition active:scale-95`}
            >
              <span className="text-2xl">{c.emoji}</span>
              <span className="text-xs font-medium text-slate-600">{c.label}</span>
            </button>
          ))}
        </div>

        <button
          onClick={copyLink}
          className="mt-2.5 w-full flex items-center justify-center gap-2 rounded-xl bg-slate-900 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 transition active:scale-[0.99]"
        >
          {copied ? <><Check className="w-4 h-4" /> 已复制链接</> : <><Copy className="w-4 h-4" /> 复制专属链接</>}
        </button>
      </div>

      {/* toast */}
      {toast && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  )
}
