/**
 * Owner dashboard — 错误监控 tab.
 *
 * Surfaces the failures real users hit (esp. mobile login) that used to vanish
 * silently: auth_failure + api_error events collected by lib/track.ts /
 * lib/errorCapture.ts. Mobile-first: stat grid + grouped signatures + a recent
 * feed, all as card lists (no wide tables), so it's readable on a phone.
 */
import { useEffect, useState } from 'react'
import { Loader2, ShieldAlert, ServerCrash, Users, PhoneCall, ChevronRight } from 'lucide-react'
import { fetchErrors, fetchErrorImpact, ErrorsData, ErrorEvent, ErrorEventType, ErrorImpactCustomer } from '../../lib/analyticsApi'
import StatCard from './StatCard'
import { VisitorDrawer, ago as agoRel, shortId } from './Visitors'

/** Strip the API origin so error_urls show just the path. */
const cleanUrl = (u: string) => u.replace(/^https?:\/\/[^/]+/, '') || u

/** Top-of-tab alert: real high-intent customers who just hit a bug. The owner
 *  should proactively reach out (WhatsApp/call) once the bug is fixed. */
function UrgentContactBlock() {
  const [rows, setRows] = useState<ErrorImpactCustomer[] | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetchErrorImpact(48)
      .then((d) => alive && setRows(d))
      .catch(() => alive && setRows([]))
    return () => {
      alive = false
    }
  }, [])

  return (
    <div className="overflow-hidden rounded-2xl bg-amber-50/70 shadow-sm ring-1 ring-amber-200">
      <div className="border-b border-amber-200/70 px-4 py-3">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-amber-900">
          <PhoneCall className="h-4 w-4" />
          该立刻联系的客户（近48h 撞到错误）
        </h3>
        <p className="mt-0.5 text-[11px] text-amber-700/80">
          这些真实客户遇到故障——修复后建议主动 WhatsApp/电话回访,别让 bug 赶走高意向客户
        </p>
      </div>

      {rows === null ? (
        <div className="flex h-24 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-amber-500" />
        </div>
      ) : rows.length === 0 ? (
        <div className="px-4 py-5">
          <p className="rounded-xl bg-emerald-50 px-4 py-3 text-center text-sm font-medium text-emerald-600 ring-1 ring-emerald-200">
            近48h 没有真实客户撞到错误 👍
          </p>
        </div>
      ) : (
        <div className="max-h-[360px] overflow-y-auto">
          {rows.map((r) => {
            const who = r.user_email || `#${shortId(r.visitor_id)}`
            const hot = r.score >= 30
            return (
              <button
                key={r.identity}
                onClick={() => setOpenId(r.identity)}
                className="flex w-full items-start justify-between gap-2 border-b border-amber-200/50 px-4 py-3 text-start transition-colors last:border-0 hover:bg-amber-100/50"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-slate-800">{who}</span>
                    <span
                      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${
                        hot
                          ? 'bg-rose-50 text-rose-600 ring-rose-200'
                          : 'bg-slate-100 text-slate-600 ring-slate-200'
                      }`}
                    >
                      意向 {r.score}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-xs text-slate-500">
                    撞到:{r.error_urls.map(cleanUrl).join(' · ') || '—'}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-400">最后错误 {agoRel(r.last_error_at)}</p>
                </div>
                <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              </button>
            )
          })}
        </div>
      )}

      {openId && <VisitorDrawer id={openId} onClose={() => setOpenId(null)} />}
    </div>
  )
}

const ago = (iso: string) => {
  const m = (Date.now() - new Date(iso).getTime()) / 60000
  if (m < 1) return '刚刚'
  if (m < 60) return `${Math.round(m)} 分钟前`
  if (m < 1440) return `${Math.round(m / 60)} 小时前`
  return `${Math.round(m / 1440)} 天前`
}

const TYPE_STYLE: Record<ErrorEventType, { label: string; cls: string }> = {
  auth_failure: { label: '登录失败', cls: 'bg-rose-50 text-rose-600 ring-rose-200' },
  // 只有失败的刷新才会进来(后端 ERROR_EVENTS_SQL 过滤)——它就是"客户被莫名登出"的那一刻
  auth_token_refresh: { label: '会话过期', cls: 'bg-violet-50 text-violet-700 ring-violet-200' },
  api_error: { label: 'API 异常', cls: 'bg-amber-50 text-amber-700 ring-amber-200' },
}

function TypeBadge({ type }: { type: ErrorEventType }) {
  const s = TYPE_STYLE[type] ?? TYPE_STYLE.api_error
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${s.cls}`}
    >
      {s.label}
    </span>
  )
}

/** One raw error event as a card — pulls the meaningful payload fields per type. */
function EventCard({ e }: { e: ErrorEvent }) {
  const p = e.payload || {}
  const str = (k: string) => (p[k] == null ? '' : String(p[k]))
  const who = e.user_email || (e.visitor_id ? e.visitor_id.replace(/^v_/, '').slice(0, 8) : '匿名')

  const title =
    e.event_type === 'auth_failure'
      ? str('reason') || '登录失败'
      : e.event_type === 'auth_token_refresh'
        ? `token 刷新失败 → ${str('error_code') || str('status') || '?'}`
        : `${str('method') || 'GET'} ${str('endpoint') || str('url') || '?'}`

  const detail =
    e.event_type === 'auth_failure'
      ? [str('provider') && `渠道 ${str('provider')}`, str('storage_ok') === 'false' && '存储被禁用', str('origin')]
          .filter(Boolean)
          .join(' · ')
      : e.event_type === 'auth_token_refresh'
        ? // visibility=hidden 说明刷新发生在后台 tab —— 冻结的 tab 是头号嫌疑
          [
            str('visibility') && `页面${str('visibility') === 'visible' ? '可见' : '在后台'}`,
            str('online') === 'false' && '设备离线',
            str('ms') && `${str('ms')}ms`,
          ]
            .filter(Boolean)
            .join(' · ')
        : [str('kind'), str('status') && `状态 ${str('status')}`].filter(Boolean).join(' · ')

  return (
    <div className="border-b border-slate-100 px-4 py-3 last:border-0">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <TypeBadge type={e.event_type} />
            <span className="truncate text-sm font-medium text-slate-800">{title}</span>
          </div>
          {(str('message') || detail) && (
            <p className="mt-1 break-words text-xs text-slate-500">
              {detail}
              {detail && str('message') ? ' — ' : ''}
              {str('message')}
            </p>
          )}
          <p className="mt-1 text-[11px] text-slate-400">
            {who} · {e.path || '—'}
          </p>
        </div>
        <span className="shrink-0 whitespace-nowrap text-[11px] text-slate-400">{ago(e.created_at)}</span>
      </div>
    </div>
  )
}

export default function ErrorMonitor({ days }: { days: number }) {
  const [data, setData] = useState<ErrorsData | null>(null)
  const [filter, setFilter] = useState<'all' | ErrorEventType>('all')

  useEffect(() => {
    let alive = true
    setData(null)
    fetchErrors(days)
      .then((d) => alive && setData(d))
      .catch(() => alive && setData(null))
    return () => {
      alive = false
    }
  }, [days])

  if (!data) {
    return (
      <div className="space-y-4">
        <UrgentContactBlock />
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-teal-500" />
        </div>
      </div>
    )
  }

  const { overview, groups, recent } = data
  const filtered = filter === 'all' ? recent : recent.filter((e) => e.event_type === filter)
  const healthy = overview.auth_failures === 0 && overview.api_errors === 0

  return (
    <div className="space-y-4">
      <UrgentContactBlock />

      {/* Stat grid — 2 cols on phone, 4 on desktop. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="登录失败" value={overview.auth_failures} icon={<ShieldAlert className="h-4 w-4" />}
          hint={`${overview.affected_auth_visitors} 位访客受影响`} />
        <StatCard label="API 异常" value={overview.api_errors} icon={<ServerCrash className="h-4 w-4" />}
          hint={`${overview.affected_api_visitors} 位访客受影响`} />
        <StatCard label="受影响访客(登录)" value={overview.affected_auth_visitors} icon={<Users className="h-4 w-4" />} />
        <StatCard label="受影响访客(API)" value={overview.affected_api_visitors} icon={<Users className="h-4 w-4" />} />
      </div>

      {healthy ? (
        <div className="rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-900/[0.06]">
          <p className="text-sm font-medium text-emerald-600">这段时间没有捕获到登录失败或 API 异常 ✅</p>
          <p className="mt-1 text-xs text-slate-400">客户的登录与接口调用都正常。</p>
        </div>
      ) : (
        <>
          {/* Grouped signatures — "the same broken thing" collapsed. */}
          <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/[0.06]">
            <div className="border-b border-slate-100 px-4 py-3">
              <h3 className="text-sm font-semibold text-slate-800">问题分组(按出现次数)</h3>
            </div>
            {groups.length === 0 ? (
              <p className="px-4 py-6 text-xs text-slate-400">无分组数据。</p>
            ) : (
              <div className="max-h-[360px] overflow-y-auto">
                {groups.map((g, i) => (
                  <div key={i} className="border-b border-slate-100 px-4 py-3 last:border-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <TypeBadge type={g.event_type} />
                          <span className="truncate text-sm font-medium text-slate-800">{g.signature}</span>
                        </div>
                        {g.sample_message && (
                          <p className="mt-1 break-words text-xs text-slate-500">{g.sample_message}</p>
                        )}
                        <p className="mt-1 text-[11px] text-slate-400">
                          {g.visitors} 位访客 · 最近 {ago(g.last_seen)}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-sm font-semibold text-slate-700">
                        {g.count}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent raw feed with a type filter. */}
          <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/[0.06]">
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
              <h3 className="text-sm font-semibold text-slate-800">最近事件</h3>
              <div className="flex gap-1">
                {(['all', 'auth_failure', 'auth_token_refresh', 'api_error'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      filter === f ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {f === 'all' ? '全部' : f === 'auth_failure' ? '登录' : f === 'auth_token_refresh' ? '会话过期' : 'API'}
                  </button>
                ))}
              </div>
            </div>
            {filtered.length === 0 ? (
              <p className="px-4 py-6 text-xs text-slate-400">无事件。</p>
            ) : (
              <div className="max-h-[480px] overflow-y-auto">
                {filtered.map((e) => (
                  <EventCard key={e.id} e={e} />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
