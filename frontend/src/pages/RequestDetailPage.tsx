/**
 * /requests/:id —— 一条建议自己的页面（可分享的固定链接）。
 *
 * 为什么每条要有自己的页：一条建议是**可以被讨论、被引用、被发给别人看**的东西。
 * 只能在列表里就地展开的话，它就没有地址 —— 没法在微信里发给同事说「你也去顶一下」，
 * 也没法在日记里回链「这条是 xx 提的」。有了地址，讨论才立得住。
 *
 * 复用 RequestCard（列表和详情长同一个样，用户不用重新认一次界面），
 * 只是这里 defaultOpen 把楼层直接摊开 —— 点进来的人就是来看讨论的。
 */
import { useEffect, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Loader2, Link2, Check } from 'lucide-react'
import { useT, RequestCard, ComposeModal, ACCENT } from '../components/requests/shared'
import { useAuth } from '../contexts/AuthContext'
import { fetchFeatureRequest, type FeatureRequest } from '../lib/featureRequestApi'

export default function RequestDetailPage() {
  const { t } = useT()
  const { id } = useParams<{ id: string }>()
  const { user, isAdmin } = useAuth()
  const [req, setReq] = useState<FeatureRequest | null | 'loading'>('loading')
  const [composeOpen, setComposeOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const n = Number(id)
    if (!Number.isFinite(n)) { setReq(null); return }
    setReq('loading')
    fetchFeatureRequest(n).then(setReq)
  }, [id])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* 权限/非安全上下文:静默,按钮不动就是没成功 */ }
  }

  return (
    <div className="flex-1 overflow-y-auto bg-white text-slate-700">
      <Helmet>
        {/* 标题用建议本身 —— 分享到微信/Slack 时预览卡才有意义 */}
        <title>{req && req !== 'loading' ? `${req.title} | Pinzos` : `${t('misc:changelog.requestsTitle')} | Pinzos`}</title>
        {req && req !== 'loading' && req.body && <meta name="description" content={req.body.slice(0, 160)} />}
        <link rel="canonical" href={`https://www.pinzos.com/requests/${id}`} />
      </Helmet>

      {composeOpen && (
        <ComposeModal onClose={() => setComposeOpen(false)} onCreated={() => { /* 详情页不维护列表 */ }} />
      )}

      <div className="mx-auto max-w-3xl px-5 py-10 sm:px-6 md:py-14">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link to="/requests"
            className="inline-flex items-center gap-1.5 text-sm text-slate-400 transition hover:text-slate-700">
            <ArrowLeft className="h-3.5 w-3.5 rtl:-scale-x-100" />
            {t('misc:changelog.requestsTitle')}
          </Link>

          {req && req !== 'loading' && (
            <button type="button" onClick={copy}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 ring-1 ring-slate-200 transition hover:bg-slate-50 hover:text-slate-800">
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Link2 className="h-3.5 w-3.5" />}
              {t(copied ? 'misc:changelog.copied' : 'misc:changelog.share')}
            </button>
          )}
        </div>

        <div className="mt-6">
          {req === 'loading' ? (
            <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-slate-300" /></div>
          ) : req === null ? (
            <div className="rounded-2xl border border-dashed border-slate-200 py-14 text-center">
              <p className="text-[15px] font-medium text-slate-700">{t('misc:changelog.notFound')}</p>
              <p className="mt-1 text-sm text-slate-400">{t('misc:changelog.notFoundSub')}</p>
              <Link to="/requests"
                className="mt-5 inline-flex rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:opacity-90"
                style={{ background: ACCENT }}>
                {t('misc:changelog.backToAll')}
              </Link>
            </div>
          ) : (
            <ul>
              {/* 复用列表那张卡:同一个界面,不用重新认。楼层直接摊开 —— 点进来就是来看讨论的 */}
              <RequestCard
                r={req}
                user={!!user}
                isAdmin={!!isAdmin}
                onPatch={(r) => setReq(r)}
                onNeedLogin={() => setComposeOpen(true)}
                defaultOpen
              />
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
