/**
 * 开发商验证入口 (2026-07-11) — 经纪台顶部,只对 role=developer 且未验证的人显示。
 *
 * 自助试用所有角色都是 7 天 / 200 积分(否则经纪会为了拿 30 天去冒充开发商)。
 * 开发商提交公司信息 → owner 验证 → 试用换成 30 天 / 600 积分(楼书 40 分/份 ≈ 15 份)。
 *
 * 为什么值得给开发商这个待遇:他们提供的是**供给**(楼盘/户型/付款计划),
 * 那是买家和经纪来这儿的理由。先把他们喂饱、用习惯。
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BadgeCheck, Clock, Loader2 } from 'lucide-react'
import { requestDeveloperVerification, type BillingMe } from '../lib/billingApi'

export default function DeveloperVerifyCard({ me, onDone }: { me: BillingMe; onDone?: () => void }) {
  const { i18n } = useTranslation()
  const zh = !!i18n.language?.startsWith('zh')
  const L = (a: string, b: string) => (zh ? a : b)

  const [open, setOpen] = useState(false)
  const [company, setCompany] = useState('')
  const [website, setWebsite] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  // 只给开发商看;已验证 → 不再打扰
  if (me.role !== 'developer' || me.developer?.verified) return null

  const status = me.developer?.verification
  const pending = status === 'pending' || sent

  if (pending) {
    return (
      <div className="mb-4 flex items-center gap-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
        <Clock className="h-4 w-4 shrink-0 text-sky-500" />
        <span>
          <b>{L('开发商验证审核中', 'Developer verification under review')}</b>
          {' · '}
          {L('通过后试用自动延长到 30 天,积分池提升到 600(楼书解析 40 分/份)。',
             'Once approved your trial extends to 30 days with a 600-credit pool.')}
        </span>
      </div>
    )
  }

  async function submit() {
    if (!company.trim()) { setErr(L('请填写公司名称', 'Company name required')); return }
    setBusy(true); setErr(null)
    const e = await requestDeveloperVerification({ company: company.trim(), website: website.trim(), note: note.trim() })
    setBusy(false)
    if (e) { setErr(e); return }
    setSent(true)
    onDone?.()
  }

  return (
    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-amber-900">
        <BadgeCheck className="h-4 w-4 shrink-0 text-amber-500" />
        <span className="flex-1">
          <b>{L('开发商可申请 30 天试用', 'Developers can get a 30-day trial')}</b>
          {' · '}
          {L('验证公司身份后,试用从 7 天延到 30 天,积分池 200 → 600(足够传约 15 份楼书)。',
             'Verify your company and your trial goes from 7 to 30 days, with credits from 200 to 600 (≈15 brochures).')}
        </span>
        {!open && (
          <button onClick={() => setOpen(true)}
            className="rounded-lg bg-amber-600 px-3 py-1.5 text-[13px] font-semibold text-white transition hover:bg-amber-700">
            {L('申请验证', 'Get verified')}
          </button>
        )}
      </div>

      {open && (
        <div className="mt-3 space-y-2 border-t border-amber-200 pt-3">
          <input
            value={company} onChange={(e) => setCompany(e.target.value)}
            placeholder={L('公司名称(必填)', 'Company name (required)')}
            className="w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm outline-none focus:border-amber-400"
          />
          <input
            value={website} onChange={(e) => setWebsite(e.target.value)}
            placeholder={L('官网或项目页(便于我们核实)', 'Website or project page (helps us verify)')}
            className="w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm outline-none focus:border-amber-400"
          />
          <textarea
            value={note} onChange={(e) => setNote(e.target.value)} rows={2}
            placeholder={L('补充说明(可选):你想上架哪些项目?', 'Anything else (optional): which projects do you want to list?')}
            className="w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm outline-none focus:border-amber-400"
          />
          {err && <p className="text-xs text-rose-600">{err}</p>}
          <div className="flex gap-2">
            <button onClick={submit} disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-[13px] font-semibold text-white transition hover:bg-amber-700 disabled:opacity-60">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {L('提交申请', 'Submit')}
            </button>
            <button onClick={() => setOpen(false)}
              className="rounded-lg px-3 py-1.5 text-[13px] text-amber-800 transition hover:bg-amber-100">
              {L('稍后', 'Later')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
