import { Routes, Route } from 'react-router-dom'
import HomePage from './pages/HomePage'
import MapPage from './pages/MapPage'
import ProjectDetailPage from './pages/ProjectDetailPage'
import FavoritesPage from './pages/FavoritesPage'
import DeveloperSubmitPage from './pages/DeveloperSubmitPage'
import DeveloperPropertyUploadPageV2 from './pages/DeveloperPropertyUploadPageV2'
import LangGraphTestPage from './pages/LangGraphTestPage'
import DubaiEditor from './pages/DubaiEditor'
import AdminPropertyListPage from './pages/AdminPropertyListPage'
import AdminPropertyEditPage from './pages/AdminPropertyEditPage'
import Layout from './components/Layout'

function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/map" element={<MapPage />} />
        <Route path="/project/:id" element={<ProjectDetailPage />} />
        <Route path="/favorites" element={<FavoritesPage />} />
        <Route path="/developer/submit" element={<DeveloperSubmitPage />} />
        <Route path="/developer/upload" element={<DeveloperPropertyUploadPageV2 />} />
        <Route path="/langgraph/test" element={<LangGraphTestPage />} />
        <Route path="/admin/dubai" element={<DubaiEditor />} />
        <Route path="/admin/properties" element={<AdminPropertyListPage />} />
        <Route path="/admin/property/edit/:id" element={<AdminPropertyEditPage />} />
      </Routes>
    </Layout>
  )
}

export default App
