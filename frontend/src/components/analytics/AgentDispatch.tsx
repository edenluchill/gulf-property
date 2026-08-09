/**
 * admin →「经纪派单」监控台:现状 + 历史 + 排班。
 *
 * 三个数的含义差很多,**别混着看**:
 *   分配   买家点开了卡片(看到了这个人)
 *   提交   买家真的留了需求 = **一条 lead**,也是唯一消耗轮次的事件
 *   已跟进 经纪自己标的
 * 「分配」高而「提交」为 0,说明卡片本身没说服力,不是派单不公平。
 *
 * 图表用**一个蓝色调的两档**(不是两个不同颜色):提交是分配的**子集**,
 * 它们是同一件事的两个阶段,不是两类东西 —— 用分类色会读成"两组无关的数"。
 * 两档取自 sequential 蓝 250/450,过了 ordinal 校验(单色相、亮度单调、
 * 浅端 2.06:1 压得住底色)。
 *
 * 手机:表格换成卡片列表(横向滚动的表在手机上等于没有)。
 */
import { useEffect, useState } from 'react'
import { Loader2, Users, Pause, PhoneOff, RotateCw, Send, CheckCheck, Clock } from 'lucide-react'
import { fetchMatchAdmin, type MatchAdmin } from '../../lib/agentMatchApi'

/** 一个蓝色调的两档 —— 深=真 lead,浅=只看了卡片。 */
const C_REVEALED = '#2a78d6'
const C_ASSIGNED = '#86b6ef'

function StatTile({ icon: Icon, label, value, sub, tone = 'slate' }: {
  icon: typeof Users; label: string; value: string | number; sub?: string
  tone?: 'slate' | 'emerald' | 'amber' | 'rose'
}) {
  const tones = {
    slate: 'text-slate-400', emerald: 'text-emerald-600',
    amber: 'text-amber-600', rose: 'text-rose-600',
  }
  return (
    <div className="rounded-2xl bg-white p-3.5 ring-1 ring-slate-200 sm:p-4">
      <div className="flex items-center gap-1.5">
        <Icon className={`h-3.5 w-3.5 shrink-0 ${tones[tone]}`} />
        <span className="truncate text-[11px] font-medium text-slate-500">{label}</span>
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900 sm:text-[28px]">{value}</div>
      {sub && <div className="mt-0.5 truncate text-[11px] text-slate-400">{sub}</div>}
    </div>
  )
}

/**
 * 近 30 天逐日。**堆叠列**:下段=提交(深),上段=只看没提交(浅)。
 * 一根柱的总高 = 当天分配数,深色部分 = 当天真 lead。
 *
 * 全零时不画空图 —— 一张 30 根零高柱子的图除了占地方什么也不说明。
 */
