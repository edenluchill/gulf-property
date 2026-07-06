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
import { Navigate } from 'react-router-dom'
import { useUserProfile } from '../contexts/UserProfileContext'

export default function AgentJoin() {
  // 2026-07-05 四角色体系后,本页的「免费早鸟开通」旁路作废 —— 成为经纪必须
  // 走 选角色 → 各自 plans 页 → 付款落身份 的正规流程。保留路由只做转发
  // (老链接/导航按钮仍指向这里)。
  const { profile, isLoading } = useUserProfile()
  if (isLoading) return null
  if (profile?.agent) return <Navigate to="/agent" replace />
  return <Navigate to="/choose-role" replace />
}
