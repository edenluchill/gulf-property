import { useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { trackEvent, installTracking } from './lib/track'
import { installApiErrorCapture } from './lib/errorCapture'
import ProjectDetailPage from './pages/ProjectDetailPage'
import ProjectReportPage from './pages/ProjectReportPage'
import PaymentPlanSharePage from './pages/PaymentPlanSharePage'  // 付款计划分享页 /pp/:code (客户免登录)
import VerifyPage from './pages/VerifyPage'  // 公开凭证验证页 /verify/:code (证书二维码落地)
import ClientReportPage from './pages/ClientReportPage'
import FavoritesPage from './pages/FavoritesPage'
import DeveloperPropertyUploadPageV2 from './pages/DeveloperPropertyUploadPageV2'
import LangGraphTestPage from './pages/LangGraphTestPage'
import DubaiEditor from './pages/DubaiEditor'
import AdminPropertyListPage from './pages/AdminPropertyListPage'
import AdminPropertyEditPage from './pages/AdminPropertyEditPage'
import AdminTasksPage from './pages/AdminTasksPage'
import AdminTaskReviewPage from './pages/AdminTaskReviewPage'
import AdminAnalytics from './pages/AdminAnalytics'  // Owner-only behaviour dashboard (isolated)
import Layout from './components/Layout'
import AuthCallback from './components/auth/AuthCallback'
import ProtectedRoute from './components/auth/ProtectedRoute'
import LoginPage from './pages/LoginPage'
import ComparePage from './pages/ComparePage'
import ProfileShell from './pages/profile/ProfileShell'  // 个人中心外壳(/profile + /agent/* 共用侧栏)
import ProfileHome from './pages/profile/ProfileHome'  // 个人资料 tab
import TransactionsPage from './pages/TransactionsPage'
import AreaInsightsPage from './pages/AreaInsightsPage'
import BuyingReportPage from './pages/BuyingReportPage'
import AboutPage from './pages/AboutPage'  // marketing / features / SEO page
import { PrivacyPolicyPage, TermsPage } from './pages/LegalPages'  // required by Google OAuth brand verification
import PricingPage from './pages/PricingPage'  // standalone pricing page (Stripe billing)
import AgentJoin from './pages/AgentJoin'  // become-an-agent onboarding
import RoleSelectPage from './pages/RoleSelectPage'  // 四角色选择页(/choose-role)
import { VoiceAssistantProvider } from './contexts/VoiceAssistantContext'
import { TourModeProvider } from './luna-tour/TourModeContext'  // Luna Tour (isolated)
import { useVersionCheck } from './hooks/useVersionCheck'  // 检测新前端版本（iPad 快照恢复等场景）
import AgentLayout from './luna-tour/pages/AgentLayout'  // Luna Tour agent dashboard (isolated)
import AgentOverview from './luna-tour/pages/AgentOverview'  // Luna Tour agent MVP (isolated)
import AgentBilling from './luna-tour/pages/AgentBilling'  // 经纪订阅/升级 (Stripe billing)
import AgentTours from './luna-tour/pages/AgentTours'  // Luna Tour agent MVP (isolated)
import AgentReport from './luna-tour/pages/AgentReport'  // Luna Tour agent MVP (isolated)
import AgentClients from './luna-tour/pages/AgentClients'  // Agent CRM: client profiles
import AgentUsage from './luna-tour/pages/AgentUsage'  // 使用记录(逐笔积分流水)
import AgentLeads from './luna-tour/pages/AgentLeads'  // 共享线索池 + 认领
import FactSheet from './luna-tour/pages/FactSheet'  // Luna Tour verifiable fact sheet (isolated)
import TourEditor from './luna-tour/pages/TourEditor'  // Luna Tour visual storyboard editor (isolated)

/** Behaviour analytics: install page-hide flushing once + emit a page_view on
 *  every route change. Fully decoupled; remove this component + its render to
 *  drop page tracking. */
function RouteTracker() {
  const location = useLocation()
  useEffect(() => {
    installTracking()
    installApiErrorCapture()
  }, [])
  useEffect(() => {
    trackEvent('page_view', { path: location.pathname })
  }, [location.pathname])
  return null
}

function App() {
  const { i18n, t } = useTranslation()
  const { updateAvailable } = useVersionCheck()

  useEffect(() => {
    document.documentElement.lang = i18n.language
  }, [i18n.language])

  return (
    <TourModeProvider>
    <VoiceAssistantProvider>
    <RouteTracker />
    {/* 新版本提示条（编辑页不自动刷新，避免丢表单） */}
    {updateAvailable && (
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-3 bg-gray-900 text-white text-sm px-4 py-2.5 rounded-full shadow-xl">
        <span>{t('common:newVersion.message', '新版本已发布')}</span>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="font-semibold text-teal-300 hover:text-teal-200"
        >
          {t('common:newVersion.refresh', '立即刷新')}
        </button>
      </div>
    )}
    <Layout>
      <Routes>
        {/* NOTE: the map routes ('/', '/map', '/v/:code', '/t/:code') are NOT here.
            MapPage is mounted persistently inside <Layout> so the WebGL map is never
            torn down on tab switches. Layout shows/hides it based on the route. */}
        {/* Verifiable, printable fact sheet (sources cited) */}
        <Route path="/factsheet/:code" element={<FactSheet />} />
        {/* Agent-branded shareable per-project report */}
        <Route path="/r/:code" element={<ProjectReportPage />} />
        {/* Shareable payment-plan quote (agent picks unit + types actual price) */}
        <Route path="/pp/:code" element={<PaymentPlanSharePage />} />
        {/* 公开凭证验证页(证书二维码/链接落地) */}
        <Route path="/verify/:code" element={<VerifyPage />} />
        {/* Comprehensive client investment proposal (shareable, printable) */}
        <Route path="/cr/:code" element={<ClientReportPage />} />
        {/* Full-screen visual storyboard editor */}
        <Route path="/agent/tour/:id/edit" element={<TourEditor />} />
        {/* 个人中心(统一外壳:左侧栏 = 个人资料 + 经纪台各 tab)。
            /profile 与 /agent/* 共用 ProfileShell,URL 不变(深链/Stripe 回跳照旧);
            经纪台审批门(AgentLayout)只包 /agent 子路由。 */}
        <Route element={<ProfileShell />}>
          <Route path="/profile" element={<ProfileHome />} />
          {/* 订阅与套餐是通用页(买家也能看升级选项),不进经纪审批门 */}
          <Route path="/agent/billing" element={<AgentBilling />} />
          <Route path="/agent" element={<AgentLayout />}>
            <Route index element={<AgentOverview />} />
            <Route path="clients" element={<AgentClients />} />
            <Route path="leads" element={<AgentLeads />} />
            <Route path="tour" element={<AgentTours />} />
            <Route path="report" element={<AgentReport />} />
            <Route path="usage" element={<AgentUsage />} />
          </Route>
        </Route>
        {/* Become-an-agent onboarding (no sidebar; flips the account to agent) */}
        <Route path="/agent/join" element={<AgentJoin />} />
        {/* 选择身份(独立页面;首登无角色由 RoleSelectRedirect 送来) */}
        <Route path="/choose-role" element={<RoleSelectPage />} />
        {/* 角色专属选档页(各角色只看到自己的套餐,无免费选项,引导式文案) */}
        <Route path="/agent/plans" element={<PricingPage agentOnboarding variant="agent" />} />
        <Route path="/agency/plans" element={<PricingPage agentOnboarding variant="agency" />} />
        <Route path="/developer/plans" element={<PricingPage agentOnboarding variant="developer" />} />
        {/* Legacy Luna paths → new agent hub */}
        <Route path="/luna/agent" element={<Navigate to="/agent" replace />} />
        <Route path="/luna/agent/*" element={<Navigate to="/agent" replace />} />
        <Route path="/project/:id" element={<ProjectDetailPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/privacy" element={<PrivacyPolicyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/favorites" element={<FavoritesPage />} />
        <Route path="/compare" element={<ComparePage />} />
        <Route path="/transactions" element={<TransactionsPage />} />
        <Route path="/areas" element={<AreaInsightsPage />} />
        <Route path="/report" element={<BuyingReportPage />} />
        <Route
          path="/developer/upload"
          element={
            <ProtectedRoute requireUploader>
              <DeveloperPropertyUploadPageV2 />
            </ProtectedRoute>
          }
        />
        <Route path="/langgraph/test" element={<LangGraphTestPage />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/admin/dubai"
          element={
            <ProtectedRoute requireAdmin>
              <DubaiEditor />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/properties"
          element={
            <ProtectedRoute requireUploader>
              <AdminPropertyListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/property/edit/:id"
          element={
            <ProtectedRoute requireUploader>
              <AdminPropertyEditPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/tasks"
          element={
            <ProtectedRoute requireUploader>
              <AdminTasksPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/tasks/:jobId/review"
          element={
            <ProtectedRoute requireUploader>
              <AdminTaskReviewPage />
            </ProtectedRoute>
          }
        />
        {/* Admin-only behaviour analytics (admin-gated here; owner-email gated in-page + server) */}
        <Route
          path="/admin/analytics"
          element={
            <ProtectedRoute requireAdmin>
              <AdminAnalytics />
            </ProtectedRoute>
          }
        />
        {/* 兜底:未知路径回地图,别留白屏。此前没有 catch-all —— /undefined(30 天 19 个
            真人,站外坏链接)、拼错的 URL、过期分享全都渲染成一片空白然后人就走了。 */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
    </VoiceAssistantProvider>
    </TourModeProvider>
  )
}

export default App
