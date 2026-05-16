/**
 * 经纪人 Portal (功能 G — 可交付部分)
 * 自助开通"经纪人模式"(免费早鸟试用)。正式订阅(199/299 AED)需支付基建，上线后启用，
 * 此处不做假支付流。核心价值 = 用 DLD 数据出带自己品牌的客户报告。
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useUserProfile } from '../contexts/UserProfileContext'
import { TrendingUp, MapPinned, ClipboardList, Check } from 'lucide-react'

const BRAND_KEY = 'pinzos_agent_brand'

export default function AgentPortalPage() {
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
        <h1 className="text-2xl font-bold text-slate-800">经纪人工作台</h1>
        <p className="mt-2 text-sm text-slate-600">
          用 Dubai Land Department 真实成交数据，为客户生成带你品牌的专业分析报告，在客户面前用数据说话。
        </p>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {[
            ['DLD 数据背书', '成交真相、价格体检、区域分级，全部基于官方成交'],
            ['带品牌客户报告', '报告抬头带你的姓名/机构/RERA，导出 PDF 发客户'],
            ['区域决策工具', '区域对比、AI 买房报告，帮客户快速决策']
          ].map(([t, d]) => (
            <div key={t} className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <div className="text-sm font-semibold text-slate-800">{t}</div>
              <div className="mt-1 text-xs text-slate-500">{d}</div>
            </div>
          ))}
        </div>

        <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="text-sm font-semibold text-emerald-800">早鸟免费试用</div>
          <p className="mt-1 text-xs text-emerald-800">
            现在开通免费使用全部经纪人功能。正式订阅(个人版 早鸟 199 / 正式 299 AED·月起)
            将在支付通道上线后启用，届时另行通知，不会自动扣费。
          </p>
          <button onClick={activate}
            className="mt-3 rounded-lg bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-700">
            成为经纪人 · 开始免费试用
          </button>
        </div>
      </div>
      </div>
    )
  }

  // 已开通：试用状态 + 品牌设置 + 工具入口
  const days = Math.floor((Date.now() - agent.activatedAt) / 86400000)
  const tools = [
    { to: '/report', icon: ClipboardList, label: 'AI 买房决策报告', desc: '问卷 → 推荐 + 区间预测，带你品牌导出' },
    { to: '/transactions', icon: TrendingUp, label: '成交记录查询', desc: '147 万笔 DLD 真实成交多维查询' },
    { to: '/areas', icon: MapPinned, label: '区域分级与对比', desc: '成熟/增长/未来区判断，两区对比' }
  ]

  return (
    <div className="flex-1 overflow-auto pb-20 md:pb-8">
    <div className="container mx-auto max-w-4xl px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">经纪人工作台</h1>
        <button onClick={deactivate} className="text-xs text-slate-400 hover:text-slate-600 hover:underline">
          退出经纪人模式
        </button>
      </div>

      <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
        ✅ 免费早鸟试用中 · 已开通 {days} 天 ·
        正式订阅(199/299 AED·月起)支付通道上线后启用，当前不计费。
      </div>

      {/* 品牌设置 */}
      <div className="mt-6 rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <div className="text-sm font-semibold text-slate-800">我的品牌（用于报告抬头）</div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {([
            ['name', '姓名'], ['agency', '机构'], ['rera', 'RERA / BRN 号'], ['phone', '联系电话']
          ] as [keyof typeof form, string][]).map(([k, label]) => (
            <label key={k} className="flex flex-col gap-1 text-xs text-slate-500">
              {label}
              <input value={form[k]} onChange={e => setForm({ ...form, [k]: e.target.value })}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800" />
            </label>
          ))}
        </div>
        <button onClick={saveBrand}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-white">
          {saved ? <><Check size={15} /> 已保存</> : '保存品牌'}
        </button>
        <p className="mt-2 text-[11px] text-slate-400">信息仅存本机浏览器；保存后在 AI 报告页导出 PDF 即带署名抬头。</p>
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
