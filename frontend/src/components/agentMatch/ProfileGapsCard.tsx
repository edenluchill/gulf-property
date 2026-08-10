/**
 * 「还差这些资料」—— 经纪台上的补全提醒。
 *
 * owner 2026-08-09:「经纪的页面能提醒经纪填缺失信息吗」。
 *
 * 实测(2026-08-09)付费/试用 33 人里:填了手机的 2 人、有头像的 15 人、
 * 填了 RERA 牌照的 **0 人**。他们大多不知道这些字段存在,更不知道**不填的后果**。
 *
 * 🔴 **每一条都要说清楚「不填会怎样」,不能只写"资料不完整"。**
 *    「补个手机号」→ 无所谓;「不填的话买家点你时看到的是一个灰头像」→ 会去填。
 *    后果必须是**真的**:下面每条对应的都是代码里实际存在的行为,不是吓唬人。
 *
 * 全部填齐就整个不渲染 —— 一张长期挂着的"✅ 资料完整"卡片只是噪音。
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Phone, Image, BadgeCheck, UserRound, ChevronRight } from 'lucide-react'
import { fetchPoolStatus, type PoolStatus } from '../../lib/agentMatchApi'

export default function ProfileGapsCard() {
  const { t } = useTranslation('misc')
  const [pool, setPool] = useState<PoolStatus | null>(null)

  useEffect(() => { void fetchPoolStatus().then(setPool) }, [])
  // 内部账号(owner 的号/demo)不进派单,催他们补资料没有意义
  if (!pool || pool.internal) return null

  /**
   * 顺序 = 影响从大到小:
   *   手机/邮箱 —— 缺了**完全接不到买家**(硬门槛)
   *   名字     —— 买家看到的是 `502579810` 这种邮箱前缀
   *   头像     —— 买家看到一个灰色占位圆
   *   牌照     —— 有才显示 BRN 徽章;没有就什么都不显示(我们不替人背书)
   */
  /**
   * ⚠️ 键**写死,不拼**(`agentMatch.gap_${k}` 那种)。两个理由:
   *   ① i18n 类型只认字面量,拼出来的过不了 tsc
   *   ② i18n-key-check.mjs 是扫源码的,拼出来的键它看不见 —— 漏翻了也不报警
   */
  const gaps = [
    !pool.has_contact && { key: 'contact', icon: Phone, hard: true, label: t('agentMatch.gap_contact'), why: t('agentMatch.gapWhy_contact') },
    !pool.has_real_name && { key: 'name', icon: UserRound, hard: false, label: t('agentMatch.gap_name'), why: t('agentMatch.gapWhy_name') },
    !pool.has_photo && { key: 'photo', icon: Image, hard: false, label: t('agentMatch.gap_photo'), why: t('agentMatch.gapWhy_photo') },
    !pool.has_brn && { key: 'brn', icon: BadgeCheck, hard: false, label: t('agentMatch.gap_brn'), why: t('agentMatch.gapWhy_brn') },
  ].filter(Boolean) as { key: string; icon: typeof Phone; hard: boolean; label: string; why: string }[]

  if (!gaps.length) return null   // 齐了就不占地方

  return (
    <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">{t('agentMatch.gapsTitle')}</h3>
        <span className="text-[11px] tabular-nums text-slate-400">{gaps.length}</span>
      </div>
      <ul className="mt-2.5 space-y-2">
        {gaps.map((g) => (
          <li key={g.key} className={`flex items-start gap-2.5 rounded-xl px-3 py-2 ${
            g.hard ? 'bg-amber-50' : 'bg-slate-50'
          }`}>
            <g.icon className={`mt-0.5 h-4 w-4 shrink-0 ${g.hard ? 'text-amber-600' : 'text-slate-400'}`} />
            <div className="min-w-0 flex-1">
              <p className={`text-xs font-semibold ${g.hard ? 'text-amber-900' : 'text-slate-700'}`}>
                {g.label}
              </p>
              {/* 后果 —— 这一行才是让人去填的原因 */}
              <p className={`mt-0.5 text-[11px] leading-relaxed ${g.hard ? 'text-amber-800' : 'text-slate-500'}`}>
                {g.why}
              </p>
            </div>
          </li>
        ))}
      </ul>
      <Link to="/profile"
        className="mt-3 inline-flex w-full items-center justify-center gap-1 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-slate-800">
        {t('agentMatch.goComplete')}<ChevronRight className="h-3 w-3 rtl:rotate-180" />
      </Link>
    </div>
  )
}
