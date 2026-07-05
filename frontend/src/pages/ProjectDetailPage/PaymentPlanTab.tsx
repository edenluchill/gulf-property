import { useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { PaymentPlan, UnitType } from '../../types'
import { useTranslation } from 'react-i18next'
import { Share2, Check, Copy, Loader2, Pencil } from 'lucide-react'
import PaymentTimeline from '../../components/project/PaymentTimeline'
import PaymentChart from '../../components/project/PaymentChart'
import { formatMoneyCompact } from '../../lib/money'
import DirhamSymbol from '../../components/DirhamSymbol'
import { API_BASE_URL } from '../../lib/config'
import { useAuth } from '../../contexts/AuthContext'
import { normalizePaymentPlan } from '../../lib/paymentPlan'

interface PaymentPlanTabProps {
  paymentPlan: PaymentPlan[]
  referencePrice?: number
  units?: UnitType[]
  /** 传入后启用「转发给客户」分享(生成 /pp/:code 公开页) */
  projectId?: string
  projectName?: string
}

/**
 * 付款计划(经纪工作流,合伙人需求 2026-07-05):
 *   1. 选户型(按居室分组,不再铺 30+ 个药丸)
 *   2. 填总价 —— 开发商开盘只给起价,楼层/朝向不同价格不同,经纪手填实际报价
 *   3. 图表 + 每期明细即时按该价换算
 *   4. 一键生成客户可看的分享页 /pp/:code(免登录)
 */
export function PaymentPlanTab({ paymentPlan, referencePrice, units = [], projectId, projectName }: PaymentPlanTabProps) {
  const { t, i18n } = useTranslation(['project', 'common'])
  const zh = (i18n.language || 'en').startsWith('zh')
  const { session } = useAuth()

  // JSONB 两种历史键名(camelCase / snake_case)→ 统一成 PaymentPlan
  const plan = useMemo(() => normalizePaymentPlan(paymentPlan), [paymentPlan])

  // 有报价的户型,按居室分组(组内按价升序)
  const priced = useMemo(
    () => units.filter((u) => (u.price ?? 0) > 0).sort((a, b) => (a.price! - b.price!)),
    [units]
  )
  const groups = useMemo(() => {
    const m = new Map<number, UnitType[]>()
    for (const u of priced) {
      const b = u.bedrooms ?? -1
      if (!m.has(b)) m.set(b, [])
      m.get(b)!.push(u)
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0])
  }, [priced])

  const [selBeds, setSelBeds] = useState<number | 'ref'>('ref')
  const [selUnitId, setSelUnitId] = useState<string>('')
  // 经纪手填的实际报价(纯数字字符串);空 = 跟随所选户型/起价
  const [priceInput, setPriceInput] = useState<string>('')
  const [share, setShare] = useState<{ url: string } | null>(null)
  const [sharing, setSharing] = useState(false)
  const [copied, setCopied] = useState(false)

  const bedsLabel = (b: number) => (b === 0 ? (zh ? '工作室' : 'Studio') : zh ? `${b} 居` : `${b} BR`)

  const groupUnits = selBeds === 'ref' ? [] : (groups.find(([b]) => b === selBeds)?.[1] || [])
  const selUnit = groupUnits.find((u) => u.id === selUnitId) || null

  // 基准价:具体户型 > 组内最低 > 起价。
  // Number():price 经 PG numeric 返回可能是字符串("1800000.00"),不转的话
  // toLocaleString 静默失效,输入框会显示原始串。
  const basePrice = Math.round(Number(
    selBeds === 'ref'
      ? (referencePrice || 0)
      : (selUnit?.price || groupUnits[0]?.price || referencePrice || 0)
  ) || 0)
  const typedPrice = parseInt(priceInput.replace(/[^0-9]/g, ''), 10)
  const activePrice = Number.isFinite(typedPrice) && typedPrice > 0 ? typedPrice : basePrice
  const priceEdited = Number.isFinite(typedPrice) && typedPrice > 0 && typedPrice !== basePrice

  const pick = (beds: number | 'ref', unitId = '') => {
    setSelBeds(beds)
    setSelUnitId(unitId)
    setPriceInput('')   // 换户型 → 回到该户型报价
    setShare(null)      // 参数变了,旧链接作废
    setCopied(false)
  }

  const onPriceChange = (v: string) => {
    setPriceInput(v.replace(/[^0-9]/g, '').slice(0, 11))
    setShare(null)
    setCopied(false)
  }

  const unitShareLabel = selUnit?.unit_type_name
    || (selBeds !== 'ref' ? bedsLabel(selBeds as number) : '')

  const createShare = async () => {
    if (!projectId || !activePrice || sharing) return
    setSharing(true)
    try {
      const headers: HeadersInit = { 'Content-Type': 'application/json' }
      if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`
      const r = await fetch(`${API_BASE_URL}/api/luna/public/payplan`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          projectId,
          unitName: unitShareLabel || undefined,
          bedrooms: selUnit?.bedrooms ?? (selBeds !== 'ref' ? selBeds : undefined),
          price: activePrice,
          lang: zh ? 'zh' : 'en',
        }),
      })
      const j = await r.json()
      if (!r.ok || !j.code) throw new Error(j.error || 'failed')
      const url = `${window.location.origin}/pp/${j.code}`
      setShare({ url })
      // 移动端直接唤起系统分享;失败/桌面 → 链接留在面板里复制
      if (navigator.share) {
        navigator.share({
          title: `${projectName || ''} ${zh ? '付款计划' : 'Payment Plan'}`.trim(),
          url,
        }).catch(() => {})
      }
    } catch {
      alert(zh ? '生成分享链接失败,请重试' : 'Failed to create share link, please retry')
    } finally {
      setSharing(false)
    }
  }

  const copyLink = async () => {
    if (!share) return
    try {
      await navigator.clipboard.writeText(share.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard 不可用时用户可长按链接复制 */ }
  }

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
        <CardTitle>{t('project:paymentPlanTab.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* ① 选户型:按居室分组(代替原来 30+ 药丸墙) */}
        {(groups.length > 0 || (referencePrice || 0) > 0) && (
          <div>
            <div className="mb-2 flex items-baseline gap-2">
              <span className="text-sm font-semibold text-slate-800">{zh ? '① 选户型' : '① Unit type'}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(referencePrice || 0) > 0 && (
                <button
                  type="button"
                  onClick={() => pick('ref')}
                  className={`rounded-full px-3.5 py-2 text-sm font-semibold transition-colors ${
                    selBeds === 'ref' ? 'bg-primary text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {zh ? '起价' : 'From'}
                  <span className={selBeds === 'ref' ? 'ml-1.5 opacity-90' : 'ml-1.5 text-slate-400'}>
                    <DirhamSymbol size="0.8em" />{formatMoneyCompact(referencePrice!, i18n.language)}
                  </span>
                </button>
              )}
              {groups.map(([beds, us]) => (
                <button
                  key={beds}
                  type="button"
                  onClick={() => pick(beds)}
                  className={`rounded-full px-3.5 py-2 text-sm font-semibold transition-colors ${
                    selBeds === beds ? 'bg-primary text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {bedsLabel(beds)}
                  <span className={selBeds === beds ? 'ml-1.5 opacity-90' : 'ml-1.5 text-slate-400'}>
                    <DirhamSymbol size="0.8em" />{formatMoneyCompact(us[0].price!, i18n.language)}{zh ? ' 起' : '+'}
                  </span>
                </button>
              ))}
            </div>

            {/* 具体户型(可选,同居室多个型号时) */}
            {groupUnits.length > 1 && (
              <select
                value={selUnitId}
                onChange={(e) => { setSelUnitId(e.target.value); setPriceInput(''); setShare(null); setCopied(false) }}
                className="mt-2 w-full max-w-md rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
              >
                <option value="">{zh ? `全部${bedsLabel(selBeds as number)}(按最低价计算)` : `Any ${bedsLabel(selBeds as number)} (lowest price)`}</option>
                {groupUnits.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.unit_type_name || bedsLabel(u.bedrooms)} — {formatMoneyCompact(u.price!, i18n.language)}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {/* ② 填总价:开发商只给起价,实际报价经纪手填 */}
        <div>
          <div className="mb-2 flex items-baseline gap-2">
            <span className="text-sm font-semibold text-slate-800">{zh ? '② 填总价' : '② Total price'}</span>
            {priceEdited && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                <Pencil className="h-3 w-3" />{zh ? '已改为实际报价' : 'Custom quote'}
              </span>
            )}
          </div>
          <div className="flex max-w-md items-center overflow-hidden rounded-xl border-2 border-slate-200 bg-white focus-within:border-primary">
            <span className="flex items-center pl-3.5 pr-1 text-slate-400"><DirhamSymbol size="1em" /></span>
            <input
              type="text"
              inputMode="numeric"
              value={priceInput ? Number(priceInput).toLocaleString('en-US') : (basePrice ? basePrice.toLocaleString('en-US') : '')}
              onChange={(e) => onPriceChange(e.target.value)}
              placeholder={zh ? '输入总价' : 'Enter total price'}
              className="w-full bg-transparent py-2.5 pr-3 text-lg font-bold text-slate-900 outline-none"
            />
            {activePrice > 0 && (
              <span className="shrink-0 pr-3.5 text-xs font-medium text-slate-400">
                ≈ {formatMoneyCompact(activePrice, i18n.language)}
              </span>
            )}
          </div>
          <p className="mt-1.5 max-w-md text-[11px] leading-relaxed text-slate-400">
            {zh
              ? '开发商开盘只公布起价——不同楼层、朝向价格不同。可直接改成给客户的实际报价,下方每期金额即时换算。'
              : 'Developers only publish starting prices — floors and orientations vary. Type the actual quote and every installment below updates instantly.'}
          </p>
        </div>

        {/* ③ 付款时间线(hover 看每期/累计金额) */}
        {activePrice > 0 && (
          <PaymentChart paymentPlan={plan} price={activePrice} lang={i18n.language} />
        )}

        <PaymentTimeline paymentPlan={plan} referencePrice={activePrice || undefined} lang={i18n.language} />

        {/* ④ 转发给客户:生成免登录分享页 /pp/:code */}
        {projectId && activePrice > 0 && (
          <div className="rounded-2xl border border-teal-100 bg-gradient-to-br from-teal-50/80 to-emerald-50/60 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="text-sm font-bold text-slate-800">{zh ? '转发给客户' : 'Share with client'}</div>
                <div className="mt-0.5 text-xs text-slate-500">
                  {zh
                    ? `生成专属页面:${unitShareLabel || (zh ? '该项目' : '')} · 总价 ${formatMoneyCompact(activePrice, i18n.language)} · 每期应付明细,客户免登录查看`
                    : `A clean page with unit, total price and every installment — no login needed`}
                </div>
              </div>
              <Button
                onClick={createShare}
                disabled={sharing}
                className="shrink-0 bg-teal-600 hover:bg-teal-700"
              >
                {sharing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Share2 className="mr-1.5 h-4 w-4" />}
                {share ? (zh ? '重新生成' : 'Regenerate') : (zh ? '生成分享链接' : 'Create share link')}
              </Button>
            </div>
            {share && (
              <div className="mt-3 flex items-center gap-2 rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200">
                <a href={share.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-sm font-medium text-teal-700 underline-offset-2 hover:underline">
                  {share.url}
                </a>
                <button
                  type="button"
                  onClick={copyLink}
                  className={`flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                    copied ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? (zh ? '已复制' : 'Copied') : (zh ? '复制' : 'Copy')}
                </button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
