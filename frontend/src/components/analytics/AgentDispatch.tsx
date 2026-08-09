/**
 * admin →「经纪派单」:排班情况 + 全量分配记录。
 *
 * 排班表按**近 30 天被分配次数**排 —— 那正是派单算法的排序键,所以这张表就是
 * 算法的直读视图:谁在队尾、下一个轮到谁,一眼就能核对派单是不是真的均衡。
 *
 * 三列的含义差别很大,别混着看:
 *   分到       = 买家点开了卡片(只是看到了这个人)
 *   要了联系方式 = 买家真的想联系(**这才是转化**)
 *   已跟进     = 经纪自己标的
 * 「分到」高而「要了联系方式」为 0,说明卡片本身没说服力,不是派单不公平。
 */
import { useEffect, useState } from 'react'
import { Loader2, Users, Pause, PhoneOff } from 'lucide-react'
import { fetchMatchAdmin, type MatchAdmin } from '../../lib/agentMatchApi'

export default function AgentDispatch() {
  const [data, setData] = useState<MatchAdmin | null>(null)
  const [err, setErr] = useState(false)

  useEffect(() => { void fetchMatchAdmin().then((d) => (d ? setData(d) : setErr(true))) }, [])

  if (err) return <p className="py-8 text-center text-sm text-rose-600">加载失败（需要 owner 权限）</p>
  if (!data) return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-300" /></div>

  const fmt = (s: string | null) => (s ? new Date(s).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')

  return (
    <div className="space-y-6">
      {/* 池子大小是这个功能能不能转起来的**唯一**先决条件 —— 放最上面 */}
      <div className={`flex items-center gap-3 rounded-2xl p-4 ring-1 ${
        data.pool_size > 0 ? 'bg-emerald-50/60 ring-emerald-100' : 'bg-rose-50/60 ring-rose-100'
      }`}>
        <Users className={`h-5 w-5 ${data.pool_size > 0 ? 'text-emerald-600' : 'text-rose-600'}`} />
        <div>
          <p className="text-sm font-semibold text-slate-800">
            派单池：<span className="tabular-nums">{data.pool_size}</span> 人
          </p>
          <p className="text-xs text-slate-500">
            条件：付费或试用中 · 填了手机/WhatsApp · 未暂停 · 非内部账号
          </p>
        </div>
      </div>

      {/* 轮次进度 —— 运营真正要看的是「本轮还剩谁没拿到」。
          轮次**没有时间成分**:池里每个人都拿到一条 lead 才进下一轮,
          所以每天只有 10 个买家也不会让后面的人永远轮不到。 */}
      <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-800">
              第 <span className="tabular-nums">{data.round_no}</span> 轮 ·
              已发 <span className="tabular-nums">{data.round_done}</span> / {data.pool_size}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              本轮每人一条，发满 {data.pool_size} 人自动进下一轮（不按天重置）
            </p>
          </div>
          <div className="h-2 w-40 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-emerald-500"
              style={{ width: `${data.pool_size ? Math.round((data.round_done / data.pool_size) * 100) : 0}%` }} />
          </div>
        </div>
        {data.round_waiting.length > 0 && (
          <p className="mt-2 text-xs text-slate-500">
            本轮还没轮到（{data.round_waiting.length}）：
            <span className="text-slate-400">{data.round_waiting.slice(0, 12).join('、')}</span>
            {data.round_waiting.length > 12 && ` …+${data.round_waiting.length - 12}`}
          </p>
        )}
      </div>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-800">排班（按累计分配数升序＝下一个轮到最上面）</h3>
        <div className="overflow-x-auto rounded-xl ring-1 ring-slate-200">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2 text-start">经纪</th>
                <th className="px-3 py-2 text-end">分到</th>
                <th className="px-3 py-2 text-end">要了联系方式</th>
                <th className="px-3 py-2 text-end">已跟进</th>
                <th className="px-3 py-2 text-start">最近一次</th>
                <th className="px-3 py-2 text-start">状态</th>
              </tr>
            </thead>
            <tbody>
              {/* 后端按分配数**降序**返回(看谁接得多);这里再按升序排一份,
                  因为运营真正关心的是"下一个轮到谁" —— 那是队首不是队尾。 */}
              {[...data.roster].sort((a, b) => a.matched_30d - b.matched_30d).map((r) => (
                <tr key={r.email} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-800">{r.display_name || r.email}</div>
                    <div className="text-xs text-slate-400">{r.email}</div>
                  </td>
                  <td className="px-3 py-2 text-end tabular-nums">{r.matched_30d}</td>
                  <td className="px-3 py-2 text-end tabular-nums font-semibold text-emerald-700">{r.revealed_30d}</td>
                  <td className="px-3 py-2 text-end tabular-nums text-slate-500">{r.acked_30d}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{fmt(r.last_at)}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {!r.subscribed && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">未订阅</span>}
                      {!r.has_contact && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700">
                          <PhoneOff className="h-3 w-3" />无联系方式
                        </span>
                      )}
                      {r.paused && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">
                          <Pause className="h-3 w-3" />已暂停
                        </span>
                      )}
                      {r.subscribed && r.has_contact && !r.paused && (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700">在池中</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {data.roster.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-sm text-slate-400">还没有任何经纪进入派单池</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-800">最近的分配（最多 300 条）</h3>
        <div className="overflow-x-auto rounded-xl ring-1 ring-slate-200">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2 text-start">时间</th>
                <th className="px-3 py-2 text-start">经纪</th>
                <th className="px-3 py-2 text-start">来源</th>
                <th className="px-3 py-2 text-start">项目</th>
                <th className="px-3 py-2 text-start">买家联系方式</th>
                <th className="px-3 py-2 text-start">留言</th>
                <th className="px-3 py-2 text-start">状态</th>
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
                  <td className="px-3 py-2 max-w-[260px] text-xs text-slate-600">{m.buyer_note || '—'}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {m.revealed_at && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700">要了联系方式</span>}
                      {m.agent_ack_at && <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] text-white">已跟进</span>}
                    </div>
                  </td>
                </tr>
              ))}
              {data.matches.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-sm text-slate-400">还没有任何分配记录</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
