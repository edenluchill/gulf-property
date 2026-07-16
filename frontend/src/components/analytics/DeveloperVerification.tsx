/**
 * 开发商验证审批 (2026-07-11) — /admin/analytics 的「开发商验证」tab。
 *
 * 批准 = 换发一条 30 天 / 600 积分的新试用 + 落 developer 角色(楼书上传的前提)。
 * 自助试用是所有角色统一的 7 天 / 200 分 —— 若开发商能自助拿 30 天,
 * 所有经纪都会去选「我是开发商」。所以这道人工门是有意为之。
 */
import { useEffect, useState } from 'react'
import { Check, X, Loader2, ExternalLink, BadgeCheck } from 'lucide-react'
import {
  fetchDeveloperVerifications, decideDeveloperVerification,
  type DeveloperVerification as Row,
} from '../../lib/billingApi'

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: '待审', cls: 'bg-amber-50 text-amber-600' },
  approved: { label: '已验证', cls: 'bg-emerald-50 text-emerald-600' },
  rejected: { label: '已拒', cls: 'bg-slate-100 text-slate-400' },
}

const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }) : '—'

export default function DeveloperVerification() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = () => fetchDeveloperVerifications().then((r) => { setRows(r); setLoading(false) })
  useEffect(() => { void load() }, [])

  async function act(id: number, action: 'approve' | 'reject') {
    setBusy(id); setErr(null)
    const e = await decideDeveloperVerification(id, action)
    if (e) setErr(e)
    await load()
    setBusy(null)
  }

  const pending = rows.filter((r) => r.status === 'pending')

  if (loading) {
    return <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-teal-500" /></div>
  }

  return (
    <div className="space-y-4">
      {err && <div className="rounded-lg bg-rose-50 px-4 py-2 text-xs text-rose-600">{err}</div>}

      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/[0.06]">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-800">
            开发商验证 {pending.length > 0 && <span className="text-amber-600">({pending.length} 待审)</span>}
          </h3>
          <span className="text-xs text-slate-400">批准 = 30 天试用 + 600 积分(自助只有 7 天 / 200 分)</span>
        </div>

        {rows.length === 0 ? (
          <p className="px-4 py-6 text-xs text-slate-400">还没有开发商提交验证申请。</p>
        ) : (
          <div className="divide-y divide-slate-50">
            {rows.map((r) => {
              const st = STATUS[r.status] || STATUS.pending
              return (
                <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-500 to-orange-500 text-sm font-semibold text-white">
                    {(r.company || r.email || 'D').charAt(0).toUpperCase()}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-slate-800">{r.company}</span>
                      {r.website && (
                        <a href={r.website.startsWith('http') ? r.website : `https://${r.website}`}
                          target="_blank" rel="noreferrer"
                          className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-teal-600 hover:underline">
                          官网 <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      )}
                    </div>
                    <div className="truncate text-xs text-slate-400">{r.email}</div>
                    {r.note && <div className="mt-0.5 truncate text-[11px] text-slate-400">“{r.note}”</div>}
                  </div>

                  <div className="hidden w-28 shrink-0 text-end text-[11px] text-slate-400 md:block">
                    {r.status === 'approved' && r.trial_ends_at ? (
                      <>试用至 {fmtDate(r.trial_ends_at)}<br />{r.trial_credits} 积分</>
                    ) : (
                      <>申请于 {fmtDate(r.created_at)}</>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${st.cls}`}>
                      {r.status === 'approved' && <BadgeCheck className="me-0.5 inline h-3 w-3" />}
                      {st.label}
                    </span>
                    {r.status === 'pending' && (
                      <div className="flex gap-1">
                        <button disabled={busy === r.id} onClick={() => act(r.id, 'approve')}
                          className="flex items-center gap-0.5 rounded-lg bg-emerald-500 px-2 py-1 text-[11px] font-medium text-white hover:bg-emerald-600 disabled:opacity-50">
                          <Check className="h-3 w-3" />批
                        </button>
                        <button disabled={busy === r.id} onClick={() => act(r.id, 'reject')}
                          className="flex items-center gap-0.5 rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-200 disabled:opacity-50">
                          <X className="h-3 w-3" />拒
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <p className="px-1 text-[11px] leading-relaxed text-slate-400">
        为什么要人工验证:/choose-role 上人人都能点「我是开发商」。若开发商自助就能拿 30 天而经纪只有 7 天,
        所有经纪都会去点开发商。批准是把试用**换发**成 30 天 / 600 积分(从批准日起算),并落 developer 角色
        —— 那是楼书上传权限的前提。拒绝不会动他现有的 7 天试用。
      </p>
    </div>
  )
}
