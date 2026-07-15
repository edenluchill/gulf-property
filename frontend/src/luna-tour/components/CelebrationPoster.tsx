/**
 * 恭喜入驻海报 (2026-07-14, v2 canvas 合成) — docs/referral-program-spec.md
 *
 * 用 Shell 的 AI 海报做底图(public/welcome-poster-template.png,1024×1536),canvas 在
 * 原图的名字/头像位置**盖字**换成当前用户,叠一个推荐二维码,导出**真 PNG** —— 这样才能
 * 直接分享到朋友圈(朋友圈只能发图片,发不了网页卡片)。
 *
 * 为什么盖字而不是让 AI 洗模板:名字/头像都压在纯色白卡(rgb(250,249,254))上,canvas
 * 精准盖一层重画,像素级可控、不会把奖章/天际线/吉祥物一起重画走样。
 *
 * 🔴 海报图上**只有**恭喜/认证/slogan/二维码,**绝不印「分享送 7 天」**(owner 要求):
 *    海报要转朋友圈,印返利文案显得薅羊毛。+7天只是海报下方按钮旁的 UI 文案,不进图。
 *
 * 分享验证:微信/朋友圈分享技术上无法回调确认 → 首次分享 +7 天靠「一辈子一次」防刷。
 */
import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { Download, Share2, Copy, Check, Gift, Loader2 } from 'lucide-react'
import { claimShareReward } from '../../lib/referralApi'

interface Props {
  name: string
  avatarUrl?: string | null
  link: string
  shareRewardClaimed: boolean
  shareRewardDays: number
  onClaimed?: (days: number) => void
}

// 底图原生尺寸
const W = 1024, H = 1536
const CARD_BG = 'rgb(250,249,254)'
// 原图里名字/头像的精确位置(像素扫描得到)
const AVATAR = { cx: 352, cy: 732, r: 66 }
const NAME_COVER = { x: 448, y: 672, w: 320, h: 82 }   // 盖住原「王帅（Shell）」
const NAME_TEXT = { x: 456, y: 730, size: 54 }          // 重画当前用户名(baseline)
// 推荐二维码卡(右下角空白区)
const QR = { x: 806, y: 1176, size: 152, pad: 14 }

const CHANNELS = [
  { key: 'wechat', label: '微信', emoji: '💬' },
  { key: 'moments', label: '朋友圈', emoji: '🌤️' },
  { key: 'xhs', label: '小红书', emoji: '📕' },
  { key: 'douyin', label: '抖音', emoji: '🎵' },
]

function loadImg(src: string, cors = false): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    if (cors) img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

