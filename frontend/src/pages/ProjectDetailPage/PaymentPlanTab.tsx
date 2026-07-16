import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { PaymentPlan, UnitType } from '../../types'
import { useTranslation } from 'react-i18next'
import { Pencil, FileText, ArrowRight, Lock, Crown } from 'lucide-react'
import PaymentTimeline from '../../components/project/PaymentTimeline'
import PaymentChart from '../../components/project/PaymentChart'
import { formatMoneyCompact } from '../../lib/money'
import DirhamSymbol from '../../components/DirhamSymbol'
import { useAuth } from '../../contexts/AuthContext'
import { normalizePaymentPlan } from '../../lib/paymentPlan'
import MoneyInput from '../../components/MoneyInput'
import { fetchBillingMe, fetchMyRole, type BillingMe, type UserRole } from '../../lib/billingApi'
import SalesOfferDialog from './SalesOfferDialog'

interface PaymentPlanTabProps {
  paymentPlan: PaymentPlan[]
  referencePrice?: number
  units?: UnitType[]
  /** 传入后启用经纪的 Sales Offer 生成入口(弹窗) */
  projectId?: string
  projectName?: string
}

/**
 * 付款计划 = 给客户的计算器(2026-07-07 用户定的分离理念):
 *   - 客户:填总价 → 图表 + 每期明细即时换算。不放户型选择,保持干净。
 *   - 经纪(订阅,rookie+/owner):底部多一个「生成 Sales Offer」入口按钮,
 *     点开 SalesOfferDialog 弹窗选户型 + 填报价 → 生成正式报价单 /pp/:code。
 */
