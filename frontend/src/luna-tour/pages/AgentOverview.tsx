/**
 * Luna Tour — agent "工作台" tab (route: /agent).
 *
 * 版面顺序 = **今天要做什么** → **拿什么去做** → **做得怎么样**:
 *   ① 信息栏:待跟进 / 逾期 / 派单排位 / 客户数 —— 一眼看完,不用点
 *   ② 动静:标题栏右上角的铃铛,**不占正文一行**(见 IntentFeed)
 *   ③ 两个动作入口:实时带看 / Luna 导览
 *   ④ 派单状态 + 资料补全
 *   ⑤ 该追谁(CRM 热度 Top5)· 导览表现
 *
 * owner 2026-08-09:「overview 一点都不好看没有有用信息」「live tour 和 luna tour
 * 入口太难看了」。原来第一屏是六条通知 + 两张深色渐变大卡,**没有一个数字**。
 *
 * 🔴 **信息栏里的数只能是"要采取行动"的数。** 累计打开数放在页尾的表现区,
 *    放到顶上只是虚荣指标 —— 经纪看完不知道该干什么。
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Radio, Sparkles, ArrowRight, Flame, CalendarClock } from 'lucide-react'
import { lunaFetch, getClients, type Client, type PipelineStage } from '../lunaApi'
import DispatchStatusCard from '../../components/agentMatch/DispatchStatusCard'
import { fetchPoolStatus, type PoolStatus } from '../../lib/agentMatchApi'
import ProfileGapsCard from '../../components/agentMatch/ProfileGapsCard'
import { SectionHeader, StatCard } from '../ui/Panel'
import ActivationChecklist from '../ui/ActivationChecklist'
import IntentFeed from '../ui/IntentFeed'
import WelcomePosterModal from '../components/WelcomePosterModal'  // 首登恭喜入驻海报(自动弹一次)

interface SessionRow {
  id: string
  title: string
  share_code: string
  client_name: string | null
  opens: number
  completes: number
  cta_clicks: number
  loves: number
  total_dwell_ms: number
  lead_score: number
}

const STAGE_CHIP: Record<string, { label: string; en: string; cls: string }> = {
  new: { label: '新客', en: 'New', cls: 'bg-blue-50 text-blue-600' },
  engaged: { label: '互动中', en: 'Engaged', cls: 'bg-teal-50 text-teal-600' },
  viewing: { label: '看房', en: 'Viewing', cls: 'bg-amber-50 text-amber-600' },
  offer: { label: '报价', en: 'Offer', cls: 'bg-purple-50 text-purple-600' },
  closed: { label: '成交', en: 'Closed', cls: 'bg-emerald-50 text-emerald-600' },
  lost: { label: '流失', en: 'Lost', cls: 'bg-slate-100 text-slate-400' },
}
const stageChip = (s?: PipelineStage | null) => (s ? STAGE_CHIP[s] : null)

const heatTone = (h: number) =>
  h >= 70 ? 'text-red-500' : h >= 40 ? 'text-amber-500' : 'text-slate-400'

const ago = (iso: string | null | undefined, t: (k: string, o?: Record<string, unknown>) => string) => {
  if (!iso) return ''
  const m = (Date.now() - new Date(iso).getTime()) / 60000
  if (m < 1) return t('lunaTour:justNow2')
  if (m < 60) return t('lunaTour:mAgo', { m: Math.round(m) })
  if (m < 1440) return t('lunaTour:hAgo', { h: Math.round(m / 60) })
  return t('lunaTour:dAgo', { d: Math.round(m / 1440) })
}
const isOverdue = (iso?: string | null) => !!iso && new Date(iso).getTime() <= Date.now()

/** 信息栏一格。整格可点 —— 看到「3 条逾期」的下一个动作就是点进去。 */
function Cell({ to, label, value, tone }: {
  to: string; label: string; value: string; tone?: 'alert' | 'good'
}) {
  return (
    <Link to={to} className="group bg-white px-3 py-2.5 transition hover:bg-slate-50">
      <dt className="truncate text-[10px] text-slate-400">{label}</dt>
      <dd className={`mt-0.5 truncate text-lg font-semibold tabular-nums ${
        tone === 'alert' ? 'text-rose-600' : tone === 'good' ? 'text-emerald-600' : 'text-slate-900'
      }`}>{value}</dd>
    </Link>
  )
}

