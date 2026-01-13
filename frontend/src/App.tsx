import { Routes, Route } from 'react-router-dom'
import HomePage from './pages/HomePage'
import MapPage from './pages/MapPage'
import MapPage2 from './pages/MapPage2'
import ProjectDetailPage from './pages/ProjectDetailPage'
import FavoritesPage from './pages/FavoritesPage'
import DeveloperSubmitPage from './pages/DeveloperSubmitPage'
import DeveloperPropertyUploadPage from './pages/DeveloperPropertyUploadPage'
import DeveloperPropertyUploadPageV2 from './pages/DeveloperPropertyUploadPageV2'
import LangGraphTestPage from './pages/LangGraphTestPage'
import Layout from './components/Layout'

function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/map" element={<MapPage />} />
        <Route path="/map2" element={<MapPage2 />} />
        <Route path="/project/:id" element={<ProjectDetailPage />} />
        <Route path="/favorites" element={<FavoritesPage />} />
        <Route path="/developer/submit" element={<DeveloperSubmitPage />} />
        <Route path="/developer/upload" element={<DeveloperPropertyUploadPageV2 />} />
        <Route path="/developer/upload-old" element={<DeveloperPropertyUploadPage />} />
        <Route path="/langgraph/test" element={<LangGraphTestPage />} />
      </Routes>
    </Layout>
  )
}

export default App
