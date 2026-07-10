/**
 * 公开凭证验证页(route: /verify/:code)—— 证书二维码/链接的落地页,客户免登录。
 * 据 credential_id 查 lt_certificates,展示「✓ 有效凭证 · 持有人 · 称号 · 颁发日期」。
 * 无 app 导航的干净页(bareSharePage in Layout)。始终英文(与证书一致)。
 */
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { ShieldCheck, ShieldX, Loader2 } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000'

interface Cert { valid: boolean; credentialId?: string; holderName?: string; certTitle?: string; issuedAt?: string }

export default function VerifyPage() {
  const { code } = useParams<{ code: string }>()
  const [state, setState] = useState<'loading' | 'valid' | 'invalid'>('loading')
  const [cert, setCert] = useState<Cert | null>(null)

  useEffect(() => {
    if (!code) { setState('invalid'); return }
    fetch(`${API}/api/luna/public/certificate/${encodeURIComponent(code)}`)
      .then((r) => r.json())
      .then((j) => { if (j?.valid) { setCert(j); setState('valid') } else setState('invalid') })
      .catch(() => setState('invalid'))
  }, [code])

  const issued = cert?.issuedAt
    ? new Date(cert.issuedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : ''

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-lg ring-1 ring-slate-900/[0.06]">
        {/* 品牌条 */}
        <div className="flex items-center justify-center gap-2 border-b border-slate-100 py-4">
          <span className="text-lg font-bold tracking-[0.2em] text-[#1C2B4A]">PINZOS</span>
          <span className="text-[11px] font-medium uppercase tracking-wider text-[#B08A3C]">Credential Verification</span>
        </div>

        {state === 'loading' && (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-slate-400">
            <Loader2 className="h-7 w-7 animate-spin" />
            <span className="text-sm">Verifying credential…</span>
          </div>
        )}

        {state === 'invalid' && (
          <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-50">
              <ShieldX className="h-7 w-7 text-rose-500" />
            </div>
            <div className="text-lg font-bold text-slate-900">Credential not found</div>
            <p className="text-sm text-slate-500">
              We couldn’t verify a Pinzos credential with this ID{code ? ` (${code})` : ''}. It may be mistyped or no longer active.
            </p>
          </div>
        )}

        {state === 'valid' && cert && (
          <div className="px-6 py-10 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50">
              <ShieldCheck className="h-8 w-8 text-emerald-600" />
            </div>
            <div className="mt-3 text-sm font-semibold uppercase tracking-wider text-emerald-600">Verified Credential</div>
            <div className="mt-5 text-2xl font-bold text-[#1C2B4A]">{cert.holderName}</div>
            <div className="mt-1 text-base font-semibold text-[#B08A3C]">{cert.certTitle}</div>
            <div className="mx-auto my-5 h-px w-24 bg-slate-200" />
            <dl className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-slate-400">Credential ID</dt>
                <dd className="font-semibold text-slate-800">{cert.credentialId}</dd>
              </div>
              {issued && (
                <div className="flex items-center justify-between">
                  <dt className="text-slate-400">Issued</dt>
                  <dd className="font-semibold text-slate-800">{issued}</dd>
                </div>
              )}
              <div className="flex items-center justify-between">
                <dt className="text-slate-400">Issued by</dt>
                <dd className="font-semibold text-slate-800">Pinzos · Dubai Real Estate Certification</dd>
              </div>
            </dl>
            <p className="mt-6 text-[11px] text-slate-400">
              This confirms an active Pinzos platform certification for Dubai off-plan real estate.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
