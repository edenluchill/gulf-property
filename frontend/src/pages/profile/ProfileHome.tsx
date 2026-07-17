/**
 * ProfileHome — 个人中心「个人资料」tab(ProfileShell 的 index 路由)。
 *
 * 全平铺(用户 2026-07-08 定的规则):头像/身份/名片/订阅/收藏所有信息
 * 直接可见,不藏在"点进去"的入口卡后面。编辑动作(名片/勋章分享)才开弹窗。
 * 订阅数据由 ProfileShell 经 Outlet context 下发,不重复拉 billing/me。
 */
import { useEffect, useState } from 'react'
import { Link, useNavigate, useOutletContext } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  User, Mail, Contact, Heart, ArrowLeftRight, BarChart3, CalendarDays,
  Sparkles, ArrowRight, Pencil, Phone, MessageCircle, LogOut, ChevronRight,
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { isOwnerEmail } from '../../lib/config'
import { useMyRole } from '../../hooks/useMyRole'
import { getProjectCount, getFavoriteCount } from '../../lib/favorites'
import { lunaFetch } from '../../luna-tour/lunaApi'
import RoleBadgeDialog from '../../components/RoleBadgeDialog'
import { badgeTitle } from '../../lib/roleBadge'
import WelcomePosterModal from '../../luna-tour/components/WelcomePosterModal'  // 入驻海报(重开入口)

// 会员认证证书(navy+烫金正式奖状)入口开关。2026-07-14 owner:太正式,先撤,
// 新的恭喜入驻海报(推广有礼 tab)取而代之;证书代码全保留,以后要恢复翻回 true。
const MEMBERSHIP_CERT_ENABLED = false
import AgentCardEditor from '../../components/AgentCardEditor'
import TrialClaimCard from '../../components/TrialClaimCard'
import type { ProfileShellContext } from './ProfileShell'

interface AgentCard {
  display_name?: string | null
  phone?: string | null
  whatsapp?: string | null
  public_email?: string | null
  photo_url?: string | null
}

const STATUS_KEY: Record<string, string> = {
  none: 'statusNone', trialing: 'statusTrialing', active: 'statusActive', past_due: 'statusPastDue', canceled: 'statusCanceled',
}

