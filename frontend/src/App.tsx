import { useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { trackEvent, installTracking } from './lib/track'
import { installApiErrorCapture } from './lib/errorCapture'
import MapPage from './pages/MapPage'
import ProjectDetailPage from './pages/ProjectDetailPage'
import ProjectReportPage from './pages/ProjectReportPage'
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
import ProfilePage from './pages/ProfilePage'
import TransactionsPage from './pages/TransactionsPage'
import AreaInsightsPage from './pages/AreaInsightsPage'
import BuyingReportPage from './pages/BuyingReportPage'
import AboutPage from './pages/AboutPage'  // marketing / features / SEO page
import AgentJoin from './pages/AgentJoin'  // become-an-agent onboarding
import { VoiceAssistantProvider } from './contexts/VoiceAssistantContext'
import { TourModeProvider } from './luna-tour/TourModeContext'  // Luna Tour (isolated)
import { useVersionCheck } from './hooks/useVersionCheck'  // 检测新前端版本（iPad 快照恢复等场景）
import AgentLayout from './luna-tour/pages/AgentLayout'  // Luna Tour agent dashboard (isolated)
import AgentOverview from './luna-tour/pages/AgentOverview'  // Luna Tour agent MVP (isolated)
import AgentTours from './luna-tour/pages/AgentTours'  // Luna Tour agent MVP (isolated)
import AgentReport from './luna-tour/pages/AgentReport'  // Luna Tour agent MVP (isolated)
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
        {/* Luna Tour: a shared session runs ON the main map (MapPage reads :code) */}
        <Route path="/v/:code" element={<MapPage />} />
        {/* Collab co-presence: a guest opens a live tour link (public, no login) */}
        <Route path="/t/:code" element={<MapPage />} />
        {/* Verifiable, printable fact sheet (sources cited) */}
        <Route path="/factsheet/:code" element={<FactSheet />} />
        {/* Agent-branded shareable per-project report */}
        <Route path="/r/:code" element={<ProjectReportPage />} />
        {/* Comprehensive client investment proposal (shareable, printable) */}
        <Route path="/cr/:code" element={<ClientReportPage />} />
        {/* Full-screen visual storyboard editor */}
        <Route path="/agent/tour/:id/edit" element={<TourEditor />} />
        {/* Agent hub — sidebar tabs + nested routes (gated to agent accounts) */}
        <Route path="/agent" element={<AgentLayout />}>
          <Route index element={<AgentOverview />} />
          <Route path="tour" element={<AgentTours />} />
          <Route path="report" element={<AgentReport />} />
        </Route>
        {/* Become-an-agent onboarding (no sidebar; flips the account to agent) */}
        <Route path="/agent/join" element={<AgentJoin />} />
        {/* Legacy Luna paths → new agent hub */}
        <Route path="/luna/agent" element={<Navigate to="/agent" replace />} />
        <Route path="/luna/agent/*" element={<Navigate to="/agent" replace />} />
        {/* MapPage is now the homepage */}
        <Route path="/" element={<MapPage />} />
        <Route path="/map" element={<MapPage />} />
        <Route path="/project/:id" element={<ProjectDetailPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/pricing" element={<AboutPage />} />
        <Route path="/favorites" element={<FavoritesPage />} />
        <Route path="/compare" element={<ComparePage />} />
        <Route path="/transactions" element={<TransactionsPage />} />
        <Route path="/areas" element={<AreaInsightsPage />} />
        <Route path="/report" element={<BuyingReportPage />} />
        <Route path="/developer/upload" element={<DeveloperPropertyUploadPageV2 />} />
        <Route path="/langgraph/test" element={<LangGraphTestPage />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route
          path="/admin/dubai"
          element={
            <ProtectedRoute>
              <DubaiEditor />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/properties"
          element={
            <ProtectedRoute>
              <AdminPropertyListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/property/edit/:id"
          element={
            <ProtectedRoute>
              <AdminPropertyEditPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/tasks"
          element={
            <ProtectedRoute>
              <AdminTasksPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/tasks/:jobId/review"
          element={
            <ProtectedRoute>
              <AdminTaskReviewPage />
            </ProtectedRoute>
          }
        />
        {/* Owner-only behaviour analytics (login-gated here; owner-email gated in-page + server) */}
        <Route
          path="/admin/analytics"
          element={
            <ProtectedRoute>
              <AdminAnalytics />
            </ProtectedRoute>
          }
        />
      </Routes>
    </Layout>
    </VoiceAssistantProvider>
    </TourModeProvider>
  )
}

export default App
