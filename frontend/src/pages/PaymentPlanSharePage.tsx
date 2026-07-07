import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import QRCode from 'qrcode'
import { Phone, MessageCircle, Loader2, Printer, BadgeCheck, Share2, Check, Clock } from 'lucide-react'
import { PaymentPlan } from '../types'
import { normalizePaymentPlan, monthGap } from '../lib/paymentPlan'

/** 信头用的静态品牌 mark(与 Header 的 pin+数据柱同源,无动效) */
function PinzosMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 42" className={className} aria-hidden>
      <defs>
        <linearGradient id="ppPin" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#2dd4bf" />
          <stop offset="55%" stopColor="#0d9488" />
          <stop offset="100%" stopColor="#0f766e" />
        </linearGradient>
      </defs>
      <path d="M16 1 C7.7 1 1 7.7 1 16 C1 26 16 41 16 41 C16 41 31 26 31 16 C31 7.7 24.3 1 16 1 Z" fill="url(#ppPin)" />
      <rect x="8.4" y="15.5" width="3.4" height="6.7" rx="1.1" fill="#ffffff" fillOpacity="0.9" />
      <rect x="13.9" y="12" width="3.4" height="10.2" rx="1.1" fill="#ffffff" fillOpacity="0.9" />
      <rect x="19.4" y="8.4" width="3.4" height="13.8" rx="1.1" fill="#fbbf24" />
    </svg>
  )
}

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000'

interface UnitSnapshot {
  name: string | null
  bedrooms: number | null
  area: string | number | null
  builtUpArea: string | number | null
  balconyArea: string | number | null
  view: string | null
  floorPlanImage: string | null
  image: string | null
}

interface PayShareData {
  share: {
    unitName: string | null; bedrooms: number | null; price: number
    originalPrice: number | null; unitSnapshot: UnitSnapshot | null
    planSnapshot: Array<{ name: string; pct: number; months: number | null }> | null
    code: string; lang: string; createdAt: string
  }
  project: {
    id: string; name: string; developer: string | null; area: string | null; status: string | null
    completionDate: string | null; handoverDate: string | null; image: string | null
    paymentPlan: PaymentPlan[]
  }
  agent: { name: string; photo: string | null; phone: string | null; whatsapp: string | null; email: string | null; tier: string | null } | null
}

/** Pinzos 段位 → 报价单认证盖章文案(lib/roleBadge.ts 同族口径) */
const TIER_STAMP: Record<string, { zh: string; en: string }> = {
  rookie: { zh: '认证经纪人', en: 'CERTIFIED AGENT' },
  agent: { zh: '金牌经纪人 PRO', en: 'CERTIFIED PRO AGENT' },
  founder: { zh: '认证经纪公司', en: 'CERTIFIED AGENCY' },
  developer: { zh: '认证开发商', en: 'CERTIFIED DEVELOPER' },
}

const aed = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * Sales Offer 报价单(/pp/:code)——客户免登录查看,可「保存 PDF」。
 * 版式对齐开发商正式 Sales Offer PDF(IMAN/MERAAS 样本):灰底上一张居中
 * 白色 A4 文档 —— 顶部标题+Ref/日期+顾问落款、单元明细边框表(含折扣行)、
 * SCHEDULE OF INSTALLMENT PAYMENTS 分期表、ADDITIONAL COST 附加费表、
 * 免责、户型图、页脚。不用 app 风格的卡片/图表/全屏 hero(2026-07-07 用户
 * 反馈:要像正式文件,不像 app 页面)。
 */
interface ExpiredData {
  expired: true
  lang: string
  projectName: string | null
  agent: { name: string; photo: string | null; phone: string | null; whatsapp: string | null } | null
}