export default function ProfileHome() {
  const { t: tRaw, i18n } = useTranslation('profile')
  const t = tRaw as (k: string, o?: Record<string, unknown>) => string
  const navigate = useNavigate()
  const { user, signOut } = useAuth()
  const role = useMyRole()
  const { badge, me } = useOutletContext<ProfileShellContext>()

  const [showBadgeDlg, setShowBadgeDlg] = useState(false)
  const [showWelcome, setShowWelcome] = useState(false)
  const [showCardEditor, setShowCardEditor] = useState(false)
  const [avatarError, setAvatarError] = useState(false)
  useEffect(() => { setAvatarError(false) }, [user?.user_metadata?.avatar_url])

  // 经纪名片:直接平铺展示(编辑才开弹窗;关闭后重拉,让改动立刻可见)
  const isPro = !!role && role !== 'buyer'
  const [card, setCard] = useState<AgentCard | null>(null)
  const loadCard = () => {
    lunaFetch('/profile').then((r) => r.json()).then((j) => setCard(j?.agent || null)).catch(() => {})
  }
  useEffect(() => { if (isPro) loadCard() }, [isPro])

  // 收藏数(本地同步,登录时已 merge 云端)
  const favProjects = getProjectCount()
  const favTotal = getFavoriteCount()

  if (!user) return null // ProfileShell 已拦未登录

  const displayName = user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || 'User'
  const avatarUrl = user.user_metadata?.avatar_url
  const joined = user.created_at
    ? new Date(user.created_at).toLocaleDateString(i18n.language, { year: 'numeric', month: 'long' })
    : null

  const switchRole = () => {
    try { sessionStorage.removeItem('pinzos-role') } catch { /* noop */ }
    window.location.assign('/choose-role')
  }

  // 订阅展示(me 为空 = 拉取失败,当 Explore 免费档展示)
  const planName = me?.plan?.name || 'Explore'
  const status = me?.status || 'none'
  const isPaid = status === 'active' || status === 'trialing'
  const cMonth = me?.credits?.month ?? 0
  const cBalance = me?.credits?.balance ?? 0
  const cUsed = me?.credits?.used ?? 0
  const unlimited = cMonth < 0

  return (
    <div className="space-y-4">
      {/* ── 身份 hero:头像 + 账号信息(横排紧凑,避免与下方名片重复堆叠) ── */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-5 text-white shadow-lg md:p-7">
        <div aria-hidden className="pointer-events-none absolute -end-16 -top-20 h-56 w-56 rounded-full bg-teal-500/20 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-24 start-1/3 h-48 w-48 rounded-full bg-emerald-400/10 blur-3xl" />
        <div className="relative flex items-center gap-4 text-start">
          {avatarUrl && !avatarError ? (
            <img
              src={avatarUrl}
              alt="Avatar"
              referrerPolicy="no-referrer"
              crossOrigin="anonymous"
              onError={() => setAvatarError(true)}
              className="h-16 w-16 shrink-0 rounded-full ring-4 ring-white/15 md:h-24 md:w-24"
            />
          ) : (
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-teal-500 ring-4 ring-white/15 md:h-24 md:w-24">
              <User className="h-8 w-8 text-white md:h-12 md:w-12" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-bold md:text-2xl">{displayName}</h1>
            <div className="mt-1 flex items-center gap-1.5 text-sm text-slate-300">
              <Mail className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{user.email}</span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
              {joined && (
                <span className="inline-flex items-center gap-1">
                  <CalendarDays className="h-3 w-3" />
                  {t('profile:joined', { joined })}
                </span>
              )}
              <span>{t('profile:via')}: {user.app_metadata?.provider === 'google' ? 'Google' : (user.app_metadata?.provider || 'Email')}</span>
            </div>
            {/* 勋章:直接常显(手机也显示),点开生成朋友圈分享图 */}
            {MEMBERSHIP_CERT_ENABLED && badge && (
              <button
                onClick={() => setShowBadgeDlg(true)}
                className="mt-3 inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold text-white shadow-lg ring-1 ring-white/20 transition active:scale-95"
                style={{ background: `linear-gradient(90deg, ${badge.from}, ${badge.to})` }}
              >
                <span aria-hidden>{badge.emoji}</span>
                {badgeTitle(t, badge)}
                <span className="text-white/70">· {t('profile:share')}</span>
              </button>
            )}
            {/* 入驻海报:登录时会自动弹一次,这里给个随时重开的入口(纯扩散,分享得 7 天) */}
            {['agent', 'agency', 'developer'].includes(role || '') && (
              <button
                onClick={() => setShowWelcome(true)}
                className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-indigo-500 to-violet-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-lg ring-1 ring-white/20 transition active:scale-95"
              >
                🎉 {t('profile:myWelcomePoster')}<span className="text-white/70">· {t('profile:share2')}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* ── 经纪名片:字段直接平铺,编辑才开弹窗 ── */}
        {isPro ? (
          <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-900/[0.06]">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                  <Contact className="h-4 w-4 text-indigo-500" />
                  {t('profile:agentCard')}
                </h2>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  {t('profile:contactInfoShownTo')}
                </p>
              </div>
              <button
                onClick={() => setShowCardEditor(true)}
                className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-200"
              >
                <Pencil className="h-3 w-3" />
                {t('profile:edit')}
              </button>
            </div>
            <div className="flex items-start gap-4">
              {card?.photo_url ? (
                <img src={card.photo_url} alt="" className="h-16 w-16 shrink-0 rounded-full object-cover ring-2 ring-indigo-100" />
              ) : (
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-xl font-bold text-indigo-300">
                  {(card?.display_name || displayName || '?').charAt(0)}
                </div>
              )}
              <dl className="min-w-0 flex-1 space-y-1.5 text-sm">
                <div className="font-semibold text-slate-900">{card?.display_name || <Empty />}</div>
                <div className="flex items-center gap-1.5 text-slate-600">
                  <Phone className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  {card?.phone || <Empty />}
                </div>
                <div className="flex items-center gap-1.5 text-slate-600">
                  <MessageCircle className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  {card?.whatsapp ? `WhatsApp ${card.whatsapp}` : <Empty />}
                </div>
                <div className="flex items-center gap-1.5 text-slate-600">
                  <Mail className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  {card?.public_email || <span className="text-slate-400">{t('profile:publicEmailNotSet')}</span>}
                </div>
              </dl>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
              {t('profile:shownAsYourSignature')}
            </p>
          </section>
        ) : (
          /* 买家:成为经纪 CTA(唯一保留的引导卡) */
          <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-amber-50 to-orange-50 p-5 ring-1 ring-amber-200/60">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-100">
                <Sparkles className="h-5 w-5 text-orange-600" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-bold text-slate-900">{t('profile:becomeAnAgent7')}</h2>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">
                  {t('profile:unlockClientRadarAi')}
                </p>
                <button
                  onClick={switchRole}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:opacity-95"
                >
                  {t('profile:learnMore')} <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" />
                </button>
              </div>
            </div>
          </section>
        )}

        {/* ── 订阅与用量:套餐/状态/积分直接可见 ── */}
        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-900/[0.06]">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <BarChart3 className="h-4 w-4 text-emerald-500" />
              {t('profile:subscriptionUsage')}
            </h2>
            <Link
              to="/agent/billing"
              className="inline-flex items-center gap-0.5 text-xs font-medium text-emerald-600 hover:underline"
            >
              {isPaid ? t('profile:manage') : t('profile:viewPlans')} <ChevronRight className="h-3 w-3 rtl:-scale-x-100" />
            </Link>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-slate-400">{t('profile:currentPlan')}</div>
              <div className="text-lg font-bold text-slate-900">{planName}</div>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${isPaid ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
              {STATUS_KEY[status] ? t(`profile:${STATUS_KEY[status]}`) : status}
            </span>
          </div>
          {/* 买家没有积分体系 —— 给他看「剩 0/0」像是坏了。讲他真正拥有的东西。 */}
          {role === 'buyer' ? (
            <div className="mt-4 text-sm text-slate-500">
              {t('profile:theMapRealDld')}
            </div>
          ) : (
            <div className="mt-4">
              <div className="mb-1 flex items-baseline justify-between text-sm">
                <span className="text-slate-500">{t('profile:creditsThisMonth')}</span>
                <span className="font-semibold text-slate-900">
                  {unlimited ? t('profile:unlimited') : <>{t('profile:left')} <b className="text-emerald-600">{cBalance.toLocaleString()}</b> / {cMonth.toLocaleString()}</>}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all"
                  style={{ width: unlimited || cMonth === 0 ? '0%' : `${Math.min(100, Math.round((cUsed / cMonth) * 100))}%` }}
                />
              </div>
              {me?.current_period_end && (
                <div className="mt-1.5 text-[11px] text-slate-400">
                  {/* 免绑卡试用没有续费这回事 —— 它到期就是停,不会扣款。别说"下次续费"。 */}
                  {me.trial?.active
                    ? t('profile:freeTrialUntil')
                    : status === 'canceled' ? t('profile:validUntil') : t('profile:renews')}
                  {new Date(me.current_period_end).toLocaleDateString(i18n.language)}
                </div>
              )}
            </div>
          )}

          {/* 老用户从没走过 choose-role → plans 那条路,产品里没别的地方告诉他能白拿 7 天。
              买家的引导交给左侧那张「成为经纪(7 天免费试用)」卡,这里不重复问。 */}
          <TrialClaimCard me={me} buyerNudge={false} />
        </section>
      </div>

      {/* ── 我的收藏:数量直接可见 ── */}
      <Link
        to="/favorites"
        className="group flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-900/[0.06] transition hover:shadow-md"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-50">
          <Heart className="h-5 w-5 text-rose-500" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-slate-900">
            {t('profile:favorites')}
            <span className="ms-2 text-rose-500">{favProjects}</span>
            <span className="ms-1 text-xs font-normal text-slate-400">
              {t('profile:projectsSuffix')}{favTotal > favProjects ? t('profile:favWithSaves', { n: favTotal }) : ''}
            </span>
          </div>
          <div className="text-xs text-slate-400">{t('profile:syncedAcrossDevices')}</div>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 rtl:-scale-x-100" />
      </Link>

      {/* ── 账户操作:flat 一行 ── */}
      <div className="flex flex-wrap items-center gap-2">
        {!badge && (
          <button
            onClick={switchRole}
            className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-sm font-medium text-slate-600 shadow-sm ring-1 ring-slate-900/[0.06] transition hover:bg-slate-50"
          >
            <ArrowLeftRight className="h-4 w-4 text-slate-400" />
            {t('profile:switchRole')}
          </button>
        )}
        {isOwnerEmail(user.email) && (
          <button
            onClick={() => navigate('/admin/analytics')}
            className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-sm font-medium text-slate-600 shadow-sm ring-1 ring-slate-900/[0.06] transition hover:bg-slate-50"
          >
            <BarChart3 className="h-4 w-4 text-blue-500" />
            {t('profile:analytics')}
          </button>
        )}
        {/* 桌面侧栏有退出,但手机端没有侧栏 —— 这里是手机唯一退出入口 */}
        <button
          onClick={() => void signOut()}
          className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-sm font-medium text-red-500 shadow-sm ring-1 ring-slate-900/[0.06] transition hover:bg-red-50 md:hidden"
        >
          <LogOut className="h-4 w-4" />
          {t('profile:signOut3')}
        </button>
      </div>

      {/* 弹窗 */}
      {showBadgeDlg && badge && (
        <RoleBadgeDialog
          badge={badge}
          name={displayName}
          onClose={() => setShowBadgeDlg(false)}
        />
      )}
      {showCardEditor && (
        <AgentCardEditor onClose={() => { setShowCardEditor(false); loadCard() }} />
      )}
      <WelcomePosterModal open={showWelcome} onClose={() => setShowWelcome(false)} />
    </div>
  )
}

function Empty() {
  const { t } = useTranslation('profile')
  return <span className="text-slate-400">{t('notSet')}</span>
}
