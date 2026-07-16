/**
 * 入驻海报 (2026-07-14, v3 canvas 合成 + 中英双模板) — docs/referral-program-spec.md
 *
 * 用设计好的 AI 海报做底图,canvas 在原名字/头像位置**盖字**换成当前用户,叠推荐二维码,
 * 导出**真 PNG**(朋友圈只能发图片)。中英各一张底图(zh 是 Shell 原图,en 是等价英文版),
 * 按界面语言自动切换,坐标各自标定(英文版重绘后元素有轻微漂移)。
 *
 * 盖字而非 AI 洗图:名字/头像都在纯色白卡 rgb(250,249,254) 上,像素级可控不走样。
 * 🔴 海报图绝不印「分享送 7 天」(owner 要求),只在按钮旁做 UI 文案。
 * 分享验证:微信/朋友圈无法回调 → 首次分享 +7 天靠「一辈子一次」防刷。
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import QRCode from 'qrcode'
import { Download, Share2, Copy, Check, Gift, Loader2 } from 'lucide-react'
import { claimShareReward } from '../../lib/referralApi'
import ShareChannelIcon, { type ChannelKey } from './ShareChannelIcon'

interface Props {
  name: string
  avatarUrl?: string | null
  link: string
  shareRewardClaimed: boolean
  shareRewardDays: number
  shareRewardCredits: number
  onClaimed?: (days: number) => void
}

// 底图原生尺寸;CROP_H=裁掉底部烤进图里的假「分享给更多朋友」条(zh y≈1358 / en y≈1368,都在其上)
const W = 1024, H = 1536, CROP_H = 1356
const CARD_BG = 'rgb(250,249,254)'

// 每种语言一套底图 + 坐标(像素扫描标定;英文版重绘后位置略有漂移,单独量)
const POSTER = {
  zh: {
    src: '/welcome-poster-template.png',
    avatar: { cx: 352, cy: 732, r: 66 },
    nameCover: { x: 448, y: 672, w: 320, h: 82 },
    nameText: { x: 456, y: 730, size: 54 },
    qr: { x: 806, y: 1130, size: 152, pad: 14 },
    qrLabel: '扫码加入 Pinzos',
  },
  en: {
    src: '/welcome-poster-template-en.png',
    avatar: { cx: 350, cy: 734, r: 66 },
    nameCover: { x: 448, y: 682, w: 320, h: 66 },  // 名字 y689-719,副行 y755 起,盖块夹在中间空隙
    nameText: { x: 456, y: 722, size: 54 },
    qr: { x: 806, y: 1130, size: 152, pad: 14 },
    qrLabel: 'Scan to join Pinzos',
  },
}

// 渠道跟着语言走:中文=微信/小红书/抖音;海外=WhatsApp/Instagram/TikTok/Facebook。
// 每个带专属引导(桌面保存图片后提示去哪发;网页无法直接分到指定 App)。
interface Channel { key: ChannelKey; label: string; hint: string }
const ZH_CHANNELS: Channel[] = [
  { key: 'wechat', label: '微信', hint: '已保存海报,打开微信发好友/朋友圈' },
  { key: 'xhs', label: '小红书', hint: '已保存海报,打开小红书发布' },
  { key: 'douyin', label: '抖音', hint: '已保存海报,打开抖音发布' },
]
const EN_CHANNELS: Channel[] = [
  { key: 'whatsapp', label: 'WhatsApp', hint: 'Saved — open WhatsApp to send' },
  { key: 'instagram', label: 'Instagram', hint: 'Saved — open Instagram to post' },
  { key: 'tiktok', label: 'TikTok', hint: 'Saved — open TikTok to post' },
  { key: 'facebook', label: 'Facebook', hint: 'Saved — open Facebook to post' },
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

export default function CelebrationPoster({ name, avatarUrl, link, shareRewardClaimed, shareRewardDays, shareRewardCredits, onClaimed }: Props) {
  const { t: tRaw, i18n } = useTranslation('lunaTour')
  const t = tRaw as (k: string, o?: Record<string, unknown>) => string
  const zh = !!i18n.language?.startsWith('zh')
  const cfg = zh ? POSTER.zh : POSTER.en

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
      canvas.width = W; canvas.height = CROP_H  // 画布只有 CROP_H 高 → 底部假分享条自动被裁掉

      const bg = await loadImg(cfg.src).catch(() => null)
      if (!bg || cancelled) return
      ctx.drawImage(bg, 0, 0, W, H)

      // 头像:盖掉原照片,画当前用户
      const AV = cfg.avatar
      ctx.save()
      ctx.beginPath(); ctx.arc(AV.cx, AV.cy, AV.r + 2, 0, Math.PI * 2); ctx.closePath(); ctx.clip()
      let drewAvatar = false
      if (avatarUrl) {
        // 独立缓存键:避免复用「之前 <img> 无 crossOrigin 拿的、不带 CORS 头」的缓存
        // → 那份缓存会让带 crossOrigin 的加载 CORS 校验失败、污染画布。加 ?canvas=1 单开一份。
        const cacheKeyed = avatarUrl + (avatarUrl.includes('?') ? '&' : '?') + 'canvas=1'
        const av = await loadImg(cacheKeyed, true).catch(() => null)
        if (av && !cancelled) { ctx.drawImage(av, AV.cx - AV.r, AV.cy - AV.r, AV.r * 2, AV.r * 2); drewAvatar = true }
      }
      if (!drewAvatar) {
        const g = ctx.createLinearGradient(AV.cx - AV.r, AV.cy - AV.r, AV.cx + AV.r, AV.cy + AV.r)
        g.addColorStop(0, '#818cf8'); g.addColorStop(1, '#7c3aed')
        ctx.fillStyle = g; ctx.fillRect(AV.cx - AV.r, AV.cy - AV.r, AV.r * 2, AV.r * 2)
        ctx.fillStyle = '#fff'; ctx.font = `bold ${AV.r}px "PingFang SC","Microsoft YaHei",sans-serif`
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.fillText(name.slice(0, 1).toUpperCase(), AV.cx, AV.cy + 2)
      }
      ctx.restore()

      // 名字:盖掉原占位名,重画当前用户名
      ctx.fillStyle = CARD_BG
      ctx.fillRect(cfg.nameCover.x, cfg.nameCover.y, cfg.nameCover.w, cfg.nameCover.h)
      ctx.fillStyle = '#1f2a44'
      let fs = cfg.nameText.size
      ctx.font = `bold ${fs}px "PingFang SC","Microsoft YaHei",sans-serif`
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
      while (ctx.measureText(name).width > cfg.nameCover.w - 8 && fs > 24) {
        fs -= 2; ctx.font = `bold ${fs}px "PingFang SC","Microsoft YaHei",sans-serif`
      }
      ctx.fillText(name, cfg.nameText.x, cfg.nameText.y)

      // 推荐二维码卡(右下角)
      const qrData = await QRCode.toDataURL(link, { margin: 1, width: 300, color: { dark: '#1e1b4b', light: '#ffffff' } }).catch(() => '')
      if (qrData && !cancelled) {
        const qrImg = await loadImg(qrData).catch(() => null)
        if (qrImg) {
          const Q = cfg.qr
          const bx = Q.x - Q.pad, by = Q.y - Q.pad, bw = Q.size + Q.pad * 2, bh = Q.size + Q.pad * 2 + 30
          ctx.save()
          ctx.shadowColor = 'rgba(30,27,75,0.18)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 4
          ctx.fillStyle = '#ffffff'; roundRect(ctx, bx, by, bw, bh, 18); ctx.fill()
          ctx.restore()
          ctx.drawImage(qrImg, Q.x, Q.y, Q.size, Q.size)
          ctx.fillStyle = '#64748b'; ctx.font = 'bold 20px "PingFang SC","Microsoft YaHei",sans-serif'
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
          ctx.fillText(cfg.qrLabel, Q.x + Q.size / 2, Q.y + Q.size + 16)
        }
      }

      if (cancelled) return
      // 兜底:万一某张头像污染了画布,toDataURL 会抛 —— 别让海报卡在 loading。
      try { setDataUrl(canvas.toDataURL('image/png')) } catch (e) { console.warn('[poster] toDataURL tainted:', e) }
      setBuilding(false)
    })()
    return () => { cancelled = true }
  }, [name, avatarUrl, link, cfg])

  async function grantOnce() {
    if (claimed) return
    const r = await claimShareReward()
    if (r.ok && r.days > 0) {
      setClaimed(true)
      setToast(t('lunaTour:daysCreditsAdded', { r_days: r.days, r_credits: r.credits }))
      onClaimed?.(r.days)
      setTimeout(() => setToast(''), 3200)
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

  async function share(ch: Channel) {
    if (!dataUrl) return
    const file = dataUrlToFile(dataUrl)
    // 手机:唤起系统分享面板(用户自己挑 App;网页无法直接分到指定 App)
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Pinzos', text: t('lunaTour:theNewWayTo') })
        await grantOnce(); return
      } catch { return }
    }
    // 桌面:保存图片 + 该平台专属引导(打开微信/小红书... 去发布)
    download()
    setToast(ch.hint)
    await grantOnce()
    setTimeout(() => setToast(''), 3500)
  }

  function download() {
    if (!dataUrl) return
    const a = document.createElement('a')
    a.href = dataUrl; a.download = t('lunaTour:pinzosWelcomePng'); a.click()
  }

  async function copyLink() {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* noop */ }
  }

  return (
    <div className="relative w-full">
      <canvas ref={canvasRef} className="hidden" />

      {/* 合成后的海报图 */}
      <div className="relative rounded-3xl overflow-hidden ring-1 ring-slate-100 shadow-xl shadow-indigo-500/10 bg-indigo-50">
        {building && (
          <div className="aspect-[1024/1356] flex items-center justify-center text-indigo-300">
            <Loader2 className="w-8 h-8 animate-spin" />
          </div>
        )}
        {dataUrl && <img src={dataUrl} alt="Pinzos" className="w-full block" />}
      </div>

      {/* 分享区(不属于海报图;「+7天」提示在这里,绝不进图) */}
      <div className="mt-4 rounded-2xl bg-white ring-1 ring-slate-100 p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <Share2 className="w-4 h-4 text-indigo-500" /> {t('lunaTour:shareYourPoster')}
          </div>
          {!claimed && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
              <Gift className="w-3.5 h-3.5" /> {t('lunaTour:1stShareDCredits', { shareRewardDays, shareRewardCredits })}
            </span>
          )}
        </div>

        <div className={`mt-3 grid gap-2 ${zh ? 'grid-cols-3' : 'grid-cols-4'}`}>
          {(zh ? ZH_CHANNELS : EN_CHANNELS).map((c) => (
            <button key={c.key} onClick={() => share(c)} disabled={building}
              className="flex flex-col items-center gap-1.5 rounded-xl py-3 ring-1 ring-slate-100 bg-slate-50 hover:bg-white transition active:scale-95 disabled:opacity-50">
              <ShareChannelIcon channel={c.key} />
              <span className="text-xs font-medium text-slate-600">{c.label}</span>
            </button>
          ))}
        </div>

        <div className="mt-2.5 grid grid-cols-2 gap-2">
          <button onClick={download} disabled={building}
            className="flex items-center justify-center gap-2 rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 transition active:scale-[0.99] disabled:opacity-50">
            <Download className="w-4 h-4" /> {t('lunaTour:savePoster')}
          </button>
          <button onClick={copyLink}
            className="flex items-center justify-center gap-2 rounded-xl bg-slate-900 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 transition active:scale-[0.99]">
            {copied ? <><Check className="w-4 h-4" /> {t('lunaTour:copied2')}</> : <><Copy className="w-4 h-4" /> {t('lunaTour:copyLink2')}</>}
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
