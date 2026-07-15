/**
 * 把 Supabase Auth 的原始英文报错翻成用户看得懂的本地化文案。
 *
 * WHY(2026-07-15):真实经纪在微信里走邮箱验证码登录,撞到 Supabase 的
 * `email rate limit exceeded` —— 一句用户看不懂的英文,而且我们后端零感知。
 * 这里统一收口两个登录组件(LoginPage / LoginDialog)的错误处理,避免两处漂移。
 * 见 docs/reports/2026-07-15-otp-rate-limit-monitoring-gap.md。
 */
import type { AuthError } from '@supabase/supabase-js'

type ErrLike = Pick<AuthError, 'message'> & { status?: number }

/**
 * i18next 的 TFunction 带命名空间「品牌」强类型,只接受已登记的 key。但它有一个
 * **带 defaultValue 的重载**允许任意 string key(现有代码 `t('auth:sendCode','...')`
 * 就是靠这个编译过的)。这里照此签名,两个登录组件的 t 都能直接传进来。
 */
type Translate = (key: string, defaultValue: string, opts?: Record<string, unknown>) => string

/** Supabase 邮件/发送限流 —— 触发它就该进入本地冷却,别再让用户狂点触顶。 */
export function isRateLimitError(error: ErrLike | null): boolean {
  if (!error) return false
  const msg = (error.message || '').toLowerCase()
  return error.status === 429 || msg.includes('rate limit') || msg.includes('too many')
}

/**
 * 认不出的错误回退到原始 message(信息不丢)。t 一律用 'auth:' 前缀 ——
 * i18next 无论默认命名空间是什么都能解析,所以两个登录组件可共用。
 */
export function friendlyAuthError(error: ErrLike | null, t: Translate): string {
  if (!error) return ''
  const msg = (error.message || '').toLowerCase()
  if (isRateLimitError(error)) {
    return t('auth:errRateLimit', 'Too many code requests. Please wait about a minute and try again.')
  }
  if (msg.includes('invalid') && msg.includes('email')) {
    return t('auth:errInvalidEmail', 'That email address looks invalid. Please check and try again.')
  }
  if (msg.includes('not allowed') || msg.includes('disabled') || msg.includes('signups not allowed')) {
    return t('auth:errSignupDisabled', "This email can't sign in right now. Please contact support.")
  }
  return error.message
}
