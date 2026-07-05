import { ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Lock } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { Button } from '../ui/button'
import LoginDialog from './LoginDialog'

interface ProtectedRouteProps {
  children: ReactNode
  requireAdmin?: boolean
  /** 上传楼书相关页:admin 或被单独授权(upload_permissions)的账号都可进 */
  requireUploader?: boolean
}

export default function ProtectedRoute({ children, requireAdmin = false, requireUploader = false }: ProtectedRouteProps) {
  const { user, loading, isAdmin, canUpload, isConfigured } = useAuth()
  const { t } = useTranslation('auth')
  const [showLogin, setShowLogin] = useState(false)

  // If Supabase is not configured, show a message but allow access in development
  if (!isConfigured) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center p-8 max-w-md">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-teal-100 flex items-center justify-center">
            <Lock className="w-8 h-8 text-teal-600" />
          </div>
          <h2 className="text-xl font-semibold text-slate-900 mb-2">
            Authentication Not Configured
          </h2>
          <p className="text-slate-600 mb-6">
            Supabase environment variables are not set. Please configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
          </p>
        </div>
      </div>
    )
  }

  // Show loading spinner while checking auth state
  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-teal-500 animate-spin" />
      </div>
    )
  }

  // If not logged in, show login prompt
  if (!user) {
    return (
      <>
        <div className="min-h-[60vh] flex items-center justify-center">
          <div className="text-center p-8 max-w-md">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-teal-100 flex items-center justify-center">
              <Lock className="w-8 h-8 text-teal-600" />
            </div>
            <h2 className="text-xl font-semibold text-slate-900 mb-2">
              {t('loginRequired')}
            </h2>
            <p className="text-slate-600 mb-6">
              {t('loginRequiredDesc')}
            </p>
            <Button
              onClick={() => setShowLogin(true)}
              className="bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-600 hover:to-emerald-600 text-white px-8 py-3 rounded-lg font-medium"
            >
              {t('login')}
            </Button>
          </div>
        </div>
        <LoginDialog open={showLogin} onOpenChange={setShowLogin} />
      </>
    )
  }

  // 上传权限还在向服务端查询中 → 等结果,别闪「无权限」
  if (requireUploader && !isAdmin && canUpload === null) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-teal-500 animate-spin" />
      </div>
    )
  }

  // If admin is required but user is not admin
  if ((requireAdmin && !isAdmin) || (requireUploader && !isAdmin && !canUpload)) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center p-8 max-w-md">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-100 flex items-center justify-center">
            <Lock className="w-8 h-8 text-red-600" />
          </div>
          <h2 className="text-xl font-semibold text-slate-900 mb-2">
            {t('accessDenied', 'Access Denied')}
          </h2>
          <p className="text-slate-600 mb-6">
            {t('adminRequired', 'You need admin privileges to access this page.')}
          </p>
          <Button
            onClick={() => window.history.back()}
            variant="outline"
            className="px-8 py-3 rounded-lg font-medium"
          >
            {t('goBack', 'Go Back')}
          </Button>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