export default function PaymentPlanSharePage() {
  const { code } = useParams()
  const [d, setD] = useState<PayShareData | null>(null)
  const [expired, setExpired] = useState<ExpiredData | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'expired' | 'error'>('loading')
  const [copied, setCopied] = useState(false)

  // 在线验证 QR(打印件上客户可扫码回到本页核真——纸质报价单的防伪信任感)
  const [qr, setQr] = useState<string | null>(null)
  useEffect(() => {
    QRCode.toDataURL(window.location.href, { margin: 0, width: 160, color: { dark: '#0f172a', light: '#ffffff' } })
      .then(setQr)
      .catch(() => { /* QR 失败不影响文档 */ })
  }, [code])

  // 分享给客户:移动端唤起系统分享,桌面/不支持时复制链接
  const shareOffer = async () => {
    const url = window.location.href
    const title = document.title
    if (navigator.share) {
      navigator.share({ title, url }).catch(() => { /* 用户取消 */ })
      return
    }
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard 不可用时用户可从地址栏复制 */ }
  }

  useEffect(() => {
    fetch(`${API}/api/luna/public/payplan/${code}`)
      .then(async (r) => {
        if (r.ok) {
          const j: PayShareData = await r.json()
          setD(j); setState('ok')
          const zh2 = j.share?.lang !== 'en'
          if (j.project?.name) document.title = `${j.project.name} · ${zh2 ? '报价单' : 'Sales Offer'}`
          return
        }
        // 410 = 报价单已过期(60 天有效):行保留,页面转"联系顾问"
        if (r.status === 410) {
          const j: ExpiredData = await r.json()
          setExpired(j); setState('expired')
          return
        }
        setState('error')
      })
      .catch(() => setState('error'))
  }, [code])

  if (state === 'loading') {
    return <div className="flex min-h-screen items-center justify-center bg-slate-100"><Loader2 className="h-8 w-8 animate-spin text-teal-500" /></div>
  }
  if (state === 'expired' && expired) {
    const ezh = expired.lang !== 'en'
    const a = expired.agent
    const href = a?.whatsapp ? `https://wa.me/${a.whatsapp.replace(/[^0-9]/g, '')}` : a?.phone ? `tel:${a.phone}` : undefined
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-xl ring-1 ring-slate-900/5">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
            <Clock className="h-6 w-6 text-slate-400" />
          </div>
          <h1 className="mt-4 text-lg font-bold text-slate-900">
            {ezh ? '该报价已过期' : 'This offer has expired'}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">
            {ezh
              ? `报价单有效期 60 天${expired.projectName ? `。${expired.projectName} 的价格与房源可能已更新` : ''},请联系您的顾问获取最新报价。`
              : `Offers are valid for 60 days${expired.projectName ? ` — prices for ${expired.projectName} may have changed` : ''}. Contact your consultant for a fresh quote.`}
          </p>
          {a && (
            <div className="mt-6 flex items-center gap-3 rounded-xl bg-slate-50 p-3 text-left">
              {a.photo
                ? <img src={a.photo} alt={a.name} className="h-11 w-11 rounded-full object-cover ring-2 ring-white" />
                : <div className="flex h-11 w-11 items-center justify-center rounded-full bg-teal-500 text-lg font-bold text-white">{(a.name || '?').slice(0, 1)}</div>}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold text-slate-900">{a.name}</div>
                {a.phone && <div className="text-xs text-slate-400">{a.phone}</div>}
              </div>
              {href && (
                <a href={href} className="flex shrink-0 items-center gap-1.5 rounded-full bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700">
                  {a.whatsapp ? <MessageCircle className="h-4 w-4" /> : <Phone className="h-4 w-4" />}
                  {ezh ? '获取最新报价' : 'Get a new quote'}
                </a>
              )}
            </div>
          )}
          <div className="mt-6 text-[11px] text-slate-300">Powered by <span className="font-semibold text-slate-400">Pinzos</span> · pinzos.com</div>
        </div>
      </div>
    )
  }
  if (state === 'error' || !d) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-100 text-slate-400">页面不存在或已失效 / This link is no longer available</div>
  }

  const { share, project, agent } = d
  const zh = share.lang !== 'en'
  const plan = normalizePaymentPlan(project.paymentPlan)
  const price = share.price
  const orig = share.originalPrice && share.originalPrice > price ? share.originalPrice : null
  const discount = orig ? { amount: orig - price, pct: Math.round(((orig - price) / orig) * 1000) / 10 } : null
  const snap = share.unitSnapshot
  const contactHref = agent?.whatsapp
    ? `https://wa.me/${agent.whatsapp.replace(/[^0-9]/g, '')}`
    : agent?.phone ? `tel:${agent.phone}` : undefined
  const bedsLabel = share.bedrooms != null
    ? (share.bedrooms === 0 ? (zh ? '工作室' : 'Studio') : zh ? `${share.bedrooms} 居` : `${share.bedrooms} BR`)
    : null
  const unitLabel = share.unitName || bedsLabel
  const quoteDate = share.createdAt ? String(share.createdAt).slice(0, 10) : ''
  // 有效期至 = 生成 + 60 天(与后端 410 口径一致);明示时效本身就是信任要素
  const validUntil = share.createdAt
    ? new Date(new Date(share.createdAt).getTime() + 60 * 86_400_000).toISOString().slice(0, 10)
    : ''
  const completion = String(project.handoverDate || project.completionDate || '').slice(0, 10)

  // 分期表行:优先用经纪谈定的自定义周期快照,否则项目默认计划;
  // 金额按报价换算(样本表头 Percentage / Date / Amount (AED))
  const rows = share.planSnapshot?.length
    ? share.planSnapshot.map((m, i) => ({
        idx: i + 1,
        name: m.name || (zh ? `第 ${i + 1} 期` : `Installment ${i + 1}`),
        pct: Number(m.pct) || 0,
        // months = 距上一期的月数(谈的是间隔不是日历日期)
        date: i === 0
          ? (zh ? '签约时' : 'At booking')
          : (m.months != null && m.months > 0 ? (zh ? `${m.months} 个月后` : `${m.months} months later`) : ''),
        amount: (Number(m.pct) || 0) / 100 * price,
      }))
    : (() => {
        // 项目默认计划同样按月间隔渲染(不用日历死日期——常已过期,客户也
        // 更好理解"签约后几个月",2026-07-07 用户定):interval_months 优先,
        // 否则相邻 milestone_date 差换算。
        const sorted = plan.slice().sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
        return sorted.map((m, i) => {
          const gap = i === 0 ? 0 : (Number(m.interval_months) || monthGap(sorted[i - 1]?.milestone_date, m.milestone_date))
          return {
            idx: i + 1,
            name: m.milestone_name || (zh ? `第 ${i + 1} 期` : `Installment ${i + 1}`),
            pct: Number(m.percentage) || 0,
            date: i === 0
              ? (zh ? '签约时' : 'At booking')
              : (gap != null && gap > 0
                ? (zh ? `${gap} 个月后` : `${gap} months later`)
                : (m.interval_description || '')),
            amount: (Number(m.percentage) || 0) / 100 * price,
          }
        })
      })()

  // 附加费用(迪拜通行标准;以开发商/DLD 实际收费为准)
  const dldFee = price * 0.04 + 40
  const adminFee = 3150

  // 单元明细行(有值才显示)
  const unitRows: [string, string][] = []
  if (unitLabel) unitRows.push([zh ? '户型' : 'Unit Type', unitLabel])
  if (snap?.builtUpArea) unitRows.push([zh ? '室内面积 (Sq.Ft)' : 'Internal Area (Sq.Ft)', String(snap.builtUpArea)])
  if (snap?.balconyArea) unitRows.push([zh ? '阳台面积 (Sq.Ft)' : 'Balcony Area (Sq.Ft)', String(snap.balconyArea)])
  if (snap?.area) unitRows.push([zh ? '总面积 (Sq.Ft)' : 'Total Area (Sq.Ft)', String(snap.area)])
  if (snap?.view) unitRows.push([zh ? '景观' : 'View', snap.view])

  const th = 'border border-slate-300 bg-slate-800 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-white'
  const td = 'border border-slate-200 px-3 py-2 text-[13px] text-slate-700'
  const sectionTitle = 'mt-8 mb-3 text-center text-[13px] font-bold uppercase tracking-[0.18em] text-slate-800'

  return (
    <div className="min-h-screen bg-slate-200/80 py-6 pb-28 text-slate-900 sm:py-10 print:bg-white print:py-0 print:pb-0">
      {/* 打印(存 PDF):
          1. app 根是 h-screen overflow-hidden、页面在内层容器滚动(window 从不滚)
             —— 不放开这条链,打印只会得到"一屏"且把内层滚动条一起印出来
             (2026-07-07 实锤)。print 时把 #root 下所有容器高度/overflow 放开,
             内容才能自然流式分页。
          2. 表格行不跨页断;户型图独占一页(对齐样本 PDF 的第二页 UNIT PLAN)。 */}
      <style>{`
        @media print {
          html, body { height: auto !important; overflow: visible !important }
          #root, #root div { height: auto !important; min-height: 0 !important; max-height: none !important; overflow: visible !important }
          .pp-no-print { display: none !important }
          .pp-sheet { box-shadow: none !important; max-width: none !important; padding: 0 !important; --tw-ring-shadow: none !important }
          .pp-sheet tr, .pp-avoid { break-inside: avoid }
          /* 户型图:放得下就接着排,放不下才整块搬下一页(强制另起一页会在
             上一页留大片空白,2026-07-07 用户反馈);打印时限高提升塞入概率 */
          .pp-plan { break-inside: avoid }
          .pp-plan img { max-height: 165mm !important }
          /* 水印:print 用 fixed → 每一页都盖 */
          .pp-watermark { position: fixed !important; top: 40% !important; left: 15% !important; transform: rotate(-24deg) !important }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact }
        }
        @page { margin: 14mm 12mm }
      `}</style>

      {/* A4 文档 */}
      <div className="pp-sheet relative mx-auto max-w-[860px] overflow-hidden bg-white px-5 py-8 shadow-xl ring-1 ring-slate-900/5 sm:px-12 sm:py-12">

        {/* 纸面暗水印:防篡改的机构感;print 时 fixed → 每页都有 */}
        <div className="pp-watermark pointer-events-none absolute left-1/2 top-[38%] -translate-x-1/2 -rotate-[24deg] select-none font-serif text-[120px] font-bold tracking-[0.2em] text-slate-900/[0.025]">
          PINZOS
        </div>

        {/* ── 信头:品牌区(机构出品的第一眼)── */}
        <div className="relative flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <PinzosMark className="h-9 w-9" />
            <div>
              <div className="font-serif text-2xl font-semibold leading-none tracking-[-0.015em] text-slate-900">Pinzos</div>
              <div className="mt-1 text-[10px] tracking-wide text-slate-400">{zh ? '迪拜买房新方式' : 'A New Way to Buy Off-Plan in Dubai'} · pinzos.com</div>
            </div>
          </div>
          <div className="text-right text-[10px] leading-relaxed text-slate-400">
            {zh ? '数据来源' : 'Data source'}<br />
            <span className="font-semibold text-slate-500">Dubai Land Department (DLD)</span>
          </div>
        </div>
        {/* 经典信头双线:细线 + 粗线 */}
        <div className="relative mt-4 border-t border-slate-300" />
        <div className="relative mt-[3px] border-t-2 border-slate-900" />

        {/* ── 标题 + 元数据 ── */}
        <div className="relative mt-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="font-serif text-3xl font-bold tracking-tight text-slate-900">Sales Offer</h1>
            {zh && <div className="mt-0.5 text-sm font-medium text-slate-500">购房报价单</div>}
          </div>
          <table className="shrink-0 text-[11px]">
            <tbody>
              <tr>
                <td className="pr-3 text-right text-slate-400">Ref No</td>
                <td className="text-right font-semibold text-slate-700">SO-{share.code?.toUpperCase()}</td>
              </tr>
              {quoteDate && (
                <tr>
                  <td className="pr-3 text-right text-slate-400">{zh ? '报价日期' : 'Date'}</td>
                  <td className="text-right font-semibold text-slate-700">{quoteDate}</td>
                </tr>
              )}
              {validUntil && (
                <tr>
                  <td className="pr-3 text-right text-slate-400">{zh ? '有效期至' : 'Valid until'}</td>
                  <td className="text-right font-semibold text-teal-700">{validUntil}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* 敬语(样本:Dear Customer, taking into consideration…) */}
        <p className="mt-5 text-[13px] leading-relaxed text-slate-600">
          {zh
            ? '尊敬的客户,您好!结合您的购房需求,我们为您推荐以下单元,报价与付款安排如下。'
            : 'Dear Customer, taking into consideration the points discussed, we believe the unit details below align with your requirements.'}
        </p>

        {/* ── 项目行 ── */}
        <table className="pp-avoid mt-5 w-full border-collapse">
          <thead>
            <tr>
              <th className={th}>{zh ? '项目' : 'Project'}</th>
              <th className={th}>{zh ? '开发商' : 'Developer'}</th>
              <th className={th}>{zh ? '区域' : 'Area'}</th>
              {completion && <th className={th}>{zh ? '预计交付' : 'Est. Completion'}</th>}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className={`${td} font-semibold`}>{project.name}</td>
              <td className={td}>{project.developer || '—'}</td>
              <td className={td}>{project.area || 'Dubai'}</td>
              {completion && <td className={td}>{completion}</td>}
            </tr>
          </tbody>
        </table>

        {/* ── 单元明细 + 价格(折扣行样式对齐样本:Discount → Total Selling Price)── */}
        <div className={sectionTitle}>{zh ? '单元明细 · Unit Details' : 'Unit Details'}</div>
        <table className="pp-avoid w-full border-collapse">
          <tbody>
            {unitRows.map(([k, v]) => (
              <tr key={k}>
                <td className={`${td} w-1/2 bg-slate-50 font-medium text-slate-500`}>{k}</td>
                <td className={`${td} text-right font-semibold`}>{v}</td>
              </tr>
            ))}
            <tr>
              <td className={`${td} bg-slate-50 font-medium text-slate-500`}>{zh ? '售价 (AED)' : 'Selling Price (AED)'}</td>
              <td className={`${td} text-right font-semibold ${discount ? 'text-slate-400 line-through' : ''}`}>{aed(orig || price)}</td>
            </tr>
            {discount && (
              <tr>
                <td className={`${td} font-semibold text-rose-700`}>{zh ? `专属优惠 ${discount.pct}%` : `Discount ${discount.pct}%`}</td>
                <td className={`${td} text-right font-semibold text-rose-700`}>− {aed(discount.amount)}</td>
              </tr>
            )}
            <tr>
              <td className={`${td} bg-slate-800 text-sm font-bold text-white`}>{zh ? '成交总价 (AED)' : 'Total Selling Price (AED)'}</td>
              <td className={`${td} bg-slate-800 text-right text-base font-extrabold text-white`}>{aed(price)}</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
          * {zh ? '价格与房源随时可能调整,恕不另行通知。' : 'Prices and availability are subject to change without notice.'}
        </p>

        {/* ── 分期付款表 ── */}
        {rows.length > 0 && (
          <>
            <div className={sectionTitle}>{zh ? '分期付款安排 · Schedule of Installment Payments' : 'Schedule of Installment Payments'}</div>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={`${th} w-8 text-center`}>#</th>
                  <th className={th}>{zh ? '付款节点' : 'Payment Terms'}</th>
                  <th className={`${th} w-20 text-right`}>%</th>
                  <th className={`${th} w-28`}>{zh ? '时间' : 'Date'}</th>
                  <th className={`${th} w-32 text-right`}>{zh ? '金额 (AED)' : 'Amount (AED)'}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.idx} className="even:bg-slate-50/60">
                    <td className={`${td} text-center text-slate-400`}>{r.idx}</td>
                    <td className={td}>{r.name}</td>
                    <td className={`${td} text-right`}>{r.pct.toFixed(2)} %</td>
                    <td className={`${td} text-slate-500`}>{r.date || '—'}</td>
                    <td className={`${td} text-right font-semibold`}>{aed(r.amount)}</td>
                  </tr>
                ))}
                <tr>
                  <td className={`${td} bg-slate-800 font-bold text-white`} colSpan={4}>{zh ? '合计 · Purchase Price' : 'Purchase Price'}</td>
                  <td className={`${td} bg-slate-800 text-right font-extrabold text-white`}>{aed(price)}</td>
                </tr>
              </tbody>
            </table>
          </>
        )}

        {/* ── 附加费用 ── */}
        <div className={sectionTitle}>{zh ? '附加费用 · Additional Cost' : 'Additional Cost'}</div>
        <table className="pp-avoid w-full border-collapse">
          <thead>
            <tr>
              <th className={th}>{zh ? '项目' : 'Description'}</th>
              <th className={`${th} w-32 text-right`}>{zh ? '金额 (AED)' : 'Total Amount (AED)'}</th>
              <th className={th}>{zh ? '说明' : 'Remarks'}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className={td}>{zh ? 'DLD 注册费(4% + 40)' : 'Oqood / DLD Registration (4% + 40)'}</td>
              <td className={`${td} text-right font-semibold`}>{aed(dldFee)}</td>
              <td className={`${td} text-slate-500`}>{zh ? '预订时由买家支付' : 'Payable by the Buyer at time of booking'}</td>
            </tr>
            <tr>
              <td className={td}>{zh ? '行政费(Admin Charges)' : 'Admin Charges'}</td>
              <td className={`${td} text-right font-semibold`}>{aed(adminFee)}</td>
              <td className={`${td} text-slate-500`}>{zh ? '预订时由买家支付' : 'Payable by the Buyer at time of booking'}</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
          * {zh
            ? '按迪拜通行标准估算,以开发商与迪拜土地局(DLD)实际收费为准;最终价格与付款节点以开发商购房合同(SPA)为准。'
            : 'Estimated per standard Dubai practice; actual amounts per the developer and the DLD. Final prices and milestones per the developer’s SPA.'}
        </p>

        {/* ── 户型图(UNIT PLAN;打印时整块不拆,能塞进当前页就不翻页)── */}
        {snap?.floorPlanImage && (
          <div className="pp-plan">
            <div className={sectionTitle}>{zh ? '户型图 · Unit Plan' : 'Unit Plan'}</div>
            <div className="border border-slate-200 p-2">
              <img src={snap.floorPlanImage} alt={unitLabel || 'Unit plan'} className="mx-auto block max-h-[560px] w-auto max-w-full" loading="lazy" />
            </div>
          </div>
        )}

        {/* ── 签名盖章区:顾问落款 + 认证章 + 在线验证 QR(中式文件的信任仪式)── */}
        <div className="pp-avoid relative mt-10 border-t-2 border-slate-900 pt-5">
          <div className="flex flex-wrap items-start justify-between gap-6">
            {/* 左:在线验证(扫码回本页核真 = 纸质件防伪) */}
            <div className="flex items-start gap-3.5">
              {qr && <img src={qr} alt="Verify QR" className="h-[72px] w-[72px] rounded-md border border-slate-200 p-1" />}
              <div className="text-[11px] leading-relaxed text-slate-500">
                <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-700">{zh ? '在线验证' : 'Verify online'}</div>
                <div className="mt-1">{zh ? '扫码核验本报价单真伪与时效' : 'Scan to verify this offer'}</div>
                <div className="font-medium text-teal-700">pinzos.com/pp/{share.code}</div>
                {quoteDate && <div className="mt-1 text-slate-400">{zh ? `由 Pinzos 平台出具 · ${quoteDate}` : `Issued via Pinzos · ${quoteDate}`}</div>}
              </div>
            </div>

            {/* 右:顾问签名卡 + 认证章(章盖在签名旁) */}
            {agent && (
              <div className="flex items-center gap-4">
                {agent.tier && TIER_STAMP[agent.tier] && (
                  <div className="pointer-events-none -rotate-[8deg] select-none rounded-md border-[3px] border-double border-teal-700/70 px-2.5 py-1.5 text-center leading-tight text-teal-700/90">
                    <div className="flex items-center justify-center gap-0.5 text-[8px] font-bold tracking-[0.24em]">
                      PINZOS<BadgeCheck className="h-2.5 w-2.5" />
                    </div>
                    <div className="text-[12px] font-extrabold tracking-wide">
                      {zh ? TIER_STAMP[agent.tier].zh : TIER_STAMP[agent.tier].en}
                    </div>
                  </div>
                )}
                <div className="text-right">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">{zh ? '您的置业顾问' : 'Sales Executive'}</div>
                  <div className="font-serif text-lg font-bold text-slate-900">{agent.name}</div>
                  {agent.phone && <div className="text-xs text-slate-500">{agent.phone}</div>}
                  {agent.email && <div className="text-xs text-slate-500">{agent.email}</div>}
                </div>
                {agent.photo && <img src={agent.photo} alt={agent.name} className="h-14 w-14 rounded-full object-cover ring-2 ring-slate-200" />}
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 text-center text-[10px] tracking-wide text-slate-300">
          Powered by <span className="font-semibold text-slate-400">Pinzos</span> · pinzos.com
        </div>
      </div>

      {/* 操作条(不进 PDF):保存 PDF + 一键联系顾问 */}
      <div className="pp-no-print fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-[860px] flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={shareOffer}
            className="inline-flex items-center gap-1.5 rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700"
          >
            {copied ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
            {copied ? (zh ? '链接已复制' : 'Link copied') : (zh ? '分享给客户' : 'Share')}
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <Printer className="h-4 w-4" />{zh ? '保存 PDF / 打印' : 'Save as PDF'}
          </button>
          {contactHref && (
            <a href={contactHref} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
              {agent?.whatsapp ? <MessageCircle className="h-4 w-4" /> : <Phone className="h-4 w-4" />}
              {zh ? '咨询顾问' : 'Contact'}
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
