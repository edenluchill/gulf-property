/**
 * RoleBadgeDialog — 「我的认证证书」:预览浅色烫金奖状 + 一键保存分享。
 * canvas 生成 1080×1350 PNG(drawCertificate),含真名 + 头像 + 证书编号,零依赖。
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Download, Check, Loader2 } from 'lucide-react'
import { RoleBadge, drawCertificate } from '../lib/roleBadge'
import { lunaFetch, registerCertificate } from '../luna-tour/lunaApi'

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
  // 证书用经纪名片的真名 + 头像(比 Google metadata 更正式);拿不到就退回传入的 name。
  const [profile, setProfile] = useState<{ name?: string; photoUrl?: string | null }>({})
  // 登记可验证凭证 → 拿到 credentialId(证书二维码指向 /verify/:id)
  const [credentialId, setCredentialId] = useState<string | undefined>(undefined)
  useEffect(() => {
    let stale = false
    lunaFetch('/profile').then((r) => r.json()).then((j) => {
      if (stale || !j?.agent) return
      setProfile({ name: j.agent.display_name || undefined, photoUrl: j.agent.photo_url || null })
    }).catch(() => {})
    registerCertificate().then((id) => { if (!stale && id) setCredentialId(id) }).catch(() => {})
    return () => { stale = true }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let stale = false
    void drawCertificate(canvas, badge, { name: profile.name || name, zh, photoUrl: profile.photoUrl, credentialId })
      .then(() => { if (!stale) { try { setDataUrl(canvas.toDataURL('image/png')) } catch { /* tainted */ } } })
    return () => { stale = true }
  }, [badge, name, zh, profile.name, profile.photoUrl, credentialId])

  const save = () => {
    if (!dataUrl) return
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = `pinzos-certificate-${badge.planId}.png`
    a.click()
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  return (
    <div className="fixed inset-0 z-[1300] flex items-center justify-center overflow-y-auto bg-slate-950/75 p-4 backdrop-blur-md" onClick={onClose}>
      <div className="my-auto w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/10" onClick={(e) => e.stopPropagation()}>
        {/* 精致标题栏(克制,不抢证书):一条酒红细线点题 */}
        <div className="relative border-b border-slate-100 px-6 py-4">
          <div className="absolute inset-x-0 top-0 h-0.5" style={{ background: '#6E1518' }} />
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate text-[17px] font-bold text-slate-900">
                {celebrate ? (zh ? '认证已颁发 🎉' : 'Certificate issued 🎉') : (zh ? '我的认证证书' : 'My certificate')}
              </h3>
              <p className="mt-0.5 truncate text-xs text-slate-500">
                {celebrate
                  ? (zh ? '晒出你的官方认证,让客户第一时间认可你' : 'Show off your official certification to clients')
                  : (zh ? '保存后即可分享给客户 / 朋友圈' : 'Save it to share with clients')}
              </p>
            </div>
            <button onClick={onClose} className="shrink-0 rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* 证书预览(大图,暖灰底衬托纸质) */}
        <div className="bg-slate-100/70 px-6 py-6">
          <canvas ref={canvasRef} className="hidden" />
          {dataUrl ? (
            <img src={dataUrl} alt="certificate" className="mx-auto w-full rounded-md shadow-xl ring-1 ring-black/10" />
          ) : (
            <div className="mx-auto flex aspect-[1.42/1] w-full items-center justify-center rounded-md bg-white/60 ring-1 ring-black/5">
              <Loader2 className="h-6 w-6 animate-spin text-slate-300" />
            </div>
          )}
        </div>

        {/* 操作 */}
        <div className="border-t border-slate-100 p-4">
          <button
            onClick={save}
            disabled={!dataUrl}
            className={`flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white transition-all active:scale-[0.98] disabled:opacity-50 ${
              saved ? 'bg-emerald-600' : 'bg-slate-900 hover:bg-slate-800'
            }`}
          >
            {saved ? <Check className="h-4 w-4" /> : <Download className="h-4 w-4" />}
            {saved ? (zh ? '已保存' : 'Saved') : (zh ? '保存图片' : 'Save image')}
          </button>
          <p className="mt-2 text-center text-[11px] text-slate-400">
            {zh ? '保存后即可分享到朋友圈 / WhatsApp Status' : 'Share to WeChat Moments / WhatsApp Status'}
          </p>
        </div>
      </div>
    </div>
  )
}
