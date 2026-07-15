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

const ago = (iso: string | null | undefined, zh: boolean) => {
  if (!iso) return ''
  const m = (Date.now() - new Date(iso).getTime()) / 60000
  if (m < 1) return zh ? '刚刚' : 'just now'
  if (m < 60) return zh ? `${Math.round(m)} 分钟前` : `${Math.round(m)} min ago`
  if (m < 1440) return zh ? `${Math.round(m / 60)} 小时前` : `${Math.round(m / 60)} h ago`
  return zh ? `${Math.round(m / 1440)} 天前` : `${Math.round(m / 1440)} d ago`
}
const isOverdue = (iso?: string | null) => !!iso && new Date(iso).getTime() <= Date.now()

export default function AgentOverview() {
  const { i18n } = useTranslation()
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
        <h1 className="text-2xl font-bold mb-1">{L('经纪工作台', 'Agent workbench')}</h1>
        <p className="text-sm text-slate-500">{L('两种带客户看房的方式 — 选一个开始', 'Two ways to show clients around — pick one to start')}</p>
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
              <h2 className="text-lg font-bold">{L('实时带看', 'Live tour')}</h2>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-teal-300">LIVE</span>
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-300">
              {L('和客户实时同屏看房 — 镜头同步跟随、地图上一起圈点项目、语音通话、Luna 现场答数据。最适合一对一深度沟通。', 'Tour properties with your client on a shared screen — synced camera, mark projects together on the map, voice call, and Luna answers data live. Best for one-on-one deep conversations.')}
            </p>
            <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-teal-300">
              {L('开始带看', 'Start tour')} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
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
              <h2 className="text-lg font-bold">{L('Luna 智能导览', 'Luna AI tour')}</h2>
              <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-semibold">AI</span>
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-white/90">
              {L('为客户生成一条可分享的自助看房导览 — AI 精选房源、语音讲解、5 年回报测算,客户随时打开自己看,行为还会回传给你。', 'Generate a shareable self-guided tour for your client — AI-picked properties, voice narration, and 5-year return projections. Clients open it anytime, and their activity flows back to you.')}
            </p>
            <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-white">
              {L('生成导览', 'Generate tour')} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </span>
          </div>
        </Link>
      </div>

      {/* 该追谁:客户雷达热度 Top5 */}
      <SectionHeader
        title={L('该追谁', 'Who to chase')}
        action={<Link to="/agent/clients" className="text-sm text-emerald-600 hover:underline">{L('客户雷达 →', 'Client radar →')}</Link>}
      />
      {loading ? (
        <div className="mb-8 text-sm text-slate-400">{L('加载中…', 'Loading…')}</div>
      ) : hot.length === 0 ? (
        <div className="mb-8 text-sm text-slate-400">
          {L('还没有客户。', 'No clients yet. ')}<Link to="/agent/clients" className="text-emerald-600 hover:underline">{L('去客户雷达建第一个 →', 'Add your first in Client radar →')}</Link>
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
                        <CalendarClock className="h-3 w-3" />{L('跟进过期', 'Follow-up overdue')}
                      </span>
                    )}
                  </div>
                  <div className="truncate text-xs text-slate-400">
                    {c.budget ? `${L('预算', 'Budget')} ${c.budget} · ` : ''}{c.last_activity_at ? `${L('活跃', 'Active')} ${ago(c.last_activity_at, zh)}` : L('暂无活动', 'No activity')}
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
        title={L('Luna 导览表现', 'Luna tour performance')}
        action={sessions.length > 0 ? <Link to="/agent/tour" className="text-xs text-slate-400 hover:text-emerald-600 hover:underline">{L('全部导览 →', 'All tours →')}</Link> : undefined}
      />
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label={L('导览数', 'Tours')} value={loading ? '…' : sessions.length} />
        <StatCard label={L('总打开', 'Total opens')} value={loading ? '…' : tot.opens} />
        <StatCard label={L('完看', 'Completed')} value={loading ? '…' : tot.completes} />
        <StatCard label={L('联系经纪', 'Contacted')} value={loading ? '…' : tot.cta} accent />
        <StatCard label={L('❤️ 收藏', '❤️ Saved')} value={loading ? '…' : tot.loves} />
      </div>
    </div>
  )
}
