/**
 * CollabIdentityGate(S2 客户身份门)—— 客户打开 /t/:code 进带看前先填称呼
 * (名字必填,电话 / WhatsApp·微信选填,不强制登录)。填完才连 WS 进带看,
 * 让意向报告能把行为归属到人、经纪能跟进有兴趣的客户。
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { UserRound, ArrowRight } from 'lucide-react'

export default function CollabIdentityGate({ presenterName, defaultName, onEnter }: {
  presenterName?: string
  defaultName?: string
  onEnter: (name: string, phone: string, whatsapp: string) => void
}) {
  const { i18n } = useTranslation()
  const zh = (i18n.language || 'en').startsWith('zh')
  const L = (a: string, b: string) => (zh ? a : b)
  const [name, setName] = useState(defaultName || '')
  const [phone, setPhone] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const canEnter = name.trim().length > 0

  const submit = () => { if (canEnter) onEnter(name.trim(), phone.trim(), whatsapp.trim()) }

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-teal-500 to-emerald-500 text-white">
            <UserRound className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-bold text-slate-900">
              {presenterName ? L(`加入 ${presenterName} 的带看`, `Join ${presenterName}'s tour`) : L('加入实时带看', 'Join the live tour')}
            </h3>
            <p className="text-xs text-slate-500">{L('填个称呼即可进入,无需注册', 'Just your name to enter — no signup')}</p>
          </div>
        </div>

        <label className="block text-xs font-medium text-slate-600">{L('你的称呼', 'Your name')} <span className="text-rose-500">*</span></label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
          placeholder={L('如:陈先生', 'e.g. Mr. Chen')}
          className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-teal-400"
        />

        <div className="mt-3 grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs font-medium text-slate-500">{L('电话(选填)', 'Phone (optional)')}</label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
              inputMode="tel"
              placeholder="+971…"
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500">{L('微信/WhatsApp', 'WeChat/WhatsApp')}</label>
            <input
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
              placeholder={L('选填', 'optional')}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-400"
            />
          </div>
        </div>

        <button
          onClick={submit}
          disabled={!canEnter}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-40"
        >
          {L('进入带看', 'Enter tour')} <ArrowRight className="h-4 w-4" />
        </button>
        <p className="mt-2 text-center text-[11px] text-slate-400">
          {L('留下联系方式,方便顾问带看后为你跟进', 'Leave contact so the advisor can follow up')}
        </p>
      </div>
    </div>
  )
}