/** 动作入口卡。两个入口长得一样,只有图标和文案不同 —— 一样才像一套工具。 */
function ActionCard({ to, icon, badge, title, desc, cta }: {
  to: string; icon: React.ReactNode; badge: string; title: string; desc: string; cta: string
}) {
  return (
    <Link to={to}
      className="group flex flex-col rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-teal-300 hover:shadow-sm">
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-600">{icon}</span>
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-slate-900">{title}</h2>
        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-slate-500">{badge}</span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-slate-500">{desc}</p>
      <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-teal-600">
        {cta}<ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100" />
      </span>
    </Link>
  )
}

export default function AgentOverview() {
  const { t: tRaw, i18n } = useTranslation('lunaTour')
  const t = tRaw as (k: string, o?: Record<string, unknown>) => string
  const zh = !!i18n.language?.startsWith('zh')
  const L = (a: string, b: string) => (zh ? a : b)

  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [pool, setPool] = useState<PoolStatus | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ;(async () => {
      const [sess, cls] = await Promise.all([
        lunaFetch(`/sessions`).then((r) => r.json()).then((d) => d.sessions || []).catch(() => []),
        getClients({}).catch(() => []),
      ])
      setSessions(sess)
      setClients(cls)
      setLoading(false)
    })()
    // 派单状态单独拿 —— 它比 CRM 快得多,不该被慢的那个拖住整条信息栏
    void fetchPoolStatus().then(setPool)
  }, [])

  const tot = sessions.reduce(
    (a, s) => ({
      opens: a.opens + s.opens,
      completes: a.completes + s.completes,
      cta: a.cta + s.cta_clicks,
      loves: a.loves + s.loves,
    }),
    { opens: 0, completes: 0, cta: 0, loves: 0 }
  )
  const overdueCount = clients.filter((c) => isOverdue(c.next_followup_at)).length
  // 该追谁:客户雷达(CRM)按热度排,而不是旧 tour-session 榜
  const hot = [...clients].sort((a, b) => (b.heat ?? 0) - (a.heat ?? 0)).slice(0, 5)

  return (
    <div>
      {/* 首登自动弹一次恭喜入驻海报(试用也弹);之后去「推广有礼」tab 再看 */}
      <WelcomePosterModal />
      {/* 标题栏:左边标题,右边一颗通知铃铛(见 IntentFeed —— 通知不占正文一行) */}
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="mb-1 text-2xl font-bold">{t('lunaTour:agentWorkbench')}</h1>
          <p className="text-sm text-slate-500">{t('lunaTour:twoWaysToShow')}</p>
        </div>
        <IntentFeed />
      </div>

      {/* ── ① 信息栏 ─────────────────────────────────────────────────────
          四个**要采取行动**的数。派单两格来自服务端 /pool(前端不拼判据),
          客户两格来自 CRM。内部账号没有派单,那两格**留空不补**:
          曾经拿「导览场次/累计打开」去凑满四格,结果和页尾的「Luna 导览表现」
          一字不差地重复了一遍 —— 同一个数在一屏里出现两次,读的人会以为是两件事。 */}
      <dl className={`mb-5 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-slate-200 ring-1 ring-slate-200 ${
        pool && !pool.internal ? 'sm:grid-cols-4' : 'sm:grid-cols-2'
      }`}>
        <Cell to="/agent/clients" label={t('lunaTour:barOverdue')}
          value={loading ? '…' : String(overdueCount)} tone={overdueCount > 0 ? 'alert' : undefined} />
        <Cell to="/agent/clients" label={t('lunaTour:barClients')} value={loading ? '…' : String(clients.length)} />
        {pool && !pool.internal ? (
          <>
            <Cell to="/agent/matches" label={t('lunaTour:barQueue')}
              value={!pool.in_pool ? t('lunaTour:barQueueOut')
                : pool.got_this_round ? t('lunaTour:barQueueGot')
                : pool.queue_position != null ? `${pool.queue_position}/${pool.queue_length}` : '—'}
              tone={!pool.in_pool ? 'alert' : undefined} />
            <Cell to="/agent/matches" label={t('lunaTour:barLeads')} value={String(pool.leads_total ?? 0)} tone="good" />
          </>
        ) : null}
      </dl>

      {/* 「我的派单状态」—— owner 2026-08-09:「经纪台没办法看到自己的派单状态呀」。
          原来只藏在「买家匹配」那一页里,而经纪落地的是这一页,等于要先知道
          它存在才看得到。内部账号/池子外时组件自己不渲染,不占地方。 */}
      {/* 派单状态 + 资料补全 —— 并排。「差什么」紧挨着「我排第几」才有意义:
          两者回答的是同一个问题的两半(我接不接得到买家 / 为什么接不到)。 */}
      <div className="mb-5 grid gap-3 lg:grid-cols-2">
        <DispatchStatusCard />
        <ProfileGapsCard />
      </div>

      {/* 试用期激活清单(全部完成后自动消失) */}
      {!loading && <ActivationChecklist hasClients={clients.length > 0} />}

      {/* ── ③ 两个动作入口 ────────────────────────────────────────────────
          owner 2026-08-09:「这个 live tour 和 luna tour 入口太难看了」。
          原来一张墨黑一张青绿渐变,和这一页其余全白的卡片完全不是一套东西,
          而且色块比字还响 —— 看起来像两条广告。
          现在:白底 + 细边 + 一个上色的图标,和信息栏/客户卡同一套语言;
          hover 才让边框和箭头亮起来。 */}
      <div className="mb-8 grid grid-cols-1 gap-3 md:grid-cols-2">
        {/* 1. Live co-presence tour */}
        <ActionCard
          to="/?livetour=1"
          icon={<Radio className="h-5 w-5" />}
          badge="LIVE"
          title={t('lunaTour:liveTour')}
          desc={t('lunaTour:tourPropertiesWithYour')}
          cta={t('lunaTour:startTour')}
        />

        {/* 2. Luna async self-serve tour */}
        <ActionCard
          to="/agent/tour"
          icon={<Sparkles className="h-5 w-5" />}
          badge="AI"
          title={t('lunaTour:lunaAiTour')}
          desc={t('lunaTour:generateAShareableSelf')}
          cta={t('lunaTour:generateTour2')}
        />
      </div>

      {/* 该追谁:客户雷达热度 Top5 */}
      <SectionHeader
        title={t('lunaTour:whoToChase')}
        action={<Link to="/agent/clients" className="text-sm text-emerald-600 hover:underline">{t('lunaTour:clientRadar2')}</Link>}
      />
      {loading ? (
        <div className="mb-8 text-sm text-slate-400">{t('lunaTour:loading2')}</div>
      ) : hot.length === 0 ? (
        <div className="mb-8 text-sm text-slate-400">
          {t('lunaTour:noClientsYet')}<Link to="/agent/clients" className="text-emerald-600 hover:underline">{t('lunaTour:addYourFirstIn')}</Link>
        </div>
      ) : (
        <div className="mb-8 space-y-2">
          {hot.map((c) => {
            const chip = stageChip(c.pipeline_stage)
            const overdue = isOverdue(c.next_followup_at)
            return (
              <Link
                key={c.id}
                to="/agent/clients"
                className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition hover:border-slate-300 hover:shadow"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-teal-100 to-emerald-100 text-sm font-semibold text-teal-700">
                  {(c.name || '?').charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{c.name}</span>
                    {chip && <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${chip.cls}`}>{L(chip.label, chip.en)}</span>}
                    {overdue && (
                      <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-600">
                        <CalendarClock className="h-3 w-3" />{t('lunaTour:followUpOverdue')}
                      </span>
                    )}
                  </div>
                  <div className="truncate text-xs text-slate-400">
                    {c.budget ? `${t('lunaTour:budget2')} ${c.budget} · ` : ''}{c.last_activity_at ? `${t('lunaTour:active3')} ${ago(c.last_activity_at, t)}` : t('lunaTour:noActivity')}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Flame className={`h-4 w-4 ${heatTone(c.heat ?? 0)}`} />
                  <span className={`text-lg font-bold ${heatTone(c.heat ?? 0)}`}>{Math.round(c.heat ?? 0)}</span>
                </div>
              </Link>
            )
          })}
        </div>
      )}

      {/* Luna 导览表现(只统计已分享导览的互动) */}
      <SectionHeader
        muted
        title={t('lunaTour:lunaTourPerformance')}
        action={sessions.length > 0 ? <Link to="/agent/tour" className="text-xs text-slate-400 hover:text-emerald-600 hover:underline">{t('lunaTour:allTours')}</Link> : undefined}
      />
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label={t('lunaTour:tours')} value={loading ? '…' : sessions.length} />
        <StatCard label={t('lunaTour:totalOpens')} value={loading ? '…' : tot.opens} />
        <StatCard label={t('lunaTour:completed')} value={loading ? '…' : tot.completes} />
        <StatCard label={t('lunaTour:contacted')} value={loading ? '…' : tot.cta} accent />
        <StatCard label={t('lunaTour:saved')} value={loading ? '…' : tot.loves} />
      </div>
    </div>
  )
}
