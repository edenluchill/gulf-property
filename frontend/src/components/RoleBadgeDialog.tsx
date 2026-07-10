/**
 * RoleBadgeDialog — 「我的认证证书」:预览浅色烫金奖状 + 一键保存分享。
 * canvas 生成 1080×1350 PNG(drawCertificate),含真名 + 头像 + 证书编号,零依赖。
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
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
    // 电影感揭幕:极暗聚光背景 + 金色光晕 + 入场动画 + 一次性扫光
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[1300] flex flex-col items-center justify-center overflow-y-auto px-4 py-8"
      style={{ background: 'radial-gradient(120% 90% at 50% 40%, #12121c 0%, #08080d 60%, #050507 100%)' }}
      onClick={onClose}
    >
      {/* 金色聚光光晕 */}
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.8 }}
        className="pointer-events-none absolute left-1/2 top-[42%] h-[70vh] w-[70vh] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[90px]"
        style={{ background: 'radial-gradient(circle, rgba(199,160,80,0.28), rgba(199,160,80,0.06) 45%, transparent 70%)' }}
      />

      {/* 关闭 */}
      <button onClick={onClose} className="absolute right-4 top-4 z-10 rounded-full p-2 text-white/40 transition hover:bg-white/10 hover:text-white/80">
        <X className="h-5 w-5" />
      </button>

      <div className="relative flex w-full max-w-3xl flex-col items-center" onClick={(e) => e.stopPropagation()}>
        {/* 眉标 */}
        <motion.div
          initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
          className="mb-4 text-center"
        >
          <div className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[#C7A050]">
            {celebrate ? (zh ? '认证已颁发' : 'Certificate Issued') : (zh ? '官方认证证书' : 'Official Certificate')}
          </div>
          {celebrate && (
            <div className="mt-1 text-lg font-bold text-white">
              {zh ? '恭喜,你已获得官方认证 🎉' : 'Congratulations — you’re officially certified 🎉'}
            </div>
          )}
        </motion.div>

        {/* 证书舞台 */}
        <canvas ref={canvasRef} className="hidden" />
        <div className="relative w-full overflow-hidden rounded-lg">
          {dataUrl ? (
            <>
              <motion.img
                key={dataUrl}
                src={dataUrl}
                alt="certificate"
                initial={{ opacity: 0, scale: 0.92, y: 24 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 120, damping: 18 }}
                className="w-full rounded-lg shadow-[0_40px_120px_-20px_rgba(0,0,0,0.8)] ring-1 ring-[#C7A050]/25"
              />
              {/* 一次性金色扫光 */}
              <motion.div
                key={`sheen-${dataUrl}`}
                initial={{ x: '-130%' }} animate={{ x: '130%' }}
                transition={{ delay: 0.5, duration: 1, ease: 'easeInOut' }}
                className="pointer-events-none absolute inset-y-0 w-1/2 -skew-x-12"
                style={{ background: 'linear-gradient(105deg, transparent, rgba(255,255,255,0.35), transparent)' }}
              />
            </>
          ) : (
            <div className="flex aspect-[1.42/1] w-full items-center justify-center rounded-lg bg-white/[0.03] ring-1 ring-white/10">
              <Loader2 className="h-7 w-7 animate-spin text-white/30" />
            </div>
          )}
        </div>

        {/* 操作(浮于暗底,克制精致)*/}
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}
          className="mt-6 flex w-full max-w-sm flex-col items-center gap-2"
        >
          <button
            onClick={save}
            disabled={!dataUrl}
            className={`flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-bold shadow-lg transition-all active:scale-[0.98] disabled:opacity-40 ${
              saved ? 'bg-emerald-500 text-white' : 'text-[#1C2B4A]'
            }`}
            style={saved ? undefined : { background: 'linear-gradient(180deg, #EBD592, #C7A050)' }}
          >
            {saved ? <Check className="h-4 w-4" /> : <Download className="h-4 w-4" />}
            {saved ? (zh ? '已保存' : 'Saved') : (zh ? '保存图片' : 'Save image')}
          </button>
          <p className="text-center text-[11px] text-white/40">
            {zh ? '保存后即可分享到朋友圈 / WhatsApp Status' : 'Share to WeChat Moments / WhatsApp Status'}
          </p>
        </motion.div>
      </div>
    </motion.div>
  )
}
