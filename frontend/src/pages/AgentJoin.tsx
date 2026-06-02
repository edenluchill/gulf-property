/**
 * Become-an-agent onboarding (route: /agent/join).
 *
 * The single entry point that turns a normal account into an agent account.
 * MVP: flips the localStorage `profile.agent` flag (same gate the dashboard
 * reads), then sends you into the agent hub at /agent. When real per-account
 * agent auth lands, swap saveProfile() for the activation API call here.
 *
 * Already an agent → bounce straight to /agent (so this entry "disappears").
 */
import { useNavigate, Navigate } from 'react-router-dom'
import { Briefcase, Film, Sparkles, BarChart3, Check } from 'lucide-react'
import { useUserProfile } from '../contexts/UserProfileContext'

const PERKS = [
  { icon: Film, title: '生成沉浸式导览', desc: '为客户一键生成带运镜、配音的看房视频导览' },
  { icon: Sparkles, title: 'AI 智能匹配房源', desc: '输入客户画像，AI 从真实库里挑房并解释为何适合' },
  { icon: BarChart3, title: '客户行为分析', desc: '谁打开、看了多久、点了联系 —— 热度一目了然' },
]

export default function AgentJoin() {
  const { profile, saveProfile, isLoading } = useUserProfile()
  const navigate = useNavigate()

  if (isLoading) return null
  if (profile?.agent) return <Navigate to="/agent" replace />

  const become = () => {
    saveProfile({ agent: { activatedAt: Date.now() } })
    navigate('/agent', { replace: true })
  }

  return (
    <div className="flex-1 overflow-auto pb-20 md:pb-8">
      <div className="container mx-auto max-w-2xl px-4 py-12">
        <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
          <Briefcase size={14} /> Pinzos 经纪台
        </div>
        <h1 className="mt-4 text-3xl font-bold text-slate-900">成为经纪，把楼盘讲成故事</h1>
        <p className="mt-2 text-slate-600">
          开通经纪台，用真实房源数据为每位客户生成专属看房导览、AI 匹配房源，并实时追踪客户兴趣。免费早鸟开通。
        </p>

        <div className="mt-8 space-y-3">
          {PERKS.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="flex items-start gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                <Icon size={18} />
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-800">{title}</div>
                <div className="mt-0.5 text-xs text-slate-500">{desc}</div>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={become}
          className="mt-8 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-6 py-3 text-sm font-medium text-white hover:bg-emerald-700"
        >
          <Check size={16} /> 免费开通经纪台
        </button>
        <p className="mt-3 text-xs text-slate-400">开通后即可在「经纪台」生成导览、查看客户行为。可随时退出。</p>
      </div>
    </div>
  )
}
