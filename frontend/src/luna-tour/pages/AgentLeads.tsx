/**
 * 经纪台「线索」tab(route: /agent/leads)—— 共享线索池 + 认领。
 *
 * 单一经纪公司运营,不做自动分发:未认领的线索所有经纪可见,认领归自己,
 * 再「转为客户」进 CRM(客户雷达)。数据源 leads 表(behavior-to-lead 引擎产)。
 */
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Inbox, Flame, Phone, Mail, MessageCircle, MapPin, Eye, Sparkles, UserPlus, Hand, Undo2, Loader2 } from 'lucide-react'
import { fetchLeads, claimLead, releaseLead, convertLead, type Lead } from '../lunaApi'

const heatTone = (h: number) => (h >= 70 ? 'text-red-500' : h >= 40 ? 'text-amber-500' : 'text-slate-400')

export default function AgentLeads() {
  const { t: tRaw } = useTranslation('lunaTour')
  const t = tRaw as (k: string, o?: Record<string, unknown>) => string
  const navigate = useNavigate()

  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<number | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    fetchLeads().then(setLeads).catch(() => setLeads([])).finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  const onClaim = async (l: Lead) => {
    setBusy(l.id)
    const ok = await claimLead(l.id)
    setBusy(null)
    if (!ok) { alert(t('lunaTour:thisLeadWasJust')); load(); return }
    load()
  }
  const onRelease = async (l: Lead) => {
    setBusy(l.id); await releaseLead(l.id); setBusy(null); load()
  }
  const onConvert = async (l: Lead) => {
    setBusy(l.id)
    const clientId = await convertLead(l.id)
    setBusy(null)
    if (!clientId) { alert(t('lunaTour:convertFailedTryAgain')); load(); return }
    navigate('/agent/clients')
  }

  const contact = (l: Lead) => l.email || l.phone || l.whatsapp
  const intentChips = (l: Lead) => {
    const it = l.intent || {}
    const chips: { icon: typeof MapPin; text: string }[] = []
    if (it.areas?.length) chips.push({ icon: MapPin, text: it.areas.slice(0, 2).join(' / ') })
    if (it.property_views) chips.push({ icon: Eye, text: t('lunaTour:views2', { it_property_views: it.property_views }) })
    if (it.opened_luna) chips.push({ icon: Sparkles, text: t('lunaTour:usedLuna') })
    return chips
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-slate-900">{t('lunaTour:leads')}</h1>
        <p className="text-sm text-slate-500">
          {t('lunaTour:visitorsWhoLeftContact')}
        </p>
      </div>

      {loading ? (
        <div className="py-10 text-center text-sm text-slate-400">{t('lunaTour:loading')}</div>
      ) : leads.length === 0 ? (
        <div className="rounded-2xl bg-white p-10 text-center shadow-sm ring-1 ring-slate-900/[0.06]">
          <Inbox className="mx-auto mb-2 h-8 w-8 text-slate-300" />
          <div className="text-sm text-slate-500">{t('lunaTour:noLeadsYet')}</div>
          <div className="mt-1 text-xs text-slate-400">
            {t('lunaTour:leadsAppearAutomaticallyWhen')}
          </div>
        </div>
      ) : (
        <div className="space-y-2.5">
          {leads.map((l) => {
            const mine = !!l.assigned_agent_id
            return (
              <div key={l.id} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-900/[0.06]">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-teal-100 to-emerald-100 text-sm font-semibold text-teal-700">
                    {(l.name || contact(l) || '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-semibold text-slate-800">{l.name || t('lunaTour:anonymous')}</span>
                      {mine && <span className="rounded-full bg-teal-50 px-1.5 py-0.5 text-[10px] font-medium text-teal-600">{t('lunaTour:claimed')}</span>}
                      <span className="ms-auto inline-flex items-center gap-1">
                        <Flame className={`h-4 w-4 ${heatTone(l.lead_score)}`} />
                        <span className={`text-base font-bold ${heatTone(l.lead_score)}`}>{l.lead_score}</span>
                      </span>
                    </div>
                    {/* 联系方式 */}
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                      {l.phone && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{l.phone}</span>}
                      {l.whatsapp && <span className="inline-flex items-center gap-1"><MessageCircle className="h-3 w-3" />{l.whatsapp}</span>}
                      {l.email && <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" />{l.email}</span>}
                      {!contact(l) && <span className="text-slate-400">{t('lunaTour:noContactBehaviorOnly')}</span>}
                    </div>
                    {/* 意向 chips */}
                    {intentChips(l).length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {intentChips(l).map((c, i) => (
                          <span key={i} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
                            <c.icon className="h-3 w-3" />{c.text}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                {/* 操作 */}
                <div className="mt-3 flex items-center justify-end gap-2 border-t border-slate-50 pt-3">
                  {!mine ? (
                    <button onClick={() => onClaim(l)} disabled={busy === l.id}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:opacity-60">
                      {busy === l.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Hand className="h-4 w-4" />}{t('lunaTour:claim')}
                    </button>
                  ) : (
                    <>
                      <button onClick={() => onRelease(l)} disabled={busy === l.id}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-500 transition hover:bg-slate-50 disabled:opacity-60">
                        <Undo2 className="h-4 w-4" />{t('lunaTour:release')}
                      </button>
                      <button onClick={() => onConvert(l)} disabled={busy === l.id}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-teal-500 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-teal-600 disabled:opacity-60">
                        {busy === l.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}{t('lunaTour:toClient')}
                      </button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
