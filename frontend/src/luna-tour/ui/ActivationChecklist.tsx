/**
 * 试用期激活清单 (2026-07-11) — 经纪台首屏。
 *
 * 为什么存在:2026-07-11 的漏斗分析发现,唯一那个真实付费经纪进来后 0 报告、
 * 0 报价单、0 客户、0 Luna —— 他绑了卡,什么也没做就走了。把人放进来只是第一步,
 * 没有 aha 时刻的试用只会把「7 天后不续」变成「7 天后蒸发」。
 *
 * 三步都在 200 积分的试用预算内(0 + 20 + 100 = 120),且每步都是一个真实的
 * 「原来还能这样」时刻。全部完成后本卡自动消失(不打扰已经上手的人)。
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Check, ArrowRight, Users, FileText, Sparkles } from 'lucide-react'
import { lunaFetch } from '../lunaApi'
import { fetchBillingMe } from '../../lib/billingApi'

interface LedgerEntry { feature: string }

export default function ActivationChecklist({ hasClients }: { hasClients: boolean }) {
  const { i18n } = useTranslation()
  const zh = !!i18n.language?.startsWith('zh')
  const L = (a: string, b: string) => (zh ? a : b)

  const [used, setUsed] = useState<Set<string> | null>(null)
  const [onTrial, setOnTrial] = useState(false)

  useEffect(() => {
    void fetchBillingMe().then((m) => setOnTrial(!!m?.trial?.active))
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
      title: L('建第一个客户', 'Add your first client'),
      desc: L('档案 + 热度评分 + 活动时间线 —— 之后所有工具都围着他转', 'Profile, heat score, activity timeline — everything else builds on this'),
      cost: L('免费', 'Free'),
    },
    {
      key: 'reports',
      done: used.has('reports'),
      icon: FileText,
      to: '/agent/report',
      title: L('秒出一份品牌提案', 'Generate a branded proposal'),
      desc: L('带你头像与联系方式的项目报告:5 年 ROI + 真实 DLD 成交,链接直接发客户', 'A project report with your face and contact: 5-yr ROI + real DLD deals, share the link'),
      cost: L('20 积分', '20 credits'),
    },
    {
      key: 'luna_tours',
      done: used.has('luna_tours'),
      icon: Sparkles,
      to: '/agent/tour',
      title: L('生成一条 Luna 导览', 'Create a Luna AI tour'),
      desc: L('AI 选盘 + 语音讲解的自助看房链接,客户随时打开,行为回传给你', 'A self-guided tour with AI-picked homes and narration — their activity flows back to you'),
      cost: L('100 积分', '100 credits'),
    },
  ]

  const doneCount = steps.filter((s) => s.done).length
  if (doneCount === steps.length) return null // 已上手 → 不再打扰

  return (
    <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-slate-900">{L('先做这三件事', 'Start with these three')}</h2>
          <p className="mt-0.5 text-[13px] text-slate-500">
            {L('每一步都能立刻发给真实客户 —— 试用积分够全部做一遍', 'Each one is something you can send a real client today — your trial credits cover all three')}
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
          {doneCount} / {steps.length}
        </span>
      </div>

      <div className="space-y-2">
        {steps.map((s) => {
          const Icon = s.icon
          return s.done ? (
            <div key={s.key} className="flex items-center gap-3 rounded-xl bg-emerald-50/60 px-3 py-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500">
                <Check className="h-4 w-4 text-white" />
              </span>
              <span className="text-sm font-medium text-emerald-800 line-through decoration-emerald-400">{s.title}</span>
            </div>
          ) : (
            <Link
              key={s.key}
              to={s.to}
              className="group flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5 transition hover:border-emerald-300 hover:bg-emerald-50/40"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition group-hover:bg-emerald-100 group-hover:text-emerald-600">
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900">{s.title}</span>
                  <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">{s.cost}</span>
                </span>
                <span className="mt-0.5 block truncate text-xs text-slate-500">{s.desc}</span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-emerald-500" />
            </Link>
          )
        })}
      </div>
    </div>
  )
}
