import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import App from './App.tsx'
import AppErrorBoundary from './components/AppErrorBoundary'
import { AuthProvider } from './contexts/AuthContext'
import { FavoritesProvider } from './contexts/FavoritesContext'
import { UserProfileProvider } from './contexts/UserProfileContext'
import { startPagePerf } from './lib/pagePerf'
import './i18n'
import './index.css'
import 'leaflet/dist/leaflet.css'

// 客户端真实体验上报(首屏 / 瓦片字节)。全站自动覆盖,不用逐页埋点。
startPagePerf()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
    <HelmetProvider>
      <AuthProvider>
        <UserProfileProvider>
          <FavoritesProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </FavoritesProvider>
        </UserProfileProvider>
      </AuthProvider>
    </HelmetProvider>
    </AppErrorBoundary>
  </React.StrictMode>,
)
