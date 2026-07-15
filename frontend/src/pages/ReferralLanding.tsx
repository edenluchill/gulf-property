/**
 * /i/:code — 推荐链接落地页 (2026-07-14) — docs/referral-program-spec.md
 *
 * 唯一的事:把推荐码存进 localStorage(60 天窗口,last-click 覆盖)+ 埋点点击量,
 * 然后跳去定价页。真正的归因在**登录成功那一刻**回传后端钉死(AuthContext →
 * attachStoredCode),换设备/清缓存/隔月付费都不影响归属。
 *
 * 落地页必须显式打出「首月 8 折」—— 否则双边奖励对被推荐人不可见,等于没有。
 */
import { useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Gift } from 'lucide-react'
import { rememberCode } from '../lib/referral'

export default function ReferralLanding() {
  const { code } = useParams<{ code: string }>()
  const navigate = useNavigate()

  useEffect(() => {
    if (code) rememberCode(code)
    // 存完就走。留一拍让用户看到「首月 8 折」,再进定价页。
    const t = setTimeout(() => navigate('/pricing?ref=1', { replace: true }), 1400)
    return () => clearTimeout(t)
  }, [code, navigate])

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-6">
      <div className="text-center max-w-sm">
        <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/30">
          <Gift className="w-8 h-8 text-white" />
        </div>
        <h1 className="mt-5 text-xl font-bold text-slate-900">同行邀请你加入 Pinzos</h1>
        <p className="mt-2 text-sm text-slate-500">迪拜买房新方式 · 让位置说话</p>
        <div className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3.5 py-1.5 text-sm font-semibold text-emerald-700">
          🎁 通过邀请注册,首月 8 折
        </div>
        <p className="mt-6 text-xs text-slate-400">正在带你进入…</p>
      </div>
    </div>
  )
}
