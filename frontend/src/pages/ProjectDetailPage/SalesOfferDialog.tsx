import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'
import { X, Check, Loader2, BadgePercent, FileText, Plus, Trash2, RotateCcw, SlidersHorizontal, Lock } from 'lucide-react'
import { PaymentPlan, UnitType } from '../../types'
import { useTranslation } from 'react-i18next'
import { formatMoneyCompact } from '../../lib/money'
import DirhamSymbol from '../../components/DirhamSymbol'
import { API_BASE_URL } from '../../lib/config'
import { useAuth } from '../../contexts/AuthContext'
import MoneyInput from '../../components/MoneyInput'

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

/** 两个日期差多少个月(粗粒度,30.44 天/月),解析失败返回 null */
function monthGap(a?: string | null, b?: string | null): number | null {
  if (!a || !b) return null
  const da = new Date(a).getTime()
  const db = new Date(b).getTime()
  if (!Number.isFinite(da) || !Number.isFinite(db)) return null
  return Math.max(0, Math.round((db - da) / (30.44 * 24 * 3600 * 1000)))
}

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
  const { i18n } = useTranslation()
  const zh = (i18n.language || 'en').startsWith('zh')
  const { session } = useAuth()
  const navigate = useNavigate()

  const [selBeds, setSelBeds] = useState<number | 'all'>('all')
  const [selUnitId, setSelUnitId] = useState<string>('')
  const [priceInput, setPriceInput] = useState<string>('')
  const [sharing, setSharing] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // 付款周期(可谈):null = 项目默认;点「调整」导入默认计划开编。
  // 间隔优先级:interval_months > 相邻 milestone_date 差 > 空。
  const defaultPlanRows = useMemo<PlanRow[]>(() => {
    const sorted = paymentPlan.slice().sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
    return sorted.map((m, i) => {
      const fromDates = monthGap(sorted[i - 1]?.milestone_date, m.milestone_date)
      const gap = i === 0 ? 0 : (Number(m.interval_months) || fromDates)
      return {
        name: m.milestone_name || (zh ? `第 ${i + 1} 期` : `Installment ${i + 1}`),
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
    // 没有户型数据的项目 → 起价预填进输入框(有户型的等选中户型再填)
    setSelBeds('all'); setSelUnitId('')
    setPriceInput(units.length === 0 && Number(referencePrice) > 0 ? String(Math.round(Number(referencePrice))) : '')
    setErr(null)
    setPlanRows(defaultPlanRows.length === 0
      ? [
          { name: zh ? '签约定金' : 'Down Payment', pct: '20', gap: '' },
          { name: zh ? '交付时' : 'On Completion', pct: '80', gap: '' },
        ]
      : null)
  }, [open, projectId, defaultPlanRows, zh, units.length, referencePrice])

  const patchPlanRow = (i: number, patch: Partial<PlanRow>) => {
    setPlanRows((rows) => (rows ? rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) : rows))
    setErr(null)
  }

  const bedsLabel = (b: number) => (b === 0 ? (zh ? '工作室' : 'Studio') : zh ? `${b} 居` : `${b} BR`)

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
  const unitPrice = Math.round(Number(selUnit?.price) || 0)

  // 价格 = 输入框唯一真相(选户型/起价会预填进去);空 = 0,不做隐性回退
  // (回退会让输入框"删不完",2026-07-07 用户实锤)
  const typed = parseInt(priceInput || '0', 10)
  const price = Number.isFinite(typed) && typed > 0 ? typed : 0
  // 差价优惠只在「所选户型有原价」且报价更低时成立(对齐开发商 offer 的 Discount 行)
  const discount = unitPrice > 0 && price > 0 && price < unitPrice
    ? { amount: unitPrice - price, pct: Math.round(((unitPrice - price) / unitPrice) * 1000) / 10 }
    : null

  // 选中户型 → 标价直接填进价格框(经纪在此基础上改实际报价);户型必选,
  // 不做"再点一下取消"。
  const pickUnit = (id: string) => {
    setSelUnitId(id)
    const p2 = Math.round(Number(units.find((u) => u.id === id)?.price) || 0)
    setPriceInput(p2 > 0 ? String(p2) : '')
    setErr(null)
  }

  // 必填校验:户型(有户型数据的项目)/ 价格 / 周期(合计 100%)
  const unitOk = units.length === 0 || !!selUnit
  const planOk = shownPlanRows.length > 0 && (planRows ? planValid : true)
  const canGenerate = price > 0 && unitOk && planOk

  const generate = async () => {
    if (!price || sharing) return
    if (!unitOk) {
      setErr(zh ? '请先选择户型' : 'Please select a unit first')
      return
    }
    if (!planOk) {
      setErr(zh ? `付款周期各期比例合计需为 100%(当前 ${planTotal.toFixed(2)}%)` : `Installments must add up to 100% (now ${planTotal.toFixed(2)}%)`)
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
          originalPrice: discount ? unitPrice : undefined,
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
      setErr(e instanceof Error && e.message !== 'failed' ? e.message : (zh ? '生成失败,请重试' : 'Failed, please retry'))
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
                {zh ? '报价单' : 'Quote'}
              </span>
            </div>
            <div className="mt-1 text-xs text-slate-400">{projectName}</div>
          </div>
          <button type="button" onClick={onClose} aria-label={zh ? '关闭' : 'Close'}
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
              {zh ? 'Sales Offer 是经纪会员功能' : 'Sales Offer is a member feature'}
            </h3>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-slate-500">
              {zh
                ? '订阅任意经纪套餐($25/月起)即可生成带认证盖章与优惠标注的正式报价单,链接 / PDF 一键发客户。'
                : 'Subscribe to any agent plan (from $25/mo) to create formal offers with your certification stamp — link or PDF.'}
            </p>
            <div className="mt-6 flex items-center justify-center gap-3">
              <Link to="/pricing" className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800">
                {zh ? '查看套餐' : 'View plans'}
              </Link>
              <button type="button" onClick={onClose} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-500 transition hover:bg-slate-100">
                {zh ? '稍后再说' : 'Not now'}
              </button>
            </div>
          </div>
        ) : (
        <>
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
          {/* 01 · 选户型 */}
          {units.length > 0 && (
            <section>
              <StepLabel n="1" right={!selUnit && <span className="text-[11px] font-medium text-amber-600">{zh ? '必选' : 'Required'}</span>}>
                {zh ? '选户型' : 'Unit'}
              </StepLabel>
              {bedsOptions.length > 1 && (
                <div className="mb-2.5 flex flex-wrap gap-1.5">
                  <button type="button" onClick={() => setSelBeds('all')}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                      selBeds === 'all' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}>
                    {zh ? '全部' : 'All'}
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
                          : <div className="text-[11px] text-slate-300">{zh ? '未标价' : '—'}</div>}
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

          {/* 02 · 填报价 */}
          <section>
            <StepLabel n={units.length > 0 ? '2' : '1'}>{zh ? '报价' : 'Quote'}</StepLabel>
            <div className="flex items-center overflow-hidden rounded-xl border-2 border-slate-200 bg-white focus-within:border-slate-900">
              <span className="flex items-center pl-3.5 pr-1 text-slate-400"><DirhamSymbol size="1em" /></span>
              <MoneyInput
                value={priceInput}
                onChange={(raw) => { setPriceInput(raw); setErr(null) }}
                placeholder={zh ? '输入总价' : 'Total price'}
                className="w-full bg-transparent py-2.5 pr-3 text-lg font-bold text-slate-900 outline-none"
              />
              {price > 0 && (
                <span className="shrink-0 pr-3.5 text-xs font-medium text-slate-400">≈ {formatMoneyCompact(price, i18n.language)}</span>
              )}
            </div>
            {discount && (
              <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-600 ring-1 ring-rose-100">
                <BadgePercent className="h-3.5 w-3.5" />
                {zh
                  ? `优惠 ${discount.pct}%,省 ${formatMoneyCompact(discount.amount, i18n.language)},将标注在报价单上`
                  : `${discount.pct}% off (save ${formatMoneyCompact(discount.amount, i18n.language)}) — shown on the offer`}
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
                    <RotateCcw className="h-3.5 w-3.5" />{zh ? '恢复默认' : 'Reset'}
                  </button>
                )) : (
                  <button type="button" onClick={() => { setPlanRows(defaultPlanRows.map((r) => ({ ...r }))); setErr(null) }}
                    className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-200">
                    <SlidersHorizontal className="h-3.5 w-3.5" />{zh ? '调整' : 'Edit'}
                  </button>
                )}
              >
                {zh ? '付款周期' : 'Schedule'}
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
                  <span>{zh ? '签约' : 'Booking'}</span>
                  <span>{zh ? `${shownPlanRows.length} 期` : `${shownPlanRows.length} installments`}</span>
                  <span>{zh ? '交付' : 'Handover'}</span>
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
                          placeholder={zh ? '付款节点' : 'Milestone'}
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
                          <span className="w-[76px] shrink-0 text-center text-[11px] font-medium text-slate-400">{zh ? '签约时' : 'Booking'}</span>
                        ) : (
                          /* 间隔推不出来(原计划只有死日期没锚点/交付期不定)→ 琥珀提醒待填;
                             留空也能生成,报价单上该期不显示时间 */
                          <div
                            title={r.gap === '' ? (zh ? '原计划未标明间隔,可补填;留空则报价单该期不显示时间' : 'No interval in the source plan — fill it in, or leave empty to omit') : undefined}
                            className={`flex w-[76px] shrink-0 items-center overflow-hidden rounded-lg border focus-within:border-slate-400 ${
                              r.gap === '' ? 'border-amber-300 bg-amber-50/50' : 'border-slate-200'
                            }`}
                          >
                            <span className="pl-1.5 text-[10px] text-slate-300">+</span>
                            <input
                              value={r.gap}
                              onChange={(e) => patchPlanRow(i, { gap: e.target.value.replace(/[^0-9]/g, '').slice(0, 3) })}
                              inputMode="numeric"
                              placeholder={zh ? '待填' : 'TBD'}
                              className="w-full bg-transparent px-1 py-1.5 text-right text-xs text-slate-600 outline-none placeholder:text-[10px] placeholder:text-amber-500/80"
                            />
                            <span className="pr-1.5 text-[11px] text-slate-400">{zh ? '月' : 'mo'}</span>
                          </div>
                        )}
                        {price > 0 && (
                          <span className="hidden w-16 shrink-0 text-right text-[10px] tabular-nums text-slate-400 sm:block">
                            {formatMoneyCompact(Math.round(((parseFloat(r.pct) || 0) / 100) * price), i18n.language)}
                          </span>
                        )}
                        <button type="button" onClick={() => setPlanRows((rows) => rows!.filter((_, j) => j !== i))}
                          aria-label={zh ? '删除本期' : 'Remove'}
                          className="shrink-0 rounded-lg p-1.5 text-slate-300 transition hover:bg-rose-50 hover:text-rose-500">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/70 px-3 py-2">
                    <button type="button"
                      onClick={() => setPlanRows((rows) => [...(rows || []), { name: zh ? '新增一期' : 'New installment', pct: '5', gap: '3' }])}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:text-teal-800">
                      <Plus className="h-3.5 w-3.5" />{zh ? '添加一期' : 'Add installment'}
                    </button>
                    <span className={`text-xs font-bold tabular-nums ${planValid ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {zh ? '合计' : 'Total'} {planTotal.toFixed(planTotal % 1 ? 2 : 0)}%
                      {!planValid && <span className="ml-1 font-semibold">{zh ? '(需为 100%)' : '(must be 100%)'}</span>}
                    </span>
                  </div>
                </div>
              )}
          </section>

          {err && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600">{err}</div>}
        </div>

        {/* 底部操作:生成成功直接跳 /pp/:code 看成果 */}
        <div className="border-t border-slate-100 bg-slate-50/80 px-6 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 text-xs text-slate-500">
              {selUnit
                ? <span className="truncate">{selUnit.unit_type_name || bedsLabel(selUnit.bedrooms)} · <DirhamSymbol size="0.8em" /> {price > 0 ? price.toLocaleString('en-US') : '—'}</span>
                : units.length > 0
                  ? <span className="font-medium text-amber-600">{zh ? '请先选择户型' : 'Select a unit first'}</span>
                  : <span>{zh ? '按项目报价' : 'Project-level quote'}{price > 0 ? ` · ${price.toLocaleString('en-US')}` : ''}</span>}
              {planRows && <span className="ml-1.5 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">{zh ? '自定义周期' : 'Custom schedule'}</span>}
            </div>
            <button
              type="button"
              onClick={generate}
              disabled={sharing || !canGenerate}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-40"
            >
              {sharing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              {zh ? '生成报价单' : 'Generate offer'}
            </button>
          </div>
        </div>
        </>
        )}
      </div>
    </div>,
    document.body
  )
}
