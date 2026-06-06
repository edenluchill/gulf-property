import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import MapPage from './pages/MapPage'
import ProjectDetailPage from './pages/ProjectDetailPage'
import FavoritesPage from './pages/FavoritesPage'
import DeveloperPropertyUploadPageV2 from './pages/DeveloperPropertyUploadPageV2'
import LangGraphTestPage from './pages/LangGraphTestPage'
import DubaiEditor from './pages/DubaiEditor'
import AdminPropertyListPage from './pages/AdminPropertyListPage'
import AdminPropertyEditPage from './pages/AdminPropertyEditPage'
import AdminTasksPage from './pages/AdminTasksPage'
import AdminTaskReviewPage from './pages/AdminTaskReviewPage'
import Layout from './components/Layout'
import AuthCallback from './components/auth/AuthCallback'
import ProtectedRoute from './components/auth/ProtectedRoute'
import LoginPage from './pages/LoginPage'
import ComparePage from './pages/ComparePage'
import ProfilePage from './pages/ProfilePage'
import TransactionsPage from './pages/TransactionsPage'
import AreaInsightsPage from './pages/AreaInsightsPage'
import BuyingReportPage from './pages/BuyingReportPage'
import AgentJoin from './pages/AgentJoin'  // become-an-agent onboarding
import { VoiceAssistantProvider } from './contexts/VoiceAssistantContext'
import { TourModeProvider } from './luna-tour/TourModeContext'  // Luna Tour (isolated)
import AgentLayout from './luna-tour/pages/AgentLayout'  // Luna Tour agent dashboard (isolated)
import AgentOverview from './luna-tour/pages/AgentOverview'  // Luna Tour agent MVP (isolated)
import AgentTours from './luna-tour/pages/AgentTours'  // Luna Tour agent MVP (isolated)
import AgentReport from './luna-tour/pages/AgentReport'  // Luna Tour agent MVP (isolated)
import FactSheet from './luna-tour/pages/FactSheet'  // Luna Tour verifiable fact sheet (isolated)

function App() {
  const { i18n } = useTranslation()

  useEffect(() => {
    document.documentElement.lang = i18n.language
  }, [i18n.language])

  return (
    <TourModeProvider>
    <VoiceAssistantProvider>
    <Layout>
      <Routes>
        {/* Luna Tour: a shared session runs ON the main map (MapPage reads :code) */}
        <Route path="/v/:code" element={<MapPage />} />
        {/* Verifiable, printable fact sheet (sources cited) */}
        <Route path="/factsheet/:code" element={<FactSheet />} />
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
      </Routes>
    </Layout>
    </VoiceAssistantProvider>
    </TourModeProvider>
  )
}

export default App