export default function CelebrationPoster({ name, avatarUrl, link, shareRewardClaimed, shareRewardDays, onClaimed }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [dataUrl, setDataUrl] = useState<string>('')
  const [building, setBuilding] = useState(true)
  const [copied, setCopied] = useState(false)
  const [claimed, setClaimed] = useState(shareRewardClaimed)
  const [toast, setToast] = useState('')

  // ── 合成海报 ──
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setBuilding(true)
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      canvas.width = W; canvas.height = H

      const bg = await loadImg('/welcome-poster-template.png').catch(() => null)
      if (!bg || cancelled) return
      ctx.drawImage(bg, 0, 0, W, H)

      // 头像:盖掉原照片,画当前用户(有头像图就裁圆,否则渐变+首字母)
      ctx.save()
      ctx.beginPath(); ctx.arc(AVATAR.cx, AVATAR.cy, AVATAR.r + 2, 0, Math.PI * 2); ctx.closePath(); ctx.clip()
      let drewAvatar = false
      if (avatarUrl) {
        const av = await loadImg(avatarUrl, true).catch(() => null)
        if (av && !cancelled) {
          ctx.drawImage(av, AVATAR.cx - AVATAR.r, AVATAR.cy - AVATAR.r, AVATAR.r * 2, AVATAR.r * 2)
          drewAvatar = true
        }
      }
      if (!drewAvatar) {
        const g = ctx.createLinearGradient(AVATAR.cx - AVATAR.r, AVATAR.cy - AVATAR.r, AVATAR.cx + AVATAR.r, AVATAR.cy + AVATAR.r)
        g.addColorStop(0, '#818cf8'); g.addColorStop(1, '#7c3aed')
        ctx.fillStyle = g; ctx.fillRect(AVATAR.cx - AVATAR.r, AVATAR.cy - AVATAR.r, AVATAR.r * 2, AVATAR.r * 2)
        ctx.fillStyle = '#fff'; ctx.font = `bold ${AVATAR.r}px "PingFang SC","Microsoft YaHei",sans-serif`
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.fillText(name.slice(0, 1).toUpperCase(), AVATAR.cx, AVATAR.cy + 2)
      }
      ctx.restore()

      // 名字:盖掉原「王帅（Shell）」,重画当前用户名
      ctx.fillStyle = CARD_BG
      ctx.fillRect(NAME_COVER.x, NAME_COVER.y, NAME_COVER.w, NAME_COVER.h)
      ctx.fillStyle = '#1f2a44'
      ctx.font = `bold ${NAME_TEXT.size}px "PingFang SC","Microsoft YaHei",sans-serif`
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
      // 名字过长自动缩字号
      let fs = NAME_TEXT.size
      while (ctx.measureText(name).width > NAME_COVER.w - 8 && fs > 24) {
        fs -= 2; ctx.font = `bold ${fs}px "PingFang SC","Microsoft YaHei",sans-serif`
      }
      ctx.fillText(name, NAME_TEXT.x, NAME_TEXT.y)

      // 推荐二维码卡(右下角)
      const qrData = await QRCode.toDataURL(link, { margin: 1, width: 300, color: { dark: '#1e1b4b', light: '#ffffff' } }).catch(() => '')
      if (qrData && !cancelled) {
        const qrImg = await loadImg(qrData).catch(() => null)
        if (qrImg) {
          const bx = QR.x - QR.pad, by = QR.y - QR.pad, bw = QR.size + QR.pad * 2, bh = QR.size + QR.pad * 2 + 30
          ctx.save()
          ctx.shadowColor = 'rgba(30,27,75,0.18)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 4
          ctx.fillStyle = '#ffffff'; roundRect(ctx, bx, by, bw, bh, 18); ctx.fill()
          ctx.restore()
          ctx.drawImage(qrImg, QR.x, QR.y, QR.size, QR.size)
          ctx.fillStyle = '#64748b'; ctx.font = 'bold 20px "PingFang SC","Microsoft YaHei",sans-serif'
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
          ctx.fillText('扫码加入 Pinzos', QR.x + QR.size / 2, QR.y + QR.size + 16)
        }
      }

      if (cancelled) return
      setDataUrl(canvas.toDataURL('image/png'))
      setBuilding(false)
    })()
    return () => { cancelled = true }
  }, [name, avatarUrl, link])

  async function grantOnce() {
    if (claimed) return
    const r = await claimShareReward()
    if (r.ok && r.days > 0) {
      setClaimed(true); setToast(`🎁 已到账 ${r.days} 天免费使用`); onClaimed?.(r.days)
      setTimeout(() => setToast(''), 3000)
    } else if (r.code === 'already_claimed' || r.code === 'no_trial_to_extend') {
      setClaimed(true)
    }
  }

  function dataUrlToFile(url: string): File {
    const [head, b64] = url.split(',')
    const mime = head.match(/:(.*?);/)?.[1] || 'image/png'
    const bin = atob(b64); const arr = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
    return new File([arr], 'pinzos-poster.png', { type: mime })
  }

  async function share() {
    if (!dataUrl) return
    const file = dataUrlToFile(dataUrl)
    // 移动端:优先分享图片文件(能直接进微信/朋友圈的图片分享)
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Pinzos · 迪拜买房新方式', text: '迪拜买房新方式,让位置说话' })
        await grantOnce(); return
      } catch { return /* 用户取消 */ }
    }
    // 桌面 / 不支持:下载图片
    download()
    setToast('海报已保存,去微信/朋友圈发图片分享')
    await grantOnce()
    setTimeout(() => setToast(''), 3500)
  }

  function download() {
    if (!dataUrl) return
    const a = document.createElement('a')
    a.href = dataUrl; a.download = 'pinzos-恭喜入驻.png'; a.click()
  }

  async function copyLink() {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* noop */ }
  }

  return (
    <div className="relative">
      <canvas ref={canvasRef} className="hidden" />

      {/* 合成后的海报图 */}
      <div className="relative rounded-3xl overflow-hidden ring-1 ring-slate-100 shadow-xl shadow-indigo-500/10 bg-indigo-50">
        {building && (
          <div className="aspect-[1024/1536] flex items-center justify-center text-indigo-300">
            <Loader2 className="w-8 h-8 animate-spin" />
          </div>
        )}
        {dataUrl && <img src={dataUrl} alt="恭喜入驻 Pinzos" className="w-full block" />}
      </div>

      {/* 分享区(不属于海报图;「+7天」提示在这里,绝不进图) */}
      <div className="mt-4 rounded-2xl bg-white ring-1 ring-slate-100 p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <Share2 className="w-4 h-4 text-indigo-500" /> 分享海报给更多朋友
          </div>
          {!claimed && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
              <Gift className="w-3.5 h-3.5" /> 首次分享再得 {shareRewardDays} 天
            </span>
          )}
        </div>

        <div className="mt-3 grid grid-cols-4 gap-2">
          {CHANNELS.map((c) => (
            <button key={c.key} onClick={share} disabled={building}
              className="flex flex-col items-center gap-1.5 rounded-xl py-3 ring-1 ring-slate-100 bg-slate-50 hover:bg-white transition active:scale-95 disabled:opacity-50">
              <span className="text-2xl">{c.emoji}</span>
              <span className="text-xs font-medium text-slate-600">{c.label}</span>
            </button>
          ))}
        </div>

        <div className="mt-2.5 grid grid-cols-2 gap-2">
          <button onClick={download} disabled={building}
            className="flex items-center justify-center gap-2 rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 transition active:scale-[0.99] disabled:opacity-50">
            <Download className="w-4 h-4" /> 保存海报
          </button>
          <button onClick={copyLink}
            className="flex items-center justify-center gap-2 rounded-xl bg-slate-900 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 transition active:scale-[0.99]">
            {copied ? <><Check className="w-4 h-4" /> 已复制</> : <><Copy className="w-4 h-4" /> 复制链接</>}
          </button>
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[110] rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  )
}
