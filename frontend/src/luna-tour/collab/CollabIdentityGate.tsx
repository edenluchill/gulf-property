/**
 * CollabIdentityGate(S2 客户身份门)—— 客户打开 /t/:code 进带看前先填称呼
 * (名字必填,电话 / WhatsApp·微信选填,不强制登录)。填完才连 WS 进带看,
 * 让意向报告能把行为归属到人、经纪能跟进有兴趣的客户。
 */
import { useEffect, useState } from 'react'

/**
 * 🔴 **填过一次就别再让他填第二遍。**
 *
 * owner:「客户上次进来看过、填过联系信息和名字,就不用才填一遍了,自动 autofill。」
 *
 * 客户被经纪拉进带看,常常是**同一个人反复进来**(这次看完、过两天再看一次、
 * 换个项目再来一次)。每次都从头填名字和电话,是在**用摩擦惩罚回头客** ——
 * 而回头客恰恰是最有意向的那批人。
 *
 * 存 localStorage(纯本地,不上传;客户随时能改)。
 */
const ID_KEY = 'pz-collab-identity'

interface SavedIdentity { name?: string; phone?: string; whatsapp?: string }

function loadIdentity(): SavedIdentity {
  try {
    return JSON.parse(localStorage.getItem(ID_KEY) || '{}') as SavedIdentity
  } catch { return {} }
}
function saveIdentity(v: SavedIdentity) {
  try { localStorage.setItem(ID_KEY, JSON.stringify(v)) } catch { /* 隐私模式 */ }
}
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
  const saved = loadIdentity()
  // 上次填过的自动带出来 —— 回头客不该被罚一遍摩擦
  const [name, setName] = useState(defaultName || saved.name || '')
  const [phone, setPhone] = useState(saved.phone || '')
  const [whatsapp, setWhatsapp] = useState(saved.whatsapp || '')
  const canEnter = name.trim().length > 0

  /**
   * 上次填过 → **直接进,不弹这个门**。
   *
   * (⚠️ 名字是必填项;有名字就足以进场。留在门口再点一次「进入」是纯粹的摩擦。)
   */
  const [autoEntered, setAutoEntered] = useState(false)
  useEffect(() => {
    if (autoEntered) return
    const s = loadIdentity()
    if (s.name && s.name.trim()) {
      setAutoEntered(true)
      onEnter(s.name.trim(), (s.phone || '').trim(), (s.whatsapp || '').trim())
    }
    // 只在挂载时判一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submit = () => {
    if (!canEnter) return
    const v = { name: name.trim(), phone: phone.trim(), whatsapp: whatsapp.trim() }
    saveIdentity(v)   // 下次直接进
    onEnter(v.name, v.phone, v.whatsapp)
  }

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
