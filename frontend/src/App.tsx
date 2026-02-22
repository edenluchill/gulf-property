import { useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
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

function App() {
  const { i18n } = useTranslation()

  useEffect(() => {
    document.documentElement.lang = i18n.language
  }, [i18n.language])

  return (
    <Layout>
      <Routes>
        {/* MapPage is now the homepage */}
        <Route path="/" element={<MapPage />} />
        <Route path="/map" element={<MapPage />} />
        <Route path="/project/:id" element={<ProjectDetailPage />} />
        <Route path="/favorites" element={<FavoritesPage />} />
        <Route path="/compare" element={<ComparePage />} />
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
  )
}

export default App
