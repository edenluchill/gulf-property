import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Mail, Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs'
import { Button } from '../ui/button'
import { useAuth } from '../../contexts/AuthContext'
import { isWeChatBrowser } from '../../lib/browser'

interface LoginDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function LoginDialog({ open, onOpenChange }: LoginDialogProps) {
  const { t } = useTranslation('auth')
  const { signInWithOtp, verifyOtp, signInWithGoogle, signInWithMicrosoft, isConfigured } = useAuth()
  // 微信 WebView 拦 OAuth 跳转 → Google/Microsoft 在这里点了必然失败,只留邮箱验证码。
  const inWeChat = isWeChatBrowser()

  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSendCode = async () => {
    if (!email.trim()) {
      setError(t('emailRequired'))
      return
    }

    setLoading(true)
    setError(null)

    const { error } = await signInWithOtp(email)

    setLoading(false)

    if (error) {
      setError(error.message)
    } else {
      setStep('code')
    }
  }

  const handleVerifyCode = async () => {
    if (!code.trim()) {
      setError(t('codeRequired', 'Please enter the code'))
      return
    }

    setLoading(true)
    setError(null)

    const { error } = await verifyOtp(email, code)

    setLoading(false)

    if (error) {
      setError(t('invalidCode'))
    } else {
      onOpenChange(false)
      resetForm()
    }
  }

  const handleGoogleLogin = async () => {
    setLoading(true)
    setError(null)
    const { error } = await signInWithGoogle()
    if (error) {
      setError(error.message)
      setLoading(false)
    }
    // OAuth will redirect, so no need to handle success here
  }

  const handleMicrosoftLogin = async () => {
    setLoading(true)
    setError(null)
    const { error } = await signInWithMicrosoft()
    if (error) {
      setError(error.message)
      setLoading(false)
    }
  }

  const resetForm = () => {
    setEmail('')
    setCode('')
    setStep('email')
    setError(null)
  }

  const handleClose = (open: boolean) => {
    if (!open) {
      resetForm()
    }
    onOpenChange(open)
  }

  if (!isConfigured) {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="w-full max-w-md">
          <DialogHeader>
            <DialogTitle>{t('login')}</DialogTitle>
          </DialogHeader>
          <div className="p-6 text-center text-slate-500">
            <p>Authentication is not configured.</p>
            <p className="text-sm mt-2">Please set up Supabase environment variables.</p>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="w-full max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-center">
            {t('login')}
          </DialogTitle>
        </DialogHeader>

        <div className="p-6 pt-2">
          <Tabs defaultValue="email" className="w-full">
            <TabsList className={`grid w-full mb-6 ${inWeChat ? 'grid-cols-1' : 'grid-cols-3'}`}>
              <TabsTrigger value="email" className="text-sm">
                <Mail className="w-4 h-4 mr-2" />
                Email
              </TabsTrigger>
              {!inWeChat && (
                <TabsTrigger value="google" className="text-sm">
                  <GoogleIcon className="w-4 h-4 mr-2" />
                  Google
                </TabsTrigger>
              )}
              {!inWeChat && (
                <TabsTrigger value="microsoft" className="text-sm">
                  <MicrosoftIcon className="w-4 h-4 mr-2" />
                  Microsoft
                </TabsTrigger>
              )}
            </TabsList>

            <TabsContent value="email" className="space-y-4">
              {step === 'email' ? (
                <>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      {t('email')}
                    </label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder={t('emailPlaceholder')}
                      className="w-full px-4 py-3 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all"
                      disabled={loading}
                      onKeyDown={(e) => e.key === 'Enter' && handleSendCode()}
                    />
                  </div>

                  {error && (
                    <p className="text-sm text-red-500">{error}</p>
                  )}

                  <Button
                    onClick={handleSendCode}
                    disabled={loading}
                    className="w-full bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-600 hover:to-emerald-600 text-white py-3 rounded-lg font-medium transition-colors"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        {t('sendingCode')}
                      </>
                    ) : (
                      t('sendCode')
                    )}
                  </Button>

                  {inWeChat && (
                    <p className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs leading-relaxed text-amber-800">
                      {t('wechatNoGoogle')}
                    </p>
                  )}
                </>
              ) : (
                <>
                  <div className="text-center mb-4">
                    <p className="text-sm text-slate-600">{t('checkEmail')}</p>
                    <p className="text-sm text-slate-500 mt-1">{email}</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      {t('verificationCode')}
                    </label>
                    <input
                      type="text"
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder={t('codePlaceholder')}
                      className="w-full px-4 py-3 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all text-center text-2xl tracking-widest"
                      disabled={loading}
                      maxLength={6}
                      onKeyDown={(e) => e.key === 'Enter' && handleVerifyCode()}
                    />
                  </div>

                  {error && (
                    <p className="text-sm text-red-500">{error}</p>
                  )}

                  <Button
                    onClick={handleVerifyCode}
                    disabled={loading || code.length < 6}
                    className="w-full bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-600 hover:to-emerald-600 text-white py-3 rounded-lg font-medium transition-colors"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        {t('verifying')}
                      </>
                    ) : (
                      t('verify')
                    )}
                  </Button>

                  <button
                    onClick={() => setStep('email')}
                    className="w-full text-sm text-slate-500 hover:text-slate-700 mt-2"
                  >
                    {t('backToEmail', 'Use a different email')}
                  </button>
                </>
              )}
            </TabsContent>

            <TabsContent value="google" className="space-y-4">
              <p className="text-sm text-slate-600 text-center mb-4">
                {t('orContinueWith')}
              </p>

              {error && (
                <p className="text-sm text-red-500 text-center">{error}</p>
              )}

              <Button
                onClick={handleGoogleLogin}
                disabled={loading}
                variant="outline"
                className="w-full py-3 border-2 hover:bg-slate-50 rounded-lg font-medium transition-colors flex items-center justify-center gap-3"
              >
                {loading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    <GoogleIcon className="w-5 h-5" />
                    {t('continueWithGoogle')}
                  </>
                )}
              </Button>
            </TabsContent>

            <TabsContent value="microsoft" className="space-y-4">
              <p className="text-sm text-slate-600 text-center mb-4">
                {t('orContinueWith')}
              </p>

              {error && (
                <p className="text-sm text-red-500 text-center">{error}</p>
              )}

              <Button
                onClick={handleMicrosoftLogin}
                disabled={loading}
                variant="outline"
                className="w-full py-3 border-2 hover:bg-slate-50 rounded-lg font-medium transition-colors flex items-center justify-center gap-3"
              >
                {loading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    <MicrosoftIcon className="w-5 h-5" />
                    {t('continueWithMicrosoft')}
                  </>
                )}
              </Button>
            </TabsContent>
          </Tabs>

          {/* Legal consent — links open in a new tab so the sign-in flow isn't lost */}
          <p className="mt-4 text-center text-xs leading-relaxed text-slate-400">
            {t('legalPrefix', 'By signing in, you agree to our')}{' '}
            <a href="/terms" target="_blank" rel="noopener" className="text-teal-600 hover:underline">{t('terms', 'Terms of Service')}</a>
            {' '}{t('legalAnd', 'and')}{' '}
            <a href="/privacy" target="_blank" rel="noopener" className="text-teal-600 hover:underline">{t('privacy', 'Privacy Policy')}</a>
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  )
}

function MicrosoftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path fill="#F25022" d="M1 1h10v10H1z" />
      <path fill="#00A4EF" d="M1 13h10v10H1z" />
      <path fill="#7FBA00" d="M13 1h10v10H13z" />
      <path fill="#FFB900" d="M13 13h10v10H13z" />
    </svg>
  )
}
