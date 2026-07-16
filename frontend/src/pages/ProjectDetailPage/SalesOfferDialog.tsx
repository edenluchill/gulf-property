import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'
import { X, Check, Loader2, BadgePercent, FileText, Plus, Trash2, RotateCcw, SlidersHorizontal, Lock } from 'lucide-react'
import { PaymentPlan, UnitType } from '../../types'
import { useTranslation } from 'react-i18next'
import { formatMoneyCompact } from '../../lib/money'
import { monthGap } from '../../lib/paymentPlan'
import DirhamSymbol from '../../components/DirhamSymbol'
import { API_BASE_URL } from '../../lib/config'
import { useAuth } from '../../contexts/AuthContext'
import MoneyInput from '../../components/MoneyInput'
import AgentCardEditor from '../../components/AgentCardEditor'

interface SalesOfferDialogProps {
  open: boolean
  onClose: () => void
  projectId: string
  projectName?: string
  units: UnitType[]
  referencePrice?: number
  /** 项目默认付款计划(已 normalize),导入 03 步供经纪按谈判结果调整 */
  paymentPlan: PaymentPlan[]
  /** 订阅权限三态:null = 还在查(转圈)/ true = 可用 / false = 升级引导。
   *  权限 UI 全在弹窗内,入口按钮绝不 redirect(2026-07-07 事故后铁律)。 */
  entitled: boolean | null
}

/** 03 步编辑行:比例/间隔用字符串存,输入过程中允许半成品("2." 之类)。
 *  gap = 距上一期的月数(第 1 期恒为签约时)——付款节奏谈的是间隔而非
 *  日历日期(2026-07-07 用户定),项目默认计划里的实际日期导入时换算成间隔。 */
interface PlanRow { name: string; pct: string; gap: string }

/** 周期条配色(与付款计划 tab 的分段条同族) */
const BAR_COLORS = ['#2dd4bf', '#4ade80', '#38bdf8', '#818cf8', '#a78bfa', '#fbbf24', '#2dd4bf', '#34d399', '#60a5fa', '#c084fc']

/** 步骤标题:深色编号块 + 加粗标题(原浅灰小字用户反馈看不清) */
function StepLabel({ n, right, children }: { n: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-2.5 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-slate-900 text-[10px] font-bold text-white">{n}</span>
        <span className="text-sm font-bold text-slate-900">{children}</span>
      </div>
      {right}
    </div>
  )
}

/**
 * Sales Offer 生成弹窗(经纪订阅专属,入口在付款计划 tab 的经纪按钮)。
 * 2026-07-07 用户定的分离理念:付款计划 tab 本身是给客户的计算器;经纪在
 * 弹窗里「01 选户型(必选)→ 02 报价(选中户型自动预填标价)→ 03 付款周期
 * (可调,合计必须 100%)→ 生成」,成功后直接跳到报价单页 /pp/:code 看成果。
 * z-[10000]:fixed 弹层必须压过 MobileNav 的 z-50(项目规约)。
 */