export function PaymentPlanTab({ paymentPlan, referencePrice, units = [], projectId, projectName }: PaymentPlanTabProps) {
  const { t, i18n } = useTranslation(['project', 'common', 'projectDetail'])
  const { user } = useAuth()

  // JSONB 两种历史键名(camelCase / snake_case)→ 统一成 PaymentPlan
  const plan = useMemo(() => normalizePaymentPlan(paymentPlan), [paymentPlan])

  // 计算器:客户手填总价(空 = 跟随起价)
  const [priceInput, setPriceInput] = useState<string>('')
  const basePrice = Math.round(Number(referencePrice) || 0)
  const typedPrice = parseInt(priceInput.replace(/[^0-9]/g, ''), 10)
  const activePrice = Number.isFinite(typedPrice) && typedPrice > 0 ? typedPrice : basePrice
  const priceEdited = Number.isFinite(typedPrice) && typedPrice > 0 && typedPrice !== basePrice

  // Sales Offer 入口(从业者角色可见,买家不可见)。铁律:按钮只开弹窗,
  // 绝不因异步的订阅状态偷偷 redirect——权限三态(null=加载中/true/false)
  // 交给弹窗内部渲染(没权限 = 弹窗内升级引导卡,去不去付费页用户自己点);
  // 服务端 401/402 是最终防线。2026-07-07 事故:billing 未加载完点击被
  // 直接甩到 /pricing,owner 也中招。
  const [billing, setBilling] = useState<BillingMe | null>(null)
  const [billingLoaded, setBillingLoaded] = useState(false)
  const [role, setRole] = useState<UserRole | null>(null)
  useEffect(() => {
    if (!user) { setBilling(null); setRole(null); setBillingLoaded(true); return }
    let stale = false
    setBillingLoaded(false)
    fetchBillingMe().then((b) => { if (!stale) { setBilling(b); setBillingLoaded(true) } })
    fetchMyRole().then((r) => { if (!stale) setRole(r) })
    return () => { stale = true }
  }, [user])
  const canOffer = !!billing && (
    billing.credits?.balance === -1 ||
    (['rookie', 'agent', 'founder', 'developer'].includes(billing.plan?.id || '') &&
      ['active', 'trialing'].includes(billing.status))
  )
  /** null = 还在查(弹窗转圈),true/false = 已确定 */
  const entitled: boolean | null = billingLoaded ? canOffer : null
  const showOfferEntry = canOffer || (!!role && ['agent', 'agency', 'developer'].includes(role))
  const [offerOpen, setOfferOpen] = useState(false)

  // 弹窗打开时若上次 billing 拉取失败(瞬时网络/后端抖动)→ 重查一次,
  // 别让有权限的经纪因为一次抖动看到升级卡
  useEffect(() => {
    if (!offerOpen || !user || billing) return
    let stale = false
    setBillingLoaded(false)
    fetchBillingMe().then((b) => { if (!stale) { setBilling(b); setBillingLoaded(true) } })
    return () => { stale = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offerOpen])

  if (plan.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('project:paymentPlanTab.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-slate-600">
            <p>{t('project:paymentPlanTab.emptyMessage')}</p>
            <Button className="mt-4">{t('common:buttons.requestPaymentPlan')}</Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        {/* 经纪的 Sales Offer 入口放标题行右侧(显眼,2026-07-07 用户定位置)。
            软色调贴卡片风格(纯黑块被反馈"格格不入");未订阅经纪也可见,
            带「会员」标识点击去升级;买家看不到。 */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>{t('project:paymentPlanTab.title')}</CardTitle>
          {projectId && showOfferEntry && (
            /* 高级低调:白底细描边(与卡片族一致),金色「会员」标常驻。
               点击一律开弹窗(权限由弹窗内部处理),绝不 redirect */
            <button
              type="button"
              onClick={() => setOfferOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-white px-3.5 py-2 text-sm font-semibold text-slate-800 shadow-sm ring-1 ring-slate-900/10 transition hover:shadow hover:ring-slate-900/20 active:scale-95"
            >
              {entitled === false ? <Lock className="h-4 w-4 text-slate-400" /> : <FileText className="h-4 w-4 text-slate-500" />}
              {t('projectDetail:salesOffer')}
              <span className="inline-flex items-center gap-0.5 rounded-full bg-gradient-to-r from-amber-100 to-yellow-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 ring-1 ring-amber-200/70">
                <Crown className="h-2.5 w-2.5" />{t('projectDetail:pro')}
              </span>
              {entitled !== false && <ArrowRight className="h-4 w-4 text-slate-400" />}
            </button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* 总价:开发商只公布起价,客户/经纪可改成实际报价即时换算 */}
        <div>
          <div className="mb-2 flex items-baseline gap-2">
            <span className="text-sm font-semibold text-slate-800">{t('projectDetail:totalPrice')}</span>
            {priceEdited && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                <Pencil className="h-3 w-3" />{t('projectDetail:customQuote')}
              </span>
            )}
          </div>
          {/* 空值 = 跟随起价(placeholder 灰显起价,值永不隐性回退——回退会
              让输入框删不完,2026-07-07 用户实锤) */}
          <div className="flex max-w-md items-center overflow-hidden rounded-xl border-2 border-slate-200 bg-white focus-within:border-primary">
            <span className="flex items-center ps-3.5 pe-1 text-slate-400"><DirhamSymbol size="1em" /></span>
            <MoneyInput
              value={priceInput}
              onChange={setPriceInput}
              placeholder={basePrice > 0 ? basePrice.toLocaleString('en-US') : (t('projectDetail:enterTotalPrice'))}
              className="w-full bg-transparent py-2.5 pe-3 text-lg font-bold text-slate-900 outline-none"
            />
            {activePrice > 0 && (
              <span className="shrink-0 pe-3.5 text-xs font-medium text-slate-400">
                ≈ {formatMoneyCompact(activePrice, i18n.language)}
              </span>
            )}
          </div>
          <p className="mt-1.5 max-w-md text-[11px] leading-relaxed text-slate-400">
            {t('projectDetail:developersOnlyPublishStarting')}
          </p>
        </div>

        {/* 付款时间线(hover 看每期/累计金额) */}
        {activePrice > 0 && (
          <PaymentChart paymentPlan={plan} price={activePrice} lang={i18n.language} />
        )}

        <PaymentTimeline paymentPlan={plan} referencePrice={activePrice || undefined} lang={i18n.language} />

        {projectId && (
          <SalesOfferDialog
            open={offerOpen}
            onClose={() => setOfferOpen(false)}
            projectId={projectId}
            projectName={projectName}
            units={units}
            referencePrice={referencePrice}
            paymentPlan={plan}
            entitled={entitled}
          />
        )}
      </CardContent>
    </Card>
  )
}
