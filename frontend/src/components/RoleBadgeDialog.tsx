/**
 * RoleBadgeDialog — 「我的勋章」:预览认证勋章 + 一键保存发朋友圈的分享图。
 * canvas 生成 1080×1350 PNG(drawBadgeCard),零依赖。
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Download, Check } from 'lucide-react'
import { RoleBadge, drawBadgeCard } from '../lib/roleBadge'

export default function RoleBadgeDialog({ badge, name, onClose }: {
  badge: RoleBadge
  name: string
  onClose: () => void
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
      <div className="my-auto w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-900">{zh ? '我的认证勋章' : 'My certification badge'}</h3>
          <button onClick={onClose} className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 隐藏的绘制画布 + 预览图 */}
        <canvas ref={canvasRef} className="hidden" />
        {dataUrl && (
          <img src={dataUrl} alt="badge" className="mt-3 w-full rounded-2xl shadow-lg ring-1 ring-slate-900/10" />
        )}

        <button
          onClick={save}
          disabled={!dataUrl}
          className={`mt-4 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-all active:scale-[0.98] disabled:opacity-50 ${
            saved ? 'bg-green-600' : 'bg-slate-900 hover:bg-slate-800'
          }`}
        >
          {saved ? <Check className="h-4 w-4" /> : <Download className="h-4 w-4" />}
          {saved ? (zh ? '已保存' : 'Saved') : (zh ? '保存图片(发朋友圈)' : 'Save image (share it!)')}
        </button>
        <p className="mt-2 text-center text-[11px] text-slate-400">
          {zh ? '保存后即可分享到朋友圈 / WhatsApp Status' : 'Share to WeChat Moments / WhatsApp Status'}
        </p>
      </div>
    </div>
  )
}
