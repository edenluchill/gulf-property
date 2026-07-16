import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import { Building2, Mail, ArrowLeft, Loader2, CheckCircle, TrendingUp, Shield, BarChart3, ArrowUpRight } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { useAuth } from '../contexts/AuthContext'
import { isWeChatBrowser } from '../lib/browser'
import { friendlyAuthError, isRateLimitError } from '../lib/authErrors'
import { useSendCooldown, OTP_COOLDOWN_SECONDS } from '../hooks/useSendCooldown'

export default function LoginPage() {
  const { t } = useTranslation(['auth', 'common'])
  const navigate = useNavigate()
  const { signInWithOtp, verifyOtp, signInWithGoogle } = useAuth()
  const inWeChat = isWeChatBrowser()

  // ?returnTo=/agent 等入口(经纪台登录门等)登录后回跳。只接受站内路径。
  // Google/magic-link 走整页跳转 → 经 /auth/callback 回来,那边读的是
  // sessionStorage.authReturnUrl,所以这里两个通道都要写。
  const [searchParams] = useSearchParams()
  const rawReturnTo = searchParams.get('returnTo') || ''
  const returnTo = rawReturnTo.startsWith('/') && !rawReturnTo.startsWith('//') ? rawReturnTo : '/'
  useEffect(() => {
    if (returnTo === '/') return
    try { sessionStorage.setItem('authReturnUrl', returnTo) } catch { /* storage 被禁则回首页 */ }
  }, [returnTo])

  const [email, setEmail] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [step, setStep] = useState<'email' | 'otp' | 'success'>('email')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const { remaining: cooldown, start: startCooldown } = useSendCooldown()

  // 点「Continue with Google」会整页跳转 → loading=true。用户按「后退」回来时页面常从
  // bfcache 恢复,React state 冻在 loading=true → 按钮永远卡在「Sending...」。pageshow
  // 是 bfcache 恢复的规范信号(首次加载也会触发,那时 loading 本就是 false,复位无副作用)。
  useEffect(() => {
    const reset = () => setLoading(false)
    window.addEventListener('pageshow', reset)
    return () => window.removeEventListener('pageshow', reset)
  }, [])

  const handleSendOtp = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!email.trim()) {
      setError(t('auth:emailRequired'))
      return
    }
    if (cooldown > 0) return // 冷却中,别再发(防触发 Supabase 邮件限流)

    setLoading(true)
    setError('')

    try {
      const { error } = await signInWithOtp(email)
      if (error) {
        setError(friendlyAuthError(error, t))
        if (isRateLimitError(error)) startCooldown(OTP_COOLDOWN_SECONDS)
      } else {
        startCooldown(OTP_COOLDOWN_SECONDS) // 成功也冷却,和 Supabase 单用户间隔对齐
        setStep('otp')
      }
    } catch (err: any) {
      setError(err.message || t('auth:errGeneric', 'Failed to send code'))
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!otpCode.trim()) {
      setError(t('auth:codeRequired', 'Please enter the code'))
      return
    }

    setLoading(true)
    setError('')

    try {
      const { error } = await verifyOtp(email, otpCode)
      if (error) {
        setError(t('auth:invalidCode'))
      } else {
        setStep('success')
        setTimeout(() => {
          try { sessionStorage.removeItem('authReturnUrl') } catch { /* noop */ }
          navigate(returnTo)
        }, 1500)
      }
    } catch (err: any) {
      setError(err.message || 'Verification failed')
    } finally {
      setLoading(false)
    }
  }

  const handleGoogleLogin = async () => {
    setLoading(true)
    setError('')
    try {
      await signInWithGoogle()
    } catch (err: any) {
      setError(err.message || 'Google login failed')
      setLoading(false)
    }
  }

  const investmentFeatures = [
    { icon: TrendingUp, text: t('auth:feature1', 'Track property ROI & market trends') },
    { icon: BarChart3, text: t('auth:feature2', 'Compare investment opportunities') },
    { icon: Shield, text: t('auth:feature3', 'Secure & verified listings') },
  ]

  return (
    <div className="flex-1 flex overflow-hidden bg-gradient-to-br from-slate-50 via-white to-teal-50/40 relative">
      {/* Background grid */}
      <div className="absolute inset-0 opacity-[0.4]">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `linear-gradient(rgba(15, 118, 110, 0.03) 1px, transparent 1px),
                             linear-gradient(90deg, rgba(15, 118, 110, 0.03) 1px, transparent 1px)`,
            backgroundSize: '40px 40px',
          }}
        />
      </div>

      {/* Animated Investment Background Elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {/* Floating gradient orbs */}
        <motion.div
          className="absolute w-[500px] h-[500px] bg-gradient-to-br from-teal-100/60 to-emerald-100/40 rounded-full blur-3xl"
          animate={{
            x: [0, 30, 0],
            y: [0, -20, 0],
          }}
          transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
          style={{ top: '-10%', right: '20%' }}
        />
        <motion.div
          className="absolute w-[400px] h-[400px] bg-gradient-to-br from-teal-100/40 to-emerald-100/20 rounded-full blur-3xl"
          animate={{
            x: [0, -20, 0],
            y: [0, 30, 0],
          }}
          transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut', delay: 3 }}
          style={{ bottom: '-5%', left: '10%' }}
        />

        {/* Animated candlestick chart lines - subtle investment theme */}
        <svg className="absolute start-[5%] top-[20%] w-[300px] h-[200px] opacity-[0.08]" viewBox="0 0 300 200">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
            const x = 20 + i * 35
            const heights = [60, 80, 50, 90, 70, 100, 65, 85]
            const h = heights[i]
            return (
              <motion.g key={i}>
                <motion.line
                  x1={x} y1={180 - h} x2={x} y2={180}
                  stroke="#0d9488"
                  strokeWidth="2"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 1.5, delay: i * 0.15, ease: 'easeOut' }}
                />
                <motion.rect
                  x={x - 8} y={180 - h + 10}
                  width="16" height={h * 0.6}
                  fill={i % 2 === 0 ? '#10b981' : '#0d9488'}
                  initial={{ scaleY: 0 }}
                  animate={{ scaleY: 1 }}
                  transition={{ duration: 0.8, delay: 0.5 + i * 0.15, ease: 'easeOut' }}
                  style={{ transformOrigin: 'bottom' }}
                />
              </motion.g>
            )
          })}
        </svg>

        {/* Rising trend line animation */}
        <svg className="absolute end-[8%] bottom-[15%] w-[250px] h-[150px] opacity-[0.06]" viewBox="0 0 250 150">
          <motion.path
            d="M 10 130 Q 50 120, 80 100 T 150 70 T 200 40 T 240 20"
            fill="none"
            stroke="#0d9488"
            strokeWidth="3"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 3, ease: 'easeInOut', repeat: Infinity, repeatDelay: 2 }}
          />
          <motion.circle
            r="6"
            fill="#10b981"
            initial={{ opacity: 0 }}
            animate={{
              opacity: [0, 1, 1, 0],
              cx: [10, 80, 150, 240],
              cy: [130, 100, 70, 20],
            }}
            transition={{ duration: 3, ease: 'easeInOut', repeat: Infinity, repeatDelay: 2 }}
          />
        </svg>

        {/* Floating percentage numbers */}
        {[
          { value: '+8.2%', x: '15%', y: '35%', delay: 0 },
          { value: '+12%', x: '75%', y: '25%', delay: 2 },
          { value: '+5.7%', x: '85%', y: '70%', delay: 4 },
        ].map((item, i) => (
          <motion.div
            key={i}
            className="absolute text-teal-500/10 text-2xl font-bold"
            style={{ left: item.x, top: item.y }}
            animate={{
              y: [0, -15, 0],
              opacity: [0.05, 0.12, 0.05],
            }}
            transition={{
              duration: 6,
              delay: item.delay,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          >
            {item.value}
          </motion.div>
        ))}

        {/* Floating building icons */}
        {[
          { x: '8%', y: '60%', delay: 1, size: 40 },
          { x: '70%', y: '80%', delay: 3, size: 32 },
        ].map((item, i) => (
          <motion.div
            key={i}
            className="absolute text-teal-500/[0.06]"
            style={{ left: item.x, top: item.y }}
            animate={{
              y: [0, -10, 0],
              rotate: [0, 5, 0],
            }}
            transition={{
              duration: 8,
              delay: item.delay,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          >
            <Building2 size={item.size} />
          </motion.div>
        ))}
      </div>

      {/* Main content - Centered layout */}
      <div className="flex-1 flex items-center justify-center relative z-10 p-6 sm:p-8">
        <div className="w-full max-w-5xl flex flex-col lg:flex-row items-center gap-12 lg:gap-16">

          {/* Left side - Info */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6 }}
            className="hidden lg:block flex-1 max-w-md"
          >
            {/* Logo */}
            <Link to="/" className="flex items-center space-x-3 rtl:space-x-reverse mb-8">
              <motion.div
                className="bg-gradient-to-br from-teal-500 to-emerald-600 p-2.5 rounded-xl shadow-lg shadow-teal-500/20"
                whileHover={{ scale: 1.05 }}
              >
                <Building2 className="h-6 w-6 text-white" />
              </motion.div>
              <div>
                <span className="text-xl font-bold text-slate-800">Pinzos</span>
                <p className="text-slate-500 text-xs">{t('common:tagline', 'Dubai Property Investment')}</p>
              </div>
            </Link>

            {/* Main heading */}
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="mb-8"
            >
              <h1 className="text-3xl font-bold text-slate-800 mb-3 leading-tight">
                {t('auth:welcomeTitle', 'Smart Property Investment')}
              </h1>
              <p className="text-slate-500 leading-relaxed">
                {t('auth:welcomeSubtitle', 'Access premium off-plan opportunities in Dubai\'s most promising locations')}
              </p>
            </motion.div>

            {/* Features */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="space-y-4 mb-8"
            >
              {investmentFeatures.map((feature, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, x: -15 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.5 + index * 0.1 }}
                  className="flex items-center space-x-3 rtl:space-x-reverse"
                >
                  <div className="flex-shrink-0 w-9 h-9 bg-teal-50 border border-teal-100 rounded-lg flex items-center justify-center">
                    <feature.icon className="h-4 w-4 text-teal-600" />
                  </div>
                  <span className="text-slate-600">{feature.text}</span>
                </motion.div>
              ))}
            </motion.div>

            {/* Stats with animated chart */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.7 }}
              className="bg-white/60 backdrop-blur-sm rounded-xl p-4 border border-slate-100"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-xs font-medium text-slate-500">Market Overview</span>
                </div>
                <div className="flex items-center gap-1 text-emerald-600 text-sm font-semibold">
                  <ArrowUpRight className="w-4 h-4 rtl:-scale-x-100" />
                  <span>+12.5%</span>
                </div>
              </div>

              <div className="flex items-end gap-1 h-12 mb-3">
                {[35, 52, 45, 68, 55, 72, 85, 78, 92, 88, 95].map((height, i) => (
                  <motion.div
                    key={i}
                    className="flex-1 bg-gradient-to-t from-teal-500 to-emerald-400 rounded-t-sm"
                    initial={{ height: 0 }}
                    animate={{ height: `${height}%` }}
                    transition={{ delay: 0.9 + i * 0.05, duration: 0.4, ease: 'easeOut' }}
                  />
                ))}
              </div>

              <div className="flex items-center justify-between text-sm">
                <div>
                  <span className="font-bold text-slate-800">8-12%</span>
                  <span className="text-slate-400 ms-1">avg. ROI</span>
                </div>
                <div>
                  <span className="font-bold text-slate-800">150+</span>
                  <span className="text-slate-400 ms-1">projects</span>
                </div>
              </div>
            </motion.div>
          </motion.div>

          {/* Right side - Login Card (slightly more prominent) */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="w-full max-w-[420px] lg:flex-1 lg:max-w-md"
          >
            <div className="bg-white rounded-2xl p-8 shadow-2xl shadow-slate-200/70 border border-slate-100/80 relative overflow-hidden">
              {/* Subtle corner decoration */}
              <div className="absolute -top-10 -end-10 w-32 h-32 bg-gradient-to-bl from-teal-50 to-transparent rounded-full" />

              {/* Mobile Logo */}
              <Link to="/" className="flex lg:hidden items-center space-x-3 rtl:space-x-reverse mb-6 relative z-10">
                <motion.div className="bg-gradient-to-br from-teal-500 to-emerald-600 p-2.5 rounded-xl">
                  <Building2 className="h-6 w-6 text-white" />
                </motion.div>
                <span className="text-xl font-bold text-slate-900">Pinzos</span>
              </Link>

              {/* Back Button */}
              <Link
                to="/"
                className="inline-flex items-center text-slate-400 hover:text-teal-600 mb-6 transition-colors text-sm relative z-10"
              >
                <ArrowLeft className="h-4 w-4 me-2 rtl:-scale-x-100" />
                {t('auth:backToHome', 'Back to home')}
              </Link>

              {step === 'success' ? (
                <motion.div
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="text-center py-8 relative z-10"
                >
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.2, type: 'spring' }}
                    className="w-20 h-20 bg-emerald-50 border border-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6"
                  >
                    <CheckCircle className="h-10 w-10 text-emerald-600" />
                  </motion.div>
                  <h2 className="text-2xl font-bold text-slate-900 mb-2">
                    {t('auth:loginSuccess', 'Welcome back!')}
                  </h2>
                  <p className="text-slate-500">
                    {t('auth:redirecting', 'Redirecting you...')}
                  </p>
                </motion.div>
              ) : (
                <div className="relative z-10">
                  <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-2">
                    {step === 'email' ? t('auth:signIn', 'Sign in') : t('auth:verifyEmail', 'Verify your email')}
                  </h1>
                  <p className="text-slate-500 mb-6">
                    {step === 'email'
                      ? t('auth:signInSubtitle', 'Enter your email to receive a login code')
                      : t('auth:checkEmail', 'We sent a code to ') + email}
                  </p>

                  {error && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl mb-6 text-sm"
                    >
                      {error}
                    </motion.div>
                  )}

                  {step === 'email' ? (
                    <form onSubmit={handleSendOtp} className="space-y-5">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                          {t('auth:email', 'Email')}
                        </label>
                        <div className="relative">
                          <Mail className="absolute start-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
                          <Input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder={t('auth:emailPlaceholder', 'Enter your email')}
                            className="ps-10 h-12 text-base border-slate-200 focus:border-teal-500 focus:ring-teal-500/20 transition-all bg-slate-50/50"
                            disabled={loading}
                          />
                        </div>
                      </div>

                      <Button
                        type="submit"
                        className="w-full h-12 bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-600 hover:to-emerald-600 text-white font-medium text-base shadow-lg shadow-teal-500/25 hover:shadow-teal-500/35 transition-all"
                        disabled={loading || cooldown > 0}
                      >
                        {loading ? (
                          <>
                            <Loader2 className="h-5 w-5 animate-spin me-2" />
                            {t('auth:sendingCode', 'Sending...')}
                          </>
                        ) : cooldown > 0 ? (
                          t('auth:resendIn', 'Resend in {{s}}s', { s: cooldown })
                        ) : (
                          t('auth:sendCode', 'Send login code')
                        )}
                      </Button>

                      {/* 微信 WebView 拦截跳往 Google/Supabase 的 OAuth 跳转,这个按钮在
                          微信里点了必然失败 —— 干脆别给,只说清楚该怎么走。 */}
                      {inWeChat ? (
                        <p className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm leading-relaxed text-amber-800">
                          {t('auth:wechatNoGoogle')}
                        </p>
                      ) : (
                        <>
                          <div className="relative my-6">
                            <div className="absolute inset-0 flex items-center">
                              <div className="w-full border-t border-slate-200" />
                            </div>
                            <div className="relative flex justify-center text-sm">
                              <span className="px-4 bg-white text-slate-400">
                                {t('auth:orContinueWith', 'or continue with')}
                              </span>
                            </div>
                          </div>

                          <Button
                            type="button"
                            variant="outline"
                            className="w-full h-12 border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 font-medium text-base transition-all"
                            onClick={handleGoogleLogin}
                            disabled={loading}
                          >
                            <svg className="h-5 w-5 me-3" viewBox="0 0 24 24">
                              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                            </svg>
                            {t('auth:continueWithGoogle', 'Continue with Google')}
                          </Button>
                        </>
                      )}

                      {/* Legal consent — Google OAuth verification expects these links near sign-in */}
                      <p className="text-center text-xs leading-relaxed text-slate-400">
                        {t('auth:legalPrefix', 'By signing in, you agree to our')}{' '}
                        <Link to="/terms" className="text-teal-600 hover:underline">{t('auth:terms', 'Terms of Service')}</Link>
                        {' '}{t('auth:legalAnd', 'and')}{' '}
                        <Link to="/privacy" className="text-teal-600 hover:underline">{t('auth:privacy', 'Privacy Policy')}</Link>
                      </p>
                    </form>
                  ) : (
                    <form onSubmit={handleVerifyOtp} className="space-y-5">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                          {t('auth:verificationCode', 'Verification code')}
                        </label>
                        <Input
                          type="text"
                          value={otpCode}
                          onChange={(e) => setOtpCode(e.target.value)}
                          placeholder={t('auth:codePlaceholder', 'Enter 6-digit code')}
                          className="h-12 text-center text-2xl tracking-widest font-mono border-slate-200 bg-slate-50/50 focus:border-teal-500 focus:ring-teal-500/20"
                          maxLength={6}
                          disabled={loading}
                          autoFocus
                        />
                      </div>

                      <Button
                        type="submit"
                        className="w-full h-12 bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-600 hover:to-emerald-600 text-white font-medium text-base shadow-lg shadow-teal-500/25"
                        disabled={loading}
                      >
                        {loading ? (
                          <>
                            <Loader2 className="h-5 w-5 animate-spin me-2" />
                            {t('auth:verifying', 'Verifying...')}
                          </>
                        ) : (
                          t('auth:verify', 'Verify')
                        )}
                      </Button>

                      <div className="flex items-center justify-center gap-4 text-sm">
                        <button
                          type="button"
                          disabled={loading || cooldown > 0}
                          onClick={() => handleSendOtp()}
                          className="text-teal-600 hover:text-teal-700 transition-colors disabled:text-slate-400 disabled:cursor-not-allowed"
                        >
                          {cooldown > 0
                            ? t('auth:resendIn', 'Resend in {{s}}s', { s: cooldown })
                            : t('auth:resendCode', 'Resend code')}
                        </button>
                        <span className="text-slate-300">·</span>
                        <button
                          type="button"
                          onClick={() => {
                            setStep('email')
                            setOtpCode('')
                            setError('')
                          }}
                          className="text-slate-500 hover:text-teal-600 transition-colors"
                        >
                          {t('auth:useAnotherEmail', 'Use a different email')}
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  )
}
