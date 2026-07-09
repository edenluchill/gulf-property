/**
 * RoleBadgeDialog — 「我的勋章」:预览认证勋章 + 一键保存发朋友圈的分享图。
 * canvas 生成 1080×1350 PNG(drawBadgeCard),零依赖。
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Download, Check } from 'lucide-react'
import { RoleBadge, drawBadgeCard } from '../lib/roleBadge'

export default function RoleBadgeDialog({ badge, name, onClose, celebrate = false }: {
  badge: RoleBadge
  name: string
  onClose: () => void
  /** true = 里程碑庆祝框(订阅成功刚颁发时):恭喜文案 + 引导主动分享 */
  celebrate?: boolean
}) {
  const { i18n } = useTranslation()
  const zh = !!i18n.language?.startsWith('zh')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    drawBadgeCard(canvas, badge, { name, zh })
    try { setDataUrl(canvas.toDataURL('image/png')) } catch { /* noop */ }
  }, [badge, name, zh])

  const save = () => {
    if (!dataUrl) return
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = `pinzos-badge-${badge.planId}.png`
    a.click()
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  return (
    <div className="fixed inset-0 z-[1300] flex items-center justify-center overflow-y-auto bg-slate-900/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="my-auto w-full max-w-sm overflow-hidden rounded-3xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* 庆祝顶栏(里程碑):恭喜入驻 —— 只在订阅成功刚颁发时显示 */}
        {celebrate && (
          <div
            className="relative px-5 pb-4 pt-5 text-center text-white"
            style={{ background: `linear-gradient(135deg, ${badge.from}, ${badge.to})` }}
          >
            <button onClick={onClose} className="absolute right-3 top-3 rounded-full p-1.5 text-white/70 hover:bg-white/15">
              <X className="h-4 w-4" />
            </button>
            <div className="text-3xl">🎉</div>
            <h3 className="mt-1 text-lg font-extrabold leading-tight">
              {zh ? '恭喜入驻 Pinzos！' : `Welcome to Pinzos!`}
            </h3>
            <p className="mt-1 text-sm font-medium text-white/90">
              {zh
                ? `你已成为迪拜更专业的经纪人`
                : `You're now a more professional Dubai agent`}
            </p>
            <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold ring-1 ring-white/25">
              <span aria-hidden>{badge.emoji}</span>
              {zh ? badge.titleZh : badge.titleEn}
            </div>
          </div>
        )}

        <div className="p-5">
          {!celebrate && (
            <div className="mb-1 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">{zh ? '我的认证勋章' : 'My certification badge'}</h3>
              <button onClick={onClose} className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          {celebrate && (
            <p className="mb-3 text-center text-sm text-slate-500">
              {zh ? '晒出你的认证,让客户第一时间认可你 👇' : 'Show off your certification to clients 👇'}
            </p>
          )}

          {/* 隐藏的绘制画布 + 预览图 */}
          <canvas ref={canvasRef} className="hidden" />
          {dataUrl && (
            <img src={dataUrl} alt="badge" className="w-full rounded-2xl shadow-lg ring-1 ring-slate-900/10" />
          )}

          <button
            onClick={save}
            disabled={!dataUrl}
            className={`mt-4 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-all active:scale-[0.98] disabled:opacity-50 ${
              saved ? 'bg-green-600' : 'bg-slate-900 hover:bg-slate-800'
            }`}
          >
            {saved ? <Check className="h-4 w-4" /> : <Download className="h-4 w-4" />}
            {saved
              ? (zh ? '已保存' : 'Saved')
              : celebrate
                ? (zh ? '保存并分享朋友圈' : 'Save & share')
                : (zh ? '保存图片(发朋友圈)' : 'Save image (share it!)')}
          </button>
          <p className="mt-2 text-center text-[11px] text-slate-400">
            {zh ? '保存后即可分享到朋友圈 / WhatsApp Status' : 'Share to WeChat Moments / WhatsApp Status'}
          </p>
        </div>
      </div>
    </div>
  )
}
