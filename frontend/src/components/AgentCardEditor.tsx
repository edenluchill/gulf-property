import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Upload, Loader2, Check } from 'lucide-react'
import { lunaFetch } from '../luna-tour/lunaApi'
import { errText } from '../luna-tour/errText'

/** Modal: the agent's brand card — avatar upload + name/phone/whatsapp. */
export default function AgentCardEditor({ onClose }: { onClose: () => void }) {
  const { t: tRaw } = useTranslation('profile')
  const t = tRaw as (k: string, o?: Record<string, unknown>) => string
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [email, setEmail] = useState('')
  const [photo, setPhoto] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    lunaFetch('/profile').then((r) => r.json()).then((j) => {
      const a = j?.agent
      if (a) { setName(a.display_name || ''); setPhone(a.phone || ''); setWhatsapp(a.whatsapp || ''); setEmail(a.public_email || ''); setPhoto(a.photo_url || null) }
    }).catch(() => {})
  }, [])

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) { alert(t('agentCardEditor.badImageType')); return }
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', f)
      const r = await lunaFetch('/avatar', { method: 'POST', body: fd })
      const j = await r.json()
      if (j?.photoUrl) setPhoto(`${j.photoUrl}?t=${Date.now()}`)
      else alert(errText(j, 'profile:agentCardEditor.uploadFailed'))
    } catch { alert(t('agentCardEditor.uploadFailed')) } finally { setUploading(false) }
  }

  const save = async () => {
    setSaving(true)
    try {
      const r = await lunaFetch('/profile', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: name, phone, whatsapp, public_email: email }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { alert(errText(j, 'profile:agentCardEditor.saveFailed')); return }
      setSaved(true); setTimeout(onClose, 700)
    } catch { alert(t('agentCardEditor.saveFailed')) } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-900">{t('agentCardEditor.title')}</h3>
          <button onClick={onClose} className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>

        {/* Avatar */}
        <div className="mb-4 flex flex-col items-center gap-2">
          <button onClick={() => fileRef.current?.click()} className="group relative">
            {photo
              ? <img src={photo} alt="avatar" className="h-24 w-24 rounded-full object-cover ring-2 ring-teal-100" />
              : <div className="flex h-24 w-24 items-center justify-center rounded-full bg-slate-100 text-3xl font-bold text-slate-400">{(name || '?').slice(0, 1)}</div>}
            <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
              {uploading ? <Loader2 className="h-6 w-6 animate-spin text-white" /> : <Upload className="h-6 w-6 text-white" />}
            </div>
          </button>
          <button onClick={() => fileRef.current?.click()} className="text-xs font-medium text-teal-600">{uploading ? t('agentCardEditor.uploading') : t('agentCardEditor.uploadAvatar')}</button>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onPick} />
        </div>

        {/* Fields */}
        <div className="space-y-2.5">
          <Field label={t('agentCardEditor.name')} value={name} onChange={setName} placeholder={t('agentCardEditor.namePlaceholder')} />
          <Field label={t('agentCardEditor.phone')} value={phone} onChange={setPhone} placeholder="+971 50 123 4567" />
          <Field label="WhatsApp" value={whatsapp} onChange={setWhatsapp} placeholder={t('agentCardEditor.whatsappPlaceholder')} />
          <Field label={t('agentCardEditor.email')} value={email} onChange={setEmail} placeholder="you@agency.com" />
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
          {t('agentCardEditor.footnote')}
        </p>

        <button onClick={save} disabled={saving} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-teal-500 py-2.5 font-semibold text-white hover:bg-teal-600 disabled:opacity-60">
          {saved ? <><Check className="h-4 w-4" />{t('agentCardEditor.saved')}</> : saving ? t('agentCardEditor.saving') : t('agentCardEditor.save')}
        </button>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="text-xs text-slate-500">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100" />
    </label>
  )
}
