/**
 * Luna Tour — agent "工作台" tab (route: /agent).
 *
 * 两个核心动作(实时带看 / Luna 导览)+ 该追谁(客户雷达 CRM 的热度 Top5,
 * 不再用旧 tour-session 榜)+ Luna 导览表现汇总。
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Radio, Sparkles, ArrowRight, Flame, CalendarClock } from 'lucide-react'
import { lunaFetch, getClients, type Client, type PipelineStage } from '../lunaApi'
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

export default function AgentOverview() {
  const { t: tRaw, i18n } = useTranslation('lunaTour')
  const t = tRaw as (k: string, o?: Record<string, unknown>) => string
  const zh = !!i18n.language?.startsWith('zh')
  const L = (a: string, b: string) => (zh ? a : b)

  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [clients, setClients] = useState<Client[]>([])
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
  // 该追谁:客户雷达(CRM)按热度排,而不是旧 tour-session 榜
  const hot = [...clients].sort((a, b) => (b.heat ?? 0) - (a.heat ?? 0)).slice(0, 5)

  return (
    <div>
      {/* 首登自动弹一次恭喜入驻海报(试用也弹);之后去「推广有礼」tab 再看 */}
      <WelcomePosterModal />
      <div className="mb-5">
        <h1 className="text-2xl font-bold mb-1">{t('lunaTour:agentWorkbench')}</h1>
        <p className="text-sm text-slate-500">{t('lunaTour:twoWaysToShow')}</p>
      </div>

      {/* 🔔 客户动静 —— **第一屏**。谁刚看完、谁想联系你、谁收藏了哪套。
          最值钱的一刻是客户刚看完的那一分钟(他此刻正在想这件事),
          所以它不能藏在某个 tab 里。一条都没有时不占地方。 */}
      <IntentFeed />

      {/* 试用期激活清单(全部完成后自动消失) */}
      {!loading && <ActivationChecklist hasClients={clients.length > 0} />}

      {/* The two hero actions — the heart of the agent console */}
      <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* 1. Live co-presence tour */}
        <Link
          to="/?livetour=1"
          className="group relative overflow-hidden rounded-2xl bg-ink-800 p-5 text-white shadow-md ring-1 ring-black/20 transition hover:shadow-xl hover:-translate-y-0.5"
        >
          <div className="absolute -right-8 -top-8 h-28 w-28 rounded-full opacity-25 blur-2xl" style={{ background: '#14b8a6' }} />
          <div className="relative">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-teal-400/15">
              <Radio className="h-6 w-6 text-teal-300" />
            </div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold">{t('lunaTour:liveTour')}</h2>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-teal-300">LIVE</span>
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-300">
              {t('lunaTour:tourPropertiesWithYour')}
            </p>
            <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-teal-300">
              {t('lunaTour:startTour')} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </span>
          </div>
        </Link>

        {/* 2. Luna async self-serve tour */}
        <Link
          to="/agent/tour"
          className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-teal-500 to-emerald-600 p-5 text-white shadow-md ring-1 ring-emerald-600/20 transition hover:shadow-xl hover:-translate-y-0.5"
        >
          <div className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-white/20 opacity-40 blur-2xl" />
          <div className="relative">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-white/20">
              <Sparkles className="h-6 w-6 text-white" />
            </div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold">{t('lunaTour:lunaAiTour')}</h2>
              <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-semibold">AI</span>
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-white/90">
              {t('lunaTour:generateAShareableSelf')}
            </p>
            <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-white">
              {t('lunaTour:generateTour2')} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </span>
          </div>
        </Link>
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
