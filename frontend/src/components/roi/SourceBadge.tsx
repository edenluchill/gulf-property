/**
 * 来源徽章 —— 🔵 DLD 实测 / ⚪ 你的假设。
 *
 * 这不是装饰。蒙特卡洛的输出长得极其权威(「IRR 中位数 7.4%,亏钱概率 3%」),
 * 而它的可信度完全取决于输入先验,用户一眼看不出来哪些是真数据。每个自动带出的
 * 数字**必须**挂徽章 —— 见 docs/map-timeline-and-roi-calculator-spec.md §③。
 */
import { useTranslation } from 'react-i18next'
import type { SourceKind } from '../../lib/roi/priors'
import { cn } from '../../lib/utils'

interface Props {
  source: SourceKind
  /** 悬停/长按显示的出处细节(如「Dubai Marina · 1,204 份租约 · 截至 2026-05」) */
  detail?: string
  className?: string
}

export default function SourceBadge({ source, detail, className }: Props) {
  const { t } = useTranslation('roi')
  const isDld = source === 'dld'
  return (
    <span
      title={detail}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none',
        isDld ? 'bg-sky-50 text-sky-700 ring-1 ring-sky-200' : 'bg-slate-100 text-slate-500 ring-1 ring-slate-200',
        className
      )}
    >
      <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', isDld ? 'bg-sky-500' : 'bg-slate-300')} />
      {isDld ? t('badge.dld') : t('badge.assumption')}
    </span>
  )
}
