/**
 * 经纪台「使用记录」tab(route: /agent/usage)。付费后才在侧栏显示(ProfileShell 条件渲染)。
 *
 * 本月额度能量条(/usage) + 逐笔积分流水(/ledger)。
 * 席位成员只看自己;团队 owner 看整个共享池(多一列"操作人")。
 * 历史不可回填 —— 只从流水表上线起记录。
 */
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Receipt, ExternalLink, Radio, Sparkles, FileText, FileBarChart, Users } from 'lucide-react'
import { lunaFetch, fetchLedger, type LedgerEntry, type LedgerFeature } from '../lunaApi'

// feature → 图标 + 双语名(后端 features 目录只给中文 label,英文在这里补)
const FEATURE_META: Record<string, { icon: typeof Receipt; en: string }> = {
  reports: { icon: FileText, en: 'Buyer proposal' },
  brochures: { icon: FileBarChart, en: 'Brochure parsing' },
  live_tours: { icon: Radio, en: 'Live tour' },
  luna_tours: { icon: Sparkles, en: 'Luna AI tour' },
  payplan: { icon: Receipt, en: 'Sales offer' },
}

// ref_type → 可点回的公开链接(没有的类型不给链接)
function refHref(e: LedgerEntry): string | null {
  if (!e.ref_id) return null
  switch (e.ref_type) {
    case 'project_report': return `/r/${e.ref_id}`
    case 'client_report': return `/cr/${e.ref_id}`
    case 'payplan': return `/pp/${e.ref_id}`
    case 'tour': return `/?toursession=${e.ref_id}`
    default: return null
  }
}

interface Balance { creditsMonth: number; used: number; balance: number; plan: string; status: string; owner?: boolean }

export default function AgentUsage() {
  const { t: tRaw, i18n } = useTranslation('lunaTour')
  const t = tRaw as (k: string, o?: Record<string, unknown>) => string
  const zh = !!i18n.language?.startsWith('zh')

  const [bal, setBal] = useState<Balance | null>(null)
  const [entries, setEntries] = useState<LedgerEntry[]>([])
  const [features, setFeatures] = useState<LedgerFeature[]>([])
  const [pool, setPool] = useState(false)
  const [filter, setFilter] = useState<string>('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    lunaFetch('/usage').then((r) => r.json()).then(setBal).catch(() => {})
  }, [])
  useEffect(() => {
    setLoading(true)
    fetchLedger(filter || undefined)
      .then((d) => { setEntries(d.entries || []); setFeatures(d.features || []); setPool(!!d.pool) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [filter])

  const featLabel = (key: string) => {
    const zhLabel = features.find((f) => f.key === key)?.label || key
    return zh ? zhLabel : (FEATURE_META[key]?.en || zhLabel)
  }

  const unlimited = (bal?.creditsMonth ?? 0) < 0
  const pct = useMemo(() => {
    if (!bal || unlimited || bal.creditsMonth === 0) return 0
    return Math.min(100, Math.round((bal.used / bal.creditsMonth) * 100))
  }, [bal, unlimited])

  const fmtTime = (iso: string) => {
    const d = new Date(iso)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  }

  return (
    <div className="max-w-6xl">   {/* 表格页放宽,理由同 AgentClients */}
      <h1 className="mb-1 text-2xl font-bold text-slate-900">{t('lunaTour:usageHistory')}</h1>
      <p className="mb-6 text-sm text-slate-500">
        {t('lunaTour:everyCreditYouSpend')}
        {pool && ' ' + t('lunaTour:sharedTeamPoolAll')}
      </p>

      {/* 本月额度能量条 */}
      <div className="mb-6 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-900/[0.06]">
        <div className="mb-1 flex items-baseline justify-between">
          <span className="text-sm text-slate-500">{t('lunaTour:creditsThisMonth2')}</span>
          <span className="text-sm font-semibold text-slate-900">
            {unlimited
              ? t('lunaTour:unlimited4')
              : <>{t('lunaTour:k2')} <b className="text-emerald-600">{(bal?.balance ?? 0).toLocaleString()}</b> / {(bal?.creditsMonth ?? 0).toLocaleString()}</>}
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-1 text-[11px] text-slate-400">{t('lunaTour:resetsOnThe1st2')}</div>
      </div>

      {/* feature 筛选 */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        <FilterChip active={filter === ''} onClick={() => setFilter('')}>{t('lunaTour:all2')}</FilterChip>
        {Object.keys(FEATURE_META).map((k) => (
          <FilterChip key={k} active={filter === k} onClick={() => setFilter(k)}>{featLabel(k)}</FilterChip>
        ))}
      </div>

      {/* 流水 */}
      {loading ? (
        <div className="py-10 text-center text-sm text-slate-400">{t('lunaTour:loading3')}</div>
      ) : entries.length === 0 ? (
        <div className="rounded-2xl bg-white p-10 text-center shadow-sm ring-1 ring-slate-900/[0.06]">
          <Receipt className="mx-auto mb-2 h-8 w-8 text-slate-300" />
          <div className="text-sm text-slate-500">{t('lunaTour:noUsageYet')}</div>
          <div className="mt-1 text-xs text-slate-400">{t('lunaTour:generateATourOffer')}</div>
        </div>
      ) : (
        <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/[0.06]">
          {entries.map((e) => {
            const Icon = FEATURE_META[e.feature]?.icon || Receipt
            const href = refHref(e)
            return (
              <div key={e.id} className="flex items-center gap-3 px-4 py-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-slate-800">{featLabel(e.feature)}</span>
                    {e.ref_label && <span className="truncate text-xs text-slate-400">· {e.ref_label}</span>}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-400">
                    <span>{fmtTime(e.created_at)}</span>
                    {pool && e.actor_name && (
                      <span className="inline-flex items-center gap-0.5"><Users className="h-3 w-3" />{e.actor_name}</span>
                    )}
                  </div>
                </div>
                {href && (
                  <a href={href} target="_blank" rel="noreferrer" title={t('lunaTour:open3')}
                     className="shrink-0 rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50">
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
                <span className={`shrink-0 text-sm font-semibold ${e.credits > 0 ? 'text-slate-700' : 'text-slate-300'}`}>
                  {e.credits > 0 ? `-${e.credits}` : '0'}
                </span>
              </div>
            )
          })}
        </div>
      )}

      <p className="mt-3 text-[11px] text-slate-400">
        {t('lunaTour:historyStartsWhenThis')}
      </p>
    </div>
  )
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${active ? 'bg-ink-800 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
      {children}
    </button>
  )
}
