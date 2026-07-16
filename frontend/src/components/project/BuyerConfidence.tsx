/**
 * BuyerConfidence — 海外/中国买家最看重、原先缺失的"投资信心"信息条:
 *   • 黄金签证资格(价格 ≥ AED 200万 → 10年居留)—— 由价格直接算,无需新数据
 *   • 迪拜投资优势:永久产权 / 零资本利得税 / 零房产税(迪拜普适事实)
 *   • 交付进度条 + 预计交房(数据已有:construction_progress / handover_date)
 *
 * 放在 OverviewTab(详情页 + 带看抽屉共用)。双语内联,不引新 i18n key。
 */
import { Sparkles, KeyRound, Receipt, ShieldCheck, HardHat, CalendarClock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ResidentialProject } from '../../types'

const GOLDEN_VISA_THRESHOLD = 2_000_000

function quarterLabel(dateStr: string, t: (k: string, o?: Record<string, unknown>) => string): string | null {
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return null
  const q = Math.floor(d.getMonth() / 3) + 1
  const y = d.getFullYear()
  return t('projectDetail:q', { y, q })
}

export default function BuyerConfidence({ project }: { project: ResidentialProject }) {
  const { t: tRaw } = useTranslation('projectDetail')
  const t = tRaw as (k: string, o?: Record<string, unknown>) => string

  const price = project.starting_price ?? project.min_price ?? 0
  const goldenVisa = price >= GOLDEN_VISA_THRESHOLD

  const progress = Number(project.construction_progress)
  const hasProgress = Number.isFinite(progress) && progress > 0 && progress < 100 && project.status === 'under-construction'

  const handoverRaw = project.handover_date || project.completion_date
  const handover = handoverRaw ? quarterLabel(handoverRaw, t) : null
  const handed = project.status === 'completed' || project.status === 'handed-over'

  return (
    <div className="space-y-3">
      {/* Golden Visa — the single highest-impact flag for overseas buyers */}
      {goldenVisa && (
        <div className="flex items-center gap-3 rounded-xl bg-gradient-to-r from-amber-50 to-yellow-50 p-3.5 ring-1 ring-amber-200">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100">
            <Sparkles className="h-5 w-5 text-amber-600" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold text-amber-900">{t('projectDetail:goldenVisaEligible')}</div>
            <div className="text-xs text-amber-700">
              {t('projectDetail:aed2mInvestment10')}
            </div>
          </div>
        </div>
      )}

      {/* Dubai investor advantages — universal, removes "is it freehold / taxed?" doubt */}
      <div className="flex flex-wrap gap-2">
        <Chip icon={<KeyRound className="h-3.5 w-3.5" />} text={t('projectDetail:freehold')} />
        <Chip icon={<Receipt className="h-3.5 w-3.5" />} text={t('projectDetail:noCapitalGainsTax')} />
        <Chip icon={<ShieldCheck className="h-3.5 w-3.5" />} text={t('projectDetail:noPropertyTax')} />
      </div>

      {/* Construction progress + handover — off-plan buyers' #1 anxiety */}
      {(hasProgress || handover || handed) && (
        <div className="rounded-xl bg-slate-50 p-3.5 ring-1 ring-slate-900/[0.04]">
          {hasProgress && (
            <>
              <div className="mb-1.5 flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 font-medium text-slate-600">
                  <HardHat className="h-3.5 w-3.5 text-teal-600" />
                  {t('projectDetail:constructionProgress')}
                </span>
                <span className="font-bold text-teal-700">{Math.round(progress)}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                <div className="h-full rounded-full bg-gradient-to-r from-teal-500 to-emerald-500" style={{ width: `${Math.round(progress)}%` }} />
              </div>
            </>
          )}
          {(handover || handed) && (
            <div className={`flex items-center gap-1.5 text-xs text-slate-600 ${hasProgress ? 'mt-2.5' : ''}`}>
              <CalendarClock className="h-3.5 w-3.5 text-slate-400" />
              {handed
                ? <span className="font-medium text-emerald-700">{t('projectDetail:handedOver')}</span>
                : <span>{t('projectDetail:estHandover')} <span className="font-semibold text-slate-800">{handover}</span></span>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Chip({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-700 ring-1 ring-teal-100">
      {icon}
      {text}
    </span>
  )
}
