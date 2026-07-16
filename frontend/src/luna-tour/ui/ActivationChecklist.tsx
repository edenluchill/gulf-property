/**
 * 试用期激活清单 (2026-07-11,2026-07-12 重排) — 经纪台首屏。
 *
 * 为什么存在:2026-07-11 的漏斗分析发现,唯一那个真实付费经纪进来后 0 报告、
 * 0 报价单、0 客户、0 Luna —— 他绑了卡,什么也没做就走了。把人放进来只是第一步,
 * 没有 aha 时刻的试用只会把「7 天后不续」变成「7 天后蒸发」。
 *
 * ⭐ 2026-07-12 重排(owner 定):三步**全部免费**,一个积分都不花。
 *
 * 旧版推的是「品牌提案(20分)+ 生成 Luna 导览(100分)」。两个问题:
 *   ① 品牌提案还不够成熟,不该拿它当第一印象
 *   ② 让试用用户**先花 100 积分**才能看到 Luna 长什么样,是本末倒置 ——
 *      他还没相信这东西有用,凭什么先付费?
 *
 * 新版推**最成熟的两个功能**,且都零成本:
 *   • 实时带看 —— 现在**免费不限场次**(地图协作成本是 $0)
 *   • Luna 导览 —— 先看**预生成的 demo**(/v/demo),看到效果再决定生成自己的
 *
 * 试用的 200 积分因此完整保留,留给他真正想做的第一件事。
 * 全部完成后本卡自动消失(不打扰已经上手的人)。
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Check, ArrowRight, Users, Radio, Sparkles } from 'lucide-react'
import { lunaFetch } from '../lunaApi'
import { fetchBillingMe } from '../../lib/billingApi'

interface LedgerEntry { feature: string }

/** 看过 Luna demo —— 它是个公开页面,不产生 ledger,只能本地记。 */
const DEMO_SEEN_KEY = 'pz_luna_demo_seen'

export default function ActivationChecklist({ hasClients }: { hasClients: boolean }) {
  const { t: tRaw } = useTranslation('lunaTour')
  const t = tRaw as (k: string, o?: Record<string, unknown>) => string

  const [used, setUsed] = useState<Set<string> | null>(null)
  const [onTrial, setOnTrial] = useState(false)
  const [demoSeen, setDemoSeen] = useState(false)

  useEffect(() => {
    void fetchBillingMe().then((m) => setOnTrial(!!m?.trial?.active))
    try { setDemoSeen(localStorage.getItem(DEMO_SEEN_KEY) === '1') } catch { /* ignore */ }
    void lunaFetch('/ledger?limit=200')
      .then((r) => r.json())
      .then((d) => setUsed(new Set(((d.entries || []) as LedgerEntry[]).map((e) => e.feature))))
      .catch(() => setUsed(new Set()))
  }, [])

  // 只在试用期出现;数据没回来前不闪(避免"先显示未完成再划掉"的抖动)
  if (!onTrial || used === null) return null

  const steps = [
    {
      key: 'client',
      done: hasClients,
      icon: Users,
      to: '/agent/clients',
      title: t('lunaTour:addYourFirstClient'),
      desc: t('lunaTour:profileHeatScoreActivity'),
      cost: t('lunaTour:free2'),
    },
    {
      // 带看现在是免费不限场次的(地图协作成本 $0)—— 最成熟、最能打动客户的功能,
      // 理应排在第一个真正的动作位。ledger 里带看写的是 credits=0 的行,done 判定照常。
      key: 'live_tours',
      done: used.has('live_tours'),
      icon: Radio,
      to: '/?livetour=1',
      title: t('lunaTour:runALiveTour'),
      desc: t('lunaTour:shareYourScreenWith'),
      cost: t('lunaTour:freeUnlimited'),
    },
    {
      // ⚠️ 链到**预生成的 demo**,不是 /agent/tour(那要花 100 积分)。
      // 先让他看到效果,再决定要不要为自己生成一条 —— 顺序反了就没人试。
      key: 'luna_demo',
      done: demoSeen || used.has('luna_tours'),
      icon: Sparkles,
      to: '/v/demo',
      external: true,
      onClick: () => { try { localStorage.setItem(DEMO_SEEN_KEY, '1') } catch { /* ignore */ } },
      title: t('lunaTour:seeWhatALuna'),
      desc: t('lunaTour:aSelfGuidedTour'),
      cost: t('lunaTour:freeNoCredits'),
    },
  ]

  const doneCount = steps.filter((s) => s.done).length
  if (doneCount === steps.length) return null // 已上手 → 不再打扰

  return (
    <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-slate-900">{t('lunaTour:startWithTheseThree')}</h2>
          <p className="mt-0.5 text-[13px] text-slate-500">
            {t('lunaTour:allThreeAreFree')}
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
          {doneCount} / {steps.length}
        </span>
      </div>

      <div className="space-y-2">
        {steps.map((s) => {
          const Icon = s.icon
          if (s.done) {
            return (
              <div key={s.key} className="flex items-center gap-3 rounded-xl bg-emerald-50/60 px-3 py-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500">
                  <Check className="h-4 w-4 text-white" />
                </span>
                <span className="text-sm font-medium text-emerald-800 line-through decoration-emerald-400">{s.title}</span>
              </div>
            )
          }
          const cls = 'group flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5 transition hover:border-emerald-300 hover:bg-emerald-50/40'
          const body = (
            <>
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition group-hover:bg-emerald-100 group-hover:text-emerald-600">
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900">{s.title}</span>
                  <span className="shrink-0 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">{s.cost}</span>
                </span>
                <span className="mt-0.5 block truncate text-xs text-slate-500">{s.desc}</span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-emerald-500 rtl:-scale-x-100" />
            </>
          )
          // Luna demo 开新标签 —— 它是个全屏客户视角的页面,同页跳走就把经纪
          // 从工作台弹出去了,看完还得自己找回来。
          return s.external ? (
            <a key={s.key} href={s.to} target="_blank" rel="noopener noreferrer" onClick={s.onClick} className={cls}>
              {body}
            </a>
          ) : (
            <Link key={s.key} to={s.to} className={cls}>{body}</Link>
          )
        })}
      </div>
    </div>
  )
}
