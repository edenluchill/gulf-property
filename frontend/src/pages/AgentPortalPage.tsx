/**
 * 经纪人 Portal (功能 G — 可交付部分)
 * 自助开通"经纪人模式"(免费早鸟试用)。正式订阅(199/299 AED)需支付基建，上线后启用，
 * 此处不做假支付流。核心价值 = 用 DLD 数据出带自己品牌的客户报告。
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useUserProfile } from '../contexts/UserProfileContext'
import { TrendingUp, MapPinned, ClipboardList, Check } from 'lucide-react'

const BRAND_KEY = 'pinzos_agent_brand'

export default function AgentPortalPage() {
  const { t } = useTranslation(['agent', 'common'])
  const { profile, saveProfile } = useUserProfile()
  const agent = profile?.agent || null
  const [form, setForm] = useState({
    name: agent?.name || '',
    agency: agent?.agency || '',
    rera: agent?.rera || '',
    phone: agent?.phone || ''
  })
  const [saved, setSaved] = useState(false)

  const activate = () => {
    saveProfile({ agent: { activatedAt: Date.now() } })
  }
  const deactivate = () => {
    saveProfile({ agent: undefined })
  }
  const saveBrand = () => {
    saveProfile({ agent: { activatedAt: agent?.activatedAt || Date.now(), ...form } })
    // 同步给报告页使用的 key，导出 PDF 即带署名
    try { localStorage.setItem(BRAND_KEY, JSON.stringify(form)) } catch { /* ignore */ }
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  // 未开通：介绍 + 开通入口
  if (!agent) {
    return (
      <div className="flex-1 overflow-auto pb-20 md:pb-8">
      <div className="container mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-bold text-slate-800">{t('title')}</h1>
        <p className="mt-2 text-sm text-slate-600">
          {t('intro')}
        </p>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {(['dld', 'branded', 'tools'] as const).map(fk => (
            <div key={fk} className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <div className="text-sm font-semibold text-slate-800">{t(`features.${fk}Title`)}</div>
              <div className="mt-1 text-xs text-slate-500">{t(`features.${fk}Desc`)}</div>
            </div>
          ))}
        </div>

        <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="text-sm font-semibold text-emerald-800">{t('trial.title')}</div>
          <p className="mt-1 text-xs text-emerald-800">
            {t('trial.desc')}
          </p>
          <button onClick={activate}
            className="mt-3 rounded-lg bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-700">
            {t('trial.activate')}
          </button>
        </div>
      </div>
      </div>
    )
  }

  // 已开通：试用状态 + 品牌设置 + 工具入口
  const days = Math.floor((Date.now() - agent.activatedAt) / 86400000)
  const tools = [
    { to: '/report', icon: ClipboardList, label: t('tools.reportLabel'), desc: t('tools.reportDesc') },
    { to: '/transactions', icon: TrendingUp, label: t('tools.transactionsLabel'), desc: t('tools.transactionsDesc') },
    { to: '/areas', icon: MapPinned, label: t('tools.areasLabel'), desc: t('tools.areasDesc') }
  ]

  return (
    <div className="flex-1 overflow-auto pb-20 md:pb-8">
    <div className="container mx-auto max-w-4xl px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">{t('title')}</h1>
        <button onClick={deactivate} className="text-xs text-slate-400 hover:text-slate-600 hover:underline">
          {t('active.exit')}
        </button>
      </div>

      <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
        {t('active.status', { days })}
      </div>

      {/* 品牌设置 */}
      <div className="mt-6 rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <div className="text-sm font-semibold text-slate-800">{t('active.brandTitle')}</div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {(['name', 'agency', 'rera', 'phone'] as (keyof typeof form)[]).map(k => (
            <label key={k} className="flex flex-col gap-1 text-xs text-slate-500">
              {t(`active.${k}`)}
              <input value={form[k]} onChange={e => setForm({ ...form, [k]: e.target.value })}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800" />
            </label>
          ))}
        </div>
        <button onClick={saveBrand}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-white">
          {saved ? <><Check size={15} /> {t('active.saved')}</> : t('active.save')}
        </button>
        <p className="mt-2 text-[11px] text-slate-400">{t('active.brandHint')}</p>
      </div>

      {/* 工具入口 */}
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {tools.map(({ to, icon: Icon, label, desc }) => (
          <Link key={to} to={to}
            className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 transition hover:ring-primary">
            <Icon size={18} className="text-primary" />
            <div className="mt-2 text-sm font-semibold text-slate-800">{label}</div>
            <div className="mt-1 text-xs text-slate-500">{desc}</div>
          </Link>
        ))}
      </div>
    </div>
    </div>
  )
}