export default function SalesOfferDialog({ open, onClose, projectId, projectName, units, referencePrice, paymentPlan, entitled }: SalesOfferDialogProps) {
  const { t: tRaw, i18n } = useTranslation('offer')
  const t = tRaw as (k: string, o?: Record<string, unknown>) => string
  const zh = (i18n.language || 'en').startsWith('zh')
  const { session } = useAuth()
  const navigate = useNavigate()

  const [selBeds, setSelBeds] = useState<number | 'all'>('all')
  const [selUnitId, setSelUnitId] = useState<string>('')
  // 02 步三个联动字段(2026-07-12 改:折扣是主输入,成交价自动算——经纪谈的是
  // "开发商给几个点",不是"最后收多少钱")。三者都可直接改,改谁就反算另一个:
  //   原价 origInput ──┐
  //   折扣 discInput ──┼→ 成交价 priceInput(仍是提交给后端的 price 真相)
  const [origInput, setOrigInput] = useState<string>('')
  const [discMode, setDiscMode] = useState<'pct' | 'amt'>('pct')
  const [discInput, setDiscInput] = useState<string>('')
  const [priceInput, setPriceInput] = useState<string>('')
  const [sharing, setSharing] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // 名片落款(姓名/头像/电话/邮箱)就地可改——用户反馈入口藏在 /profile 太隐蔽
  const [cardOpen, setCardOpen] = useState(false)

  // 付款周期(可谈):null = 项目默认;点「调整」导入默认计划开编。
  // 间隔优先级:interval_months > 相邻 milestone_date 差 > 空。
  const defaultPlanRows = useMemo<PlanRow[]>(() => {
    const sorted = paymentPlan.slice().sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
    return sorted.map((m, i) => {
      const fromDates = monthGap(sorted[i - 1]?.milestone_date, m.milestone_date)
      const gap = i === 0 ? 0 : (Number(m.interval_months) || fromDates)
      return {
        name: m.milestone_name || (t('offer:installment', { i_1: i + 1 })),
        pct: String(Number(m.percentage) || 0),
        gap: gap != null ? String(gap) : '',
      }
    })
  }, [paymentPlan, zh])
  const [planRows, setPlanRows] = useState<PlanRow[] | null>(null)
  const shownPlanRows = planRows ?? defaultPlanRows
  const planTotal = shownPlanRows.reduce((s, r) => s + (parseFloat(r.pct) || 0), 0)
  const planValid = Math.abs(planTotal - 100) <= 0.5

  // 打开时重置(换项目/重开都从干净状态开始);项目没录付款计划时给一副
  // 骨架直接开编——周期是报价单必填项(2026-07-07 用户定),没有就现建。
  useEffect(() => {
    if (!open) return
    // 没有户型数据的项目 → 起价预填进原价(有户型的等选中户型再填)
    setSelBeds('all'); setSelUnitId('')
    const ref = units.length === 0 && Number(referencePrice) > 0 ? String(Math.round(Number(referencePrice))) : ''
    setOrigInput(ref); setPriceInput(ref)
    setDiscMode('pct'); setDiscInput('')
    setErr(null)
    setPlanRows(defaultPlanRows.length === 0
      ? [
          { name: t('offer:downPayment'), pct: '20', gap: '' },
          { name: t('offer:onCompletion'), pct: '80', gap: '' },
        ]
      : null)
  }, [open, projectId, defaultPlanRows, zh, units.length, referencePrice])

  const patchPlanRow = (i: number, patch: Partial<PlanRow>) => {
    setPlanRows((rows) => (rows ? rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) : rows))
    setErr(null)
  }

  const bedsLabel = (b: number) => (b === 0 ? (t('offer:studio')) : t('offer:br', { b }))

  // 居室分组(全部户型,有价没价都能选;组内有价在前、按价升序)
  const bedsOptions = useMemo(
    () => [...new Set(units.map((u) => u.bedrooms ?? -1))].sort((a, b) => a - b),
    [units]
  )
  const list = useMemo(() => {
    const sorted = [...units].sort((a, b) => (Number(a.price) || Infinity) - (Number(b.price) || Infinity))
    return selBeds === 'all' ? sorted : sorted.filter((u) => (u.bedrooms ?? -1) === selBeds)
  }, [units, selBeds])

  const selUnit = units.find((u) => u.id === selUnitId) || null

  // 原价/成交价都以输入框为唯一真相,空 = 0,不做隐性回退(回退会让输入框
  // "删不完",2026-07-07 用户实锤)
  const num = (s: string) => {
    const n = parseInt(s || '0', 10)
    return Number.isFinite(n) && n > 0 ? n : 0
  }
  const orig = num(origInput)
  const price = num(priceInput)
  // 折扣行只在「原价高于成交价」时成立(对齐开发商 offer 的 Discount 行)
  const discount = orig > 0 && price > 0 && price < orig
    ? { amount: orig - price, pct: Math.round(((orig - price) / orig) * 1000) / 10 }
    : null

  /** 折扣(主输入)→ 成交价。base 显式传入,避免 orig 的闭包旧值 */
  const applyDisc = (raw: string, mode: 'pct' | 'amt' = discMode, base = orig) => {
    setDiscInput(raw); setErr(null)
    if (!base) return
    const v = parseFloat(raw)
    if (!raw.trim() || !Number.isFinite(v) || v <= 0) { setPriceInput(String(base)); return }
    const cut = mode === 'pct'
      ? Math.round((Math.min(v, 100) / 100) * base)
      : Math.min(Math.round(v), base)
    setPriceInput(String(base - cut))
  }
  /** 成交价直接改 → 反算折扣(有的经纪谈的是最终总价) */
  const applyPrice = (raw: string) => {
    setPriceInput(raw); setErr(null)
    const p2 = num(raw)
    if (!orig || !p2 || p2 >= orig) { setDiscInput(''); return }
    const cut = orig - p2
    setDiscInput(discMode === 'pct' ? String(Math.round((cut / orig) * 1000) / 10) : String(cut))
  }
  /** 原价改了 → 折扣不变、成交价重算 */
  const applyOrig = (raw: string) => {
    setOrigInput(raw); setErr(null)
    const base = num(raw)
    if (base) applyDisc(discInput, discMode, base)
  }
  /** %  ⇄ AED 切换:把当前折扣换算成另一种表示,不丢已谈好的优惠 */
  const switchMode = (m: 'pct' | 'amt') => {
    if (m === discMode) return
    setDiscMode(m)
    setDiscInput(discount ? String(m === 'pct' ? discount.pct : discount.amount) : '')
  }

  // 选中户型 → 标价填进原价(经纪在此基础上打折);户型必选,不做"再点一下取消"。
  // 换户型时按点数谈的折扣可平移,直减金额与具体户型强绑定 → 清空。
  const pickUnit = (id: string) => {
    setSelUnitId(id)
    const p2 = Math.round(Number(units.find((u) => u.id === id)?.price) || 0)
    setOrigInput(p2 > 0 ? String(p2) : '')
    if (discMode === 'pct' && p2 > 0 && discInput.trim()) applyDisc(discInput, 'pct', p2)
    else { setDiscInput(''); setPriceInput(p2 > 0 ? String(p2) : '') }
    setErr(null)
  }

  // 必填校验:户型(有户型数据的项目)/ 价格 / 周期(合计 100%)
  const unitOk = units.length === 0 || !!selUnit
  const planOk = shownPlanRows.length > 0 && (planRows ? planValid : true)
  const canGenerate = price > 0 && unitOk && planOk

  const generate = async () => {
    if (!price || sharing) return
    if (!unitOk) {
      setErr(t('offer:pleaseSelectAUnit'))
      return
    }
    if (!planOk) {
      setErr(t('offer:installmentsMustSum', { total: planTotal.toFixed(2) }))
      return
    }
    setSharing(true); setErr(null)
    try {
      const headers: HeadersInit = { 'Content-Type': 'application/json' }
      if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`
      const r = await fetch(`${API_BASE_URL}/api/luna/public/payplan`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          projectId,
          unitName: selUnit?.unit_type_name || (selUnit ? bedsLabel(selUnit.bedrooms) : undefined),
          bedrooms: selUnit?.bedrooms,
          price,
          originalPrice: discount ? orig : undefined,
          unit: selUnit ? {
            name: selUnit.unit_type_name,
            bedrooms: selUnit.bedrooms,
            area: selUnit.area,
            builtUpArea: selUnit.built_up_area,
            balconyArea: selUnit.balcony_area,
            view: selUnit.view_type,
            floorPlanImage: selUnit.floor_plan_image,
            image: selUnit.unit_images?.[0],
          } : undefined,
          // 只有经纪动过周期才传快照;不传 = 报价单用项目默认计划。
          // months = 距上一期的月数(首期 0 = 签约时)
          plan: planRows
            ? planRows
                .filter((r2) => (parseFloat(r2.pct) || 0) > 0)
                .map((r2, i) => ({
                  name: r2.name.trim(),
                  pct: parseFloat(r2.pct) || 0,
                  months: i === 0 ? 0 : (r2.gap.trim() === '' ? null : Math.max(0, parseInt(r2.gap, 10) || 0)),
                }))
            : undefined,
          lang: zh ? 'zh' : 'en',
        }),
      })
      const j = await r.json()
      if (!r.ok || !j.code) throw new Error(j.error || 'failed')
      // 成功 → 直接带经纪去看成果(报价单页自带「分享给客户 / 保存 PDF」)
      onClose()
      navigate(`/pp/${j.code}`)
    } catch (e) {
      setErr(e instanceof Error && e.message !== 'failed' ? e.message : (t('offer:failedPleaseRetry')))
    } finally {
      setSharing(false)
    }
  }

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-end justify-center sm:items-center">
      {/* backdrop */}
      <div className="absolute inset-0 bg-slate-900/55 backdrop-blur-[2px]" onClick={onClose} />

      {/* panel */}
      <div className="relative flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl">
        {/* 头:深色文档质感,呼应 offer 成品 */}
        <div className="flex items-start justify-between gap-3 bg-slate-900 px-6 py-5 text-white">
          <div>
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-teal-300" />
              <span className="font-serif text-xl font-bold tracking-tight">Sales Offer</span>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-teal-200">
                {t('offer:quote')}
              </span>
            </div>
            <div className="mt-1 text-xs text-slate-400">{projectName}</div>
          </div>
          <button type="button" onClick={onClose} aria-label={t('offer:close')}
            className="rounded-full p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 权限三态:查询中转圈;无权限 → 弹窗内升级引导(用户自己决定去付费页,
            绝不自动跳);有权限 → 生成器 */}
        {entitled === null ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-teal-500" />
          </div>
        ) : entitled === false ? (
          <div className="px-6 py-10 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 ring-1 ring-amber-200/70">
              <Lock className="h-5 w-5 text-amber-600" />
            </div>
            <h3 className="mt-4 text-base font-bold text-slate-900">
              {t('offer:salesOfferIsA')}
            </h3>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-slate-500">
              {t('offer:subscribeToAnyAgent')}
            </p>
            <div className="mt-6 flex items-center justify-center gap-3">
              <Link to="/pricing" className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800">
                {t('offer:viewPlans')}
              </Link>
              <button type="button" onClick={onClose} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-500 transition hover:bg-slate-100">
                {t('offer:notNow')}
              </button>
            </div>
          </div>
        ) : (
        <>
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
          {/* 01 · 选户型 */}
          {units.length > 0 && (
            <section>
              <StepLabel n="1" right={!selUnit && <span className="text-[11px] font-medium text-amber-600">{t('offer:required')}</span>}>
                {t('offer:unit')}
              </StepLabel>
              {bedsOptions.length > 1 && (
                <div className="mb-2.5 flex flex-wrap gap-1.5">
                  <button type="button" onClick={() => setSelBeds('all')}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                      selBeds === 'all' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}>
                    {t('offer:all')}
                  </button>
                  {bedsOptions.map((b) => (
                    <button key={b} type="button" onClick={() => setSelBeds(b)}
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                        selBeds === b ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}>
                      {bedsLabel(b)}
                    </button>
                  ))}
                </div>
              )}
              <div className="max-h-60 space-y-1.5 overflow-y-auto pr-1">
                {list.map((u) => {
                  const active = u.id === selUnitId
                  const p = Number(u.price) || 0
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => pickUnit(u.id)}
                      className={`flex w-full items-center gap-3 rounded-xl border p-2.5 text-left transition-all ${
                        active ? 'border-teal-500 bg-teal-50/60 ring-1 ring-teal-500' : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      {u.floor_plan_image
                        ? <img src={u.floor_plan_image} alt="" className="h-11 w-11 shrink-0 rounded-lg border border-slate-100 bg-white object-contain" loading="lazy" />
                        : <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[10px] font-bold text-slate-400">{bedsLabel(u.bedrooms)}</div>}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-slate-800">{u.unit_type_name || bedsLabel(u.bedrooms)}</div>
                        <div className="mt-0.5 truncate text-[11px] text-slate-400">
                          {bedsLabel(u.bedrooms)}
                          {u.area ? ` · ${u.area} Sq.Ft` : ''}
                          {u.view_type ? ` · ${u.view_type}` : ''}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        {p > 0
                          ? <div className="text-sm font-bold text-slate-800"><DirhamSymbol size="0.8em" /> {formatMoneyCompact(p, i18n.language)}</div>
                          : <div className="text-[11px] text-slate-300">{t('offer:k')}</div>}
                      </div>
                      <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                        active ? 'border-teal-500 bg-teal-500' : 'border-slate-300'
                      }`}>
                        {active && <Check className="h-3 w-3 text-white" />}
                      </div>
                    </button>
                  )
                })}
              </div>
            </section>
          )}

          {/* 02 · 报价:原价 → 折扣(% 或直减)→ 成交总价自动算。
              折扣是主输入(2026-07-12 用户定:经纪谈的是"开发商给几个点",
              直接填最终总价不直观);三个框互相联动,填哪个都行。 */}
          <section>
            <StepLabel n={units.length > 0 ? '2' : '1'}>{t('offer:quote2')}</StepLabel>

            <div className="space-y-2">
              {/* 原价(选中户型自动填,可改) */}
              <div className="flex items-center gap-2">
                <span className="w-16 shrink-0 text-xs font-medium text-slate-500">{t('offer:listPrice')}</span>
                <div className="flex flex-1 items-center overflow-hidden rounded-xl border border-slate-200 bg-white focus-within:border-slate-400">
                  <span className="flex items-center pl-3 pr-1 text-slate-400"><DirhamSymbol size="0.9em" /></span>
                  <MoneyInput
                    value={origInput}
                    onChange={applyOrig}
                    placeholder={t('offer:listPrice2')}
                    className="w-full bg-transparent py-2 pr-3 text-sm font-semibold text-slate-800 outline-none"
                  />
                </div>
              </div>

              {/* 折扣:% / AED 直减两种模式 */}
              <div className="flex items-center gap-2">
                <span className="w-16 shrink-0 text-xs font-medium text-slate-500">{t('offer:discount')}</span>
                <div className="flex shrink-0 overflow-hidden rounded-lg bg-slate-100 p-0.5">
                  {(['pct', 'amt'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => switchMode(m)}
                      className={`px-2.5 py-1 text-xs font-bold transition-colors ${
                        discMode === m ? 'rounded-md bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-600'
                      }`}
                    >
                      {m === 'pct' ? '%' : 'AED'}
                    </button>
                  ))}
                </div>
                <div className={`flex flex-1 items-center overflow-hidden rounded-xl border bg-white focus-within:border-rose-400 ${
                  discount ? 'border-rose-200' : 'border-slate-200'
                }`}>
                  {discMode === 'pct' ? (
                    <input
                      value={discInput}
                      onChange={(e) => applyDisc(e.target.value.replace(/[^0-9.]/g, '').slice(0, 5))}
                      inputMode="decimal"
                      disabled={!orig}
                      placeholder={t('offer:eG8')}
                      className="w-full bg-transparent px-3 py-2 text-sm font-semibold text-slate-800 outline-none disabled:bg-slate-50 disabled:placeholder:text-slate-300"
                    />
                  ) : (
                    <MoneyInput
                      value={discInput}
                      onChange={(raw) => applyDisc(raw)}
                      disabled={!orig}
                      placeholder={t('offer:amountOff')}
                      className="w-full bg-transparent px-3 py-2 text-sm font-semibold text-slate-800 outline-none disabled:bg-slate-50 disabled:placeholder:text-slate-300"
                    />
                  )}
                  <span className="shrink-0 pr-3 text-xs font-medium text-slate-400">{discMode === 'pct' ? '%' : 'AED'}</span>
                </div>
              </div>

              {/* 成交总价:自动算出,也可直接改(反算折扣) */}
              <div className="flex items-center gap-2">
                <span className="w-16 shrink-0 text-xs font-bold text-slate-700">{t('offer:netPrice')}</span>
                <div className="flex flex-1 items-center overflow-hidden rounded-xl border-2 border-slate-200 bg-white focus-within:border-slate-900">
                  <span className="flex items-center pl-3 pr-1 text-slate-400"><DirhamSymbol size="1em" /></span>
                  <MoneyInput
                    value={priceInput}
                    onChange={applyPrice}
                    placeholder={t('offer:totalPrice')}
                    className="w-full bg-transparent py-2.5 pr-3 text-lg font-bold text-slate-900 outline-none"
                  />
                  {price > 0 && (
                    <span className="shrink-0 pr-3.5 text-xs font-medium text-slate-400">≈ {formatMoneyCompact(price, i18n.language)}</span>
                  )}
                </div>
              </div>
            </div>

            {discount && (
              <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-600 ring-1 ring-rose-100">
                <BadgePercent className="h-3.5 w-3.5" />
                {t('offer:discountShownOnOffer', { pct: discount.pct, amount: formatMoneyCompact(discount.amount, i18n.language) })}
              </div>
            )}
          </section>

          {/* 03 · 付款周期(必填):默认用项目计划,点「调整」导入后自由加减期/
              调比例;项目没录计划时骨架直编(open 时已初始化) */}
          <section>
              <StepLabel
                n={units.length > 0 ? '3' : '2'}
                right={planRows ? (defaultPlanRows.length > 0 && (
                  <button type="button" onClick={() => { setPlanRows(null); setErr(null) }}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700">
                    <RotateCcw className="h-3.5 w-3.5" />{t('offer:reset')}
                  </button>
                )) : (
                  <button type="button" onClick={() => { setPlanRows(defaultPlanRows.map((r) => ({ ...r }))); setErr(null) }}
                    className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-200">
                    <SlidersHorizontal className="h-3.5 w-3.5" />{t('offer:edit')}
                  </button>
                )}
              >
                {t('offer:schedule')}
              </StepLabel>

              {/* 周期条:每段宽=占比、段内直接标该期金额(编辑时实时跟着变) */}
              <div className="mb-2">
                <div className="flex h-8 w-full overflow-hidden rounded-lg">
                  {shownPlanRows.map((r, i) => {
                    const pct = parseFloat(r.pct) || 0
                    if (pct <= 0) return null
                    const w = (pct / Math.max(planTotal, 1)) * 100
                    const amount = price > 0 ? Math.round((pct / 100) * price) : 0
                    return (
                      <div
                        key={i}
                        title={`${r.name} · ${pct}%${amount ? ` · ${amount.toLocaleString('en-US')}` : ''}`}
                        className="flex flex-col items-center justify-center leading-none text-white/95"
                        style={{ width: `${w}%`, background: BAR_COLORS[i % BAR_COLORS.length] }}
                      >
                        {w >= 9 && <span className="text-[10px] font-bold">{amount ? formatMoneyCompact(amount, i18n.language) : `${pct}%`}</span>}
                        {w >= 9 && amount > 0 && <span className="mt-0.5 text-[9px] opacity-80">{pct}%</span>}
                      </div>
                    )
                  })}
                </div>
                <div className="mt-1 flex justify-between text-[10px] text-slate-400">
                  <span>{t('offer:booking')}</span>
                  <span>{t('offer:installments', { shownPlanRows_length: shownPlanRows.length })}</span>
                  <span>{t('offer:handover')}</span>
                </div>
              </div>

              {planRows && (
                <div className="rounded-xl border border-slate-200">
                  <div className="max-h-56 space-y-1 overflow-y-auto p-2">
                    {planRows.map((r, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <span className="w-5 shrink-0 text-center text-[11px] text-slate-300">{i + 1}</span>
                        <input
                          value={r.name}
                          onChange={(e) => patchPlanRow(i, { name: e.target.value.slice(0, 120) })}
                          placeholder={t('offer:milestone')}
                          className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-700 outline-none focus:border-slate-400"
                        />
                        <div className="flex w-[72px] shrink-0 items-center overflow-hidden rounded-lg border border-slate-200 focus-within:border-slate-400">
                          <input
                            value={r.pct}
                            onChange={(e) => patchPlanRow(i, { pct: e.target.value.replace(/[^0-9.]/g, '').slice(0, 6) })}
                            inputMode="decimal"
                            className="w-full px-2 py-1.5 text-right text-xs font-semibold text-slate-800 outline-none"
                          />
                          <span className="pr-1.5 text-[11px] text-slate-400">%</span>
                        </div>
                        {i === 0 ? (
                          <span className="w-[76px] shrink-0 text-center text-[11px] font-medium text-slate-400">{t('offer:booking2')}</span>
                        ) : (
                          /* 间隔推不出来(原计划只有死日期没锚点/交付期不定)→ 琥珀提醒待填;
                             留空也能生成,报价单上该期不显示时间 */
                          <div
                            title={r.gap === '' ? (t('offer:noIntervalInThe')) : undefined}
                            className={`flex w-[76px] shrink-0 items-center overflow-hidden rounded-lg border focus-within:border-slate-400 ${
                              r.gap === '' ? 'border-amber-300 bg-amber-50/50' : 'border-slate-200'
                            }`}
                          >
                            <span className="pl-1.5 text-[10px] text-slate-300">+</span>
                            <input
                              value={r.gap}
                              onChange={(e) => patchPlanRow(i, { gap: e.target.value.replace(/[^0-9]/g, '').slice(0, 3) })}
                              inputMode="numeric"
                              placeholder={t('offer:tbd')}
                              className="w-full bg-transparent px-1 py-1.5 text-right text-xs text-slate-600 outline-none placeholder:text-[10px] placeholder:text-amber-500/80"
                            />
                            <span className="pr-1.5 text-[11px] text-slate-400">{t('offer:mo')}</span>
                          </div>
                        )}
                        {price > 0 && (
                          <span className="hidden w-16 shrink-0 text-right text-[10px] tabular-nums text-slate-400 sm:block">
                            {formatMoneyCompact(Math.round(((parseFloat(r.pct) || 0) / 100) * price), i18n.language)}
                          </span>
                        )}
                        <button type="button" onClick={() => setPlanRows((rows) => rows!.filter((_, j) => j !== i))}
                          aria-label={t('offer:remove')}
                          className="shrink-0 rounded-lg p-1.5 text-slate-300 transition hover:bg-rose-50 hover:text-rose-500">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/70 px-3 py-2">
                    <button type="button"
                      onClick={() => setPlanRows((rows) => [...(rows || []), { name: t('offer:newInstallment'), pct: '5', gap: '3' }])}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:text-teal-800">
                      <Plus className="h-3.5 w-3.5" />{t('offer:addInstallment')}
                    </button>
                    <span className={`text-xs font-bold tabular-nums ${planValid ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {t('offer:total')} {planTotal.toFixed(planTotal % 1 ? 2 : 0)}%
                      {!planValid && <span className="ml-1 font-semibold">{t('offer:mustBe100')}</span>}
                    </span>
                  </div>
                </div>
              )}
          </section>

          {err && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600">{err}</div>}

          {/* 落款名片:报价单以经纪名片(姓名/头像/电话/邮箱+认证章)落款 */}
          <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3.5 py-2.5">
            <span className="text-xs text-slate-500">
              {t('offer:theOfferIsSigned')}
            </span>
            <button
              type="button"
              onClick={() => setCardOpen(true)}
              className="shrink-0 text-xs font-semibold text-teal-700 underline-offset-2 hover:underline"
            >
              {t('offer:editCard')}
            </button>
          </div>
        </div>

        {/* 底部操作:生成成功直接跳 /pp/:code 看成果 */}
        <div className="border-t border-slate-100 bg-slate-50/80 px-6 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 text-xs text-slate-500">
              {selUnit
                ? <span className="truncate">{selUnit.unit_type_name || bedsLabel(selUnit.bedrooms)} · <DirhamSymbol size="0.8em" /> {price > 0 ? price.toLocaleString('en-US') : '—'}</span>
                : units.length > 0
                  ? <span className="font-medium text-amber-600">{t('offer:selectAUnitFirst')}</span>
                  : <span>{t('offer:projectLevelQuote')}{price > 0 ? ` · ${price.toLocaleString('en-US')}` : ''}</span>}
              {planRows && <span className="ml-1.5 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">{t('offer:customSchedule')}</span>}
            </div>
            <button
              type="button"
              onClick={generate}
              disabled={sharing || !canGenerate}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-40"
            >
              {sharing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              {t('offer:generateOffer')}
            </button>
          </div>
        </div>
        </>
        )}
      </div>

      {/* 名片编辑(z-[10001],叠在本弹窗之上) */}
      {cardOpen && <AgentCardEditor onClose={() => setCardOpen(false)} />}
    </div>,
    document.body
  )
}