function DailyChart({ daily }: { daily: MatchAdmin['daily'] }) {
  const max = Math.max(1, ...daily.map((d) => d.assigned))
  const total = daily.reduce((s, d) => s + d.assigned, 0)
  if (!total) {
    return (
      <p className="rounded-2xl border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">
        近 30 天还没有任何分配记录
      </p>
    )
  }
  const fmtDay = (s: string) => new Date(s).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
  return (
    <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-800">近 30 天</h3>
        {/* 两个序列必须有图例 —— 颜色不能是唯一的身份线索 */}
        <div className="flex items-center gap-3 text-[11px] text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: C_REVEALED }} />提交需求
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: C_ASSIGNED }} />只看了卡片
          </span>
        </div>
      </div>
      <div className="mt-3 flex h-32 items-end gap-[3px]">
        {daily.map((d) => {
          const h = (d.assigned / max) * 100
          const rev = d.assigned ? (d.revealed / d.assigned) * 100 : 0
          return (
            <div key={d.day} className="group relative flex h-full flex-1 items-end"
              title={`${fmtDay(d.day)} · 分配 ${d.assigned} · 提交 ${d.revealed}`}>
              {/* 空的一天也留一条 2px 的底纹 —— 让"这天是 0"和"这天没数据"看起来一样,
                  比让柱子彻底消失更诚实(消失会被读成图表断了) */}
              <div className="w-full rounded-t bg-slate-100" style={{ height: d.assigned ? `${h}%` : '2px' }}>
                {d.assigned > 0 && (
                  <div className="flex h-full w-full flex-col justify-end overflow-hidden rounded-t">
                    <div style={{ height: `${100 - rev}%`, background: C_ASSIGNED }} />
                    {/* 段间 2px 底色缝隙,两段才不会糊成一根 */}
                    {d.revealed > 0 && d.revealed < d.assigned && <div className="h-[2px] bg-white" />}
                    <div style={{ height: `${rev}%`, background: C_REVEALED }} />
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] tabular-nums text-slate-400">
        <span>{fmtDay(daily[0]?.day)}</span>
        <span>{fmtDay(daily[daily.length - 1]?.day)}</span>
      </div>
    </div>
  )
}

export default function AgentDispatch() {
  const [data, setData] = useState<MatchAdmin | null>(null)
  const [err, setErr] = useState(false)

  useEffect(() => { void fetchMatchAdmin().then((d) => (d ? setData(d) : setErr(true))) }, [])

  if (err) return <p className="py-8 text-center text-sm text-rose-600">加载失败（需要 owner 权限）</p>
  if (!data) return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-300" /></div>

  const fmt = (s: string | null) => (s ? new Date(s).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')
  const t = data.totals
  const pct = data.pool_size ? Math.round((data.round_done / data.pool_size) * 100) : 0
  const roster = [...data.roster].sort((a, b) => a.matched_30d - b.matched_30d)

  return (
    <div className="space-y-4">
      {/* ── KPI 行 ──────────────────────────────────────────────────────────
          手机 2 列、桌面 5 列。这几个是"一眼看现状"的数,不该做成图。 */}
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-5">
        <StatTile icon={Users} label="派单池" value={data.pool_size}
          sub="付费/试用 · 联系得上 · 未暂停" tone={data.pool_size ? 'emerald' : 'rose'} />
        <StatTile icon={RotateCw} label={`第 ${data.round_no} 轮`} value={`${data.round_done}/${data.pool_size}`}
          sub="本轮已发 / 池内人数" />
        <StatTile icon={Send} label="累计分配" value={t.assigned} sub={`${t.visitors} 个访客`} />
        <StatTile icon={CheckCheck} label="提交需求" value={t.revealed}
          sub={t.assigned ? `转化 ${Math.round((t.revealed / t.assigned) * 100)}%` : '—'} tone="emerald" />
        <StatTile icon={Clock} label="待发通知" value={t.queued}
          sub="攒够 5 分钟合并发出" tone={t.queued ? 'amber' : 'slate'} />
      </div>

      {/* ── 轮次进度 ─────────────────────────────────────────────────────── */}
      <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-800">轮值进度</h3>
          <span className="text-[11px] text-slate-400">每人一条，发满自动进下一轮 · 不按天重置</span>
        </div>
        <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: C_REVEALED }} />
        </div>
        {data.round_waiting.length > 0 && (
          <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
            本轮还没轮到（{data.round_waiting.length}）：
            <span className="text-slate-400">{data.round_waiting.slice(0, 10).join('、')}</span>
            {data.round_waiting.length > 10 && ` …+${data.round_waiting.length - 10}`}
          </p>
        )}
      </div>

      <DailyChart daily={data.daily} />

      {/* ── 排班 ─────────────────────────────────────────────────────────── */}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-800">
          排班 <span className="font-normal text-slate-400">· 按累计分配升序，最上面的下一个轮到</span>
        </h3>

        {/* 手机:卡片。横向滚动的表在手机上等于没有。 */}
        <ul className="space-y-2 md:hidden">
          {roster.map((r) => (
            <li key={r.email} className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-800">{r.display_name || r.email}</div>
                  <div className="truncate text-[11px] text-slate-400">{r.email}</div>
                </div>
                <Badges r={r} />
              </div>
              <div className="mt-2 flex gap-4 text-[11px] text-slate-500">
                <span>分配 <b className="tabular-nums text-slate-800">{r.matched_30d}</b></span>
                <span>提交 <b className="tabular-nums text-emerald-700">{r.revealed_30d}</b></span>
                <span>已跟进 <b className="tabular-nums text-slate-600">{r.acked_30d}</b></span>
                <span className="ms-auto text-slate-400">{fmt(r.last_at)}</span>
              </div>
            </li>
          ))}
          {!roster.length && <li className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">还没有经纪进入派单池</li>}
        </ul>

        <div className="hidden overflow-hidden rounded-xl ring-1 ring-slate-200 md:block">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2 text-start font-medium">经纪</th>
                <th className="px-3 py-2 text-end font-medium">分配</th>
                <th className="px-3 py-2 text-end font-medium">提交需求</th>
                <th className="px-3 py-2 text-end font-medium">已跟进</th>
                <th className="px-3 py-2 text-start font-medium">最近一次</th>
                <th className="px-3 py-2 text-start font-medium">状态</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((r) => (
                <tr key={r.email} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-800">{r.display_name || r.email}</div>
                    <div className="text-xs text-slate-400">{r.email}</div>
                  </td>
                  <td className="px-3 py-2 text-end tabular-nums">{r.matched_30d}</td>
                  <td className="px-3 py-2 text-end font-semibold tabular-nums text-emerald-700">{r.revealed_30d}</td>
                  <td className="px-3 py-2 text-end tabular-nums text-slate-500">{r.acked_30d}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-slate-500">{fmt(r.last_at)}</td>
                  <td className="px-3 py-2"><Badges r={r} /></td>
                </tr>
              ))}
              {!roster.length && (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-sm text-slate-400">还没有经纪进入派单池</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── 历史 ─────────────────────────────────────────────────────────── */}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-800">
          历史 <span className="font-normal text-slate-400">· 最近 300 条</span>
        </h3>

        <ul className="space-y-2 md:hidden">
          {data.matches.map((m) => (
            <li key={m.id} className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                <span className="tabular-nums">{fmt(m.created_at)}</span>
                <span className="text-slate-300">·</span>
                <span>{m.source === 'map' ? '地图' : '项目页'}</span>
                {m.project_name && <span className="truncate font-medium text-slate-600">{m.project_name}</span>}
              </div>
              <div className="mt-1 text-sm font-medium text-slate-800">{m.agent_name || m.agent_email}</div>
              {m.buyer_contact && <div className="mt-0.5 text-xs text-slate-600">买家：{m.buyer_contact}</div>}
              {m.buyer_note && <div className="mt-1 rounded-lg bg-slate-50 px-2 py-1.5 text-xs leading-relaxed text-slate-500">{m.buyer_note}</div>}
              <MatchBadges m={m} />
            </li>
          ))}
          {!data.matches.length && <li className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">还没有分配记录</li>}
        </ul>

        <div className="hidden overflow-x-auto rounded-xl ring-1 ring-slate-200 md:block">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2 text-start font-medium">时间</th>
                <th className="px-3 py-2 text-start font-medium">经纪</th>
                <th className="px-3 py-2 text-start font-medium">来源</th>
                <th className="px-3 py-2 text-start font-medium">项目</th>
                <th className="px-3 py-2 text-start font-medium">买家联系方式</th>
                <th className="px-3 py-2 text-start font-medium">留言</th>
                <th className="px-3 py-2 text-start font-medium">状态</th>
              </tr>
            </thead>
            <tbody>
              {data.matches.map((m) => (
                <tr key={m.id} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-slate-500">{fmt(m.created_at)}</td>
                  <td className="px-3 py-2">{m.agent_name || m.agent_email}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{m.source === 'map' ? '地图' : '项目页'}</td>
                  <td className="px-3 py-2 text-xs text-slate-600">{m.project_name || '—'}</td>
                  <td className="px-3 py-2 text-xs">{m.buyer_contact || <span className="text-slate-300">未留</span>}</td>
                  <td className="px-3 py-2 max-w-[240px] text-xs text-slate-600">{m.buyer_note || '—'}</td>
                  <td className="px-3 py-2"><MatchBadges m={m} /></td>
                </tr>
              ))}
              {!data.matches.length && (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-sm text-slate-400">还没有分配记录</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

/** 经纪状态标 —— 桌面表格和手机卡片共用,免得两处漂移。 */
function Badges({ r }: { r: MatchAdmin['roster'][number] }) {
  const CH = {
    whatsapp: { label: 'WhatsApp', cls: 'bg-emerald-50 text-emerald-700' },
    email: { label: '公开邮箱', cls: 'bg-sky-50 text-sky-700' },
    relay: { label: '邮件中转', cls: 'bg-slate-100 text-slate-500' },
  }[r.channel] ?? { label: '联系不上', cls: 'bg-amber-50 text-amber-700' }
  return (
    <div className="flex shrink-0 flex-wrap justify-end gap-1">
      {/* in_pool 直接用服务端算的 —— 前端再拼一遍必然和真实派单条件分叉,
          而分叉的后果就是「表里说在池中,实际根本不会被派到」 */}
      {r.in_pool
        ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700">在池中</span>
        : !r.subscribed
          ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">未订阅</span>
          : null}
      {r.paused && (
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">
          <Pause className="h-3 w-3" />已暂停
        </span>
      )}
      {/* 渠道比二值「联系不上」有信息量:relay 的人是联系得上的,只是要走中转 */}
      {r.has_contact
        ? <span className={`rounded-full px-2 py-0.5 text-[10px] ${CH.cls}`}>{CH.label}</span>
        : <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700">
            <PhoneOff className="h-3 w-3" />联系不上
          </span>}
    </div>
  )
}

function MatchBadges({ m }: { m: MatchAdmin['matches'][number] }) {
  return (
    <div className="mt-1.5 flex flex-wrap gap-1 md:mt-0">
      {m.revealed_at && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700">提交需求</span>}
      {m.agent_ack_at && <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] text-white">已跟进</span>}
      {!m.revealed_at && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-400">只看了卡片</span>}
    </div>
  )
}
