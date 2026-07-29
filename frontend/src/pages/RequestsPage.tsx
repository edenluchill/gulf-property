/**
 * /requests —— 功能建议板（独立一页）。
 *
 * 🔴 为什么独立成页，而不是挂在产品日记页尾：
 * owner 反复说过「建议不应该在底部」——把它塞在 54 条日记之后，用户为了提一句话
 * 得先滚过半年更新，也看不到别人提过没有。日记页现在只在 hero 放一张入口卡
 * （「大家在提什么」），点进来就是这一页：浏览、发帖、点赞、跟帖，一个完整的地方。
 *
 * 深链：
 *   /requests?new=1   直接打开发帖弹窗（日记页那颗「提一个功能建议」走这条）
 *   /requests?r=123   滚到那一条并展开它的楼层（hero 卡片点某条走这条）
 */
import { useEffect, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { Link, useSearchParams } from 'react-router-dom'
import { Lightbulb, ArrowLeft } from 'lucide-react'
import {
  ACCENT, useT, ComposeModal, RequestsBoard, fetchFeatureRequests, type FeatureRequest,
} from '../components/requests/shared'

export default function RequestsPage() {
  const { t } = useT()
  const [params, setParams] = useSearchParams()
  const [list, setList] = useState<FeatureRequest[] | null>(null)
  const [composeOpen, setComposeOpen] = useState(params.get('new') === '1')

  useEffect(() => { fetchFeatureRequests().then(setList) }, [])

  const focusId = Number(params.get('r')) || null

  // 关掉弹窗时把 ?new=1 擦掉 —— 否则刷新/后退又弹一次
  const closeCompose = () => {
    setComposeOpen(false)
    if (params.get('new')) {
      const n = new URLSearchParams(params)
      n.delete('new')
      setParams(n, { replace: true })
    }
  }

  const title = t('misc:changelog.requestsTitle')

  return (
    <div className="flex-1 overflow-y-auto bg-white text-slate-700">
      <Helmet>
        <title>{title} | Pinzos</title>
        <meta name="description" content={t('misc:changelog.requestsIntro')} />
        <link rel="canonical" href="https://www.pinzos.com/requests" />
      </Helmet>

      {composeOpen && (
        <ComposeModal
          onClose={closeCompose}
          onCreated={(r) => setList((p) => [r, ...(p || [])])}
        />
      )}

      <div className="mx-auto max-w-3xl px-5 py-10 sm:px-6 md:py-14">
        <Link to="/changelog"
          className="-my-2 inline-flex min-h-[40px] items-center gap-1.5 py-2 text-sm text-slate-400 transition hover:text-slate-700">
          <ArrowLeft className="h-3.5 w-3.5 rtl:-scale-x-100" />
          {t('misc:changelog.title')}
        </Link>

        <div className="mt-5 flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-500">
              <Lightbulb className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
              <p className="mt-0.5 max-w-xl text-sm leading-relaxed text-slate-500">
                {t('misc:changelog.requestsIntro')}
              </p>
            </div>
          </div>
          <button type="button" onClick={() => setComposeOpen(true)}
            className="inline-flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:opacity-90 active:scale-95"
            style={{ background: ACCENT }}>
            <Lightbulb className="h-4 w-4" />
            {t('misc:changelog.requestCta')}
          </button>
        </div>

        <div className="mt-7">
          <RequestsBoard list={list} setList={setList} focusId={focusId}
            onCompose={() => setComposeOpen(true)} />
        </div>
      </div>
    </div>
  )
}
