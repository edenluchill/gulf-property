import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Phone, MessageCircle, MapPin, Loader2, CalendarClock, BadgeCheck } from 'lucide-react'
import { PaymentPlan } from '../types'
import PaymentChart from '../components/project/PaymentChart'
import PaymentTimeline from '../components/project/PaymentTimeline'
import { formatMoneyCompact } from '../lib/money'
import DirhamSymbol from '../components/DirhamSymbol'
import { normalizePaymentPlan } from '../lib/paymentPlan'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000'

interface PayShareData {
  share: { unitName: string | null; bedrooms: number | null; price: number; lang: string; createdAt: string }
  project: {
    id: string; name: string; developer: string | null; area: string | null; status: string | null
    completionDate: string | null; handoverDate: string | null; image: string | null
    paymentPlan: PaymentPlan[]
  }
  agent: { name: string; photo: string | null; phone: string | null; whatsapp: string | null } | null
}

/**
 * 付款计划分享页(/pp/:code)——客户免登录查看。
 * 经纪在项目详情页选户型 + 填实际报价生成;页面语言跟随生成时的语言。
 * 无 app 导航(Layout 对 /pp/ 隐藏 chrome),干净、可转发、可截图。
 */
export default function PaymentPlanSharePage() {
  const { code } = useParams()
  const [d, setD] = useState<PayShareData | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading')

  useEffect(() => {
    fetch(`${API}/api/luna/public/payplan/${code}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j: PayShareData) => {
        setD(j); setState('ok')
        const zh2 = j.share?.lang !== 'en'
        if (j.project?.name) document.title = `${j.project.name} · ${zh2 ? '付款计划' : 'Payment Plan'}`
      })
      .catch(() => setState('error'))
  }, [code])

  if (state === 'loading') {
    return <div className="flex min-h-screen items-center justify-center bg-slate-50"><Loader2 className="h-8 w-8 animate-spin text-teal-500" /></div>
  }
  if (state === 'error' || !d) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-400">页面不存在或已失效 / This link is no longer available</div>
  }

  const { share, project, agent } = d
  const zh = share.lang !== 'en'
  const lang = zh ? 'zh' : 'en'
  const plan = normalizePaymentPlan(project.paymentPlan)
  const price = share.price
  const contactHref = agent?.whatsapp
    ? `https://wa.me/${agent.whatsapp.replace(/[^0-9]/g, '')}`
    : agent?.phone ? `tel:${agent.phone}` : undefined
  const bedsLabel = share.bedrooms != null
    ? (share.bedrooms === 0 ? (zh ? '工作室' : 'Studio') : zh ? `${share.bedrooms} 居` : `${share.bedrooms} BR`)
    : null
  const unitLabel = share.unitName || bedsLabel
  const quoteDate = share.createdAt ? String(share.createdAt).slice(0, 10) : ''

  return (
    <div className="min-h-screen bg-slate-50 pb-16 text-slate-900">
      {/* Hero:项目身份 */}
      <div className="relative h-48 w-full overflow-hidden bg-slate-800 sm:h-60">
        {project.image && <img src={project.image} alt={project.name} className="h-full w-full object-cover" />}
        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent" />
        {/* pb-12:给下方 -mt-7 上叠的报价卡留位,别盖住开发商名 */}
        <div className="absolute bottom-0 left-0 right-0 mx-auto max-w-xl px-5 pb-12 text-white">
          <div className="flex items-center gap-1.5 text-xs opacity-90"><MapPin className="h-3.5 w-3.5" />{project.area || (zh ? '迪拜' : 'Dubai')}</div>
          <h1 className="mt-0.5 text-2xl font-bold leading-tight sm:text-3xl">{project.name}</h1>
          {project.developer && <div className="mt-0.5 text-sm opacity-80">{project.developer}</div>}
        </div>
      </div>

      <div className="mx-auto max-w-xl px-4">
        {/* 报价卡:户型 + 总价 */}
        {/* relative:hero 的 <img> 是 replaced content,会画在后续静态兄弟的背景之上 */}
        <div className="relative -mt-7 rounded-2xl bg-white p-5 shadow-lg ring-1 ring-slate-900/[0.06]">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-medium uppercase tracking-wide text-teal-600">
                {zh ? '付款计划' : 'Payment Plan'}
              </div>
              {unitLabel && (
                <div className="mt-1 inline-flex max-w-full items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                  <span className="truncate">{unitLabel}</span>
                </div>
              )}
            </div>
            {quoteDate && (
              <div className="shrink-0 text-right text-[11px] leading-tight text-slate-400">
                {zh ? '报价日期' : 'Quoted'}<br />{quoteDate}
              </div>
            )}
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-slate-400"><DirhamSymbol size="1.4em" /></span>
            <span className="text-4xl font-extrabold tracking-tight text-slate-900">{price.toLocaleString('en-US')}</span>
          </div>
          <div className="mt-1 text-xs text-slate-400">
            {zh ? `总价 ≈ ${formatMoneyCompact(price, 'zh')} 迪拉姆,分期明细见下方` : `Total price · every installment is broken down below`}
          </div>
        </div>

        {/* 时间线图表 */}
        {plan.length > 0 && (
          <div className="mt-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-900/[0.05]">
            <div className="mb-2 flex items-center gap-1.5 text-sm font-bold text-slate-800">
              <CalendarClock className="h-4 w-4 text-teal-600" />
              {zh ? '付款时间线' : 'Payment timeline'}
            </div>
            <PaymentChart paymentPlan={plan} price={price} lang={lang} />
          </div>
        )}

        {/* 每期明细 */}
        {plan.length > 0 && (
          <div className="mt-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-900/[0.05]">
            <div className="mb-3 text-sm font-bold text-slate-800">{zh ? '每期应付' : 'Installments'}</div>
            <PaymentTimeline paymentPlan={plan} referencePrice={price} lang={lang} />
          </div>
        )}

        {/* 顾问卡:信任 + 一键联系 */}
        {agent && (
          <div className="mt-4 flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-900/[0.05]">
            {agent.photo
              ? <img src={agent.photo} alt={agent.name} className="h-14 w-14 rounded-full object-cover ring-2 ring-teal-100" />
              : <div className="flex h-14 w-14 items-center justify-center rounded-full bg-teal-500 text-xl font-bold text-white">{(agent.name || '?').slice(0, 1)}</div>}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-teal-600">
                <BadgeCheck className="h-3.5 w-3.5" />{zh ? '您的专属顾问' : 'Your consultant'}
              </div>
              <div className="truncate text-base font-bold">{agent.name}</div>
              {agent.phone && <div className="text-xs text-slate-400">{agent.phone}</div>}
            </div>
            {contactHref && (
              <a href={contactHref} className="flex shrink-0 items-center gap-1.5 rounded-full bg-teal-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-teal-600">
                {agent.whatsapp ? <MessageCircle className="h-4 w-4" /> : <Phone className="h-4 w-4" />}
                {zh ? '咨询' : 'Contact'}
              </a>
            )}
          </div>
        )}

        {/* 免责声明 + 品牌 */}
        <p className="mt-5 text-center text-[11px] leading-relaxed text-slate-400">
          {zh
            ? '以上金额按顾问提供的报价换算,仅供参考;最终价格与付款节点以开发商购房合同(SPA)为准。'
            : 'Amounts are based on the quote provided by your consultant, for reference only. Final prices and milestones are subject to the developer’s SPA.'}
        </p>
        <div className="mt-2 text-center text-[11px] text-slate-300">
          Powered by <span className="font-semibold text-slate-400">Pinzos</span> · pinzos.com
        </div>
      </div>
    </div>
  )
}
