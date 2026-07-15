import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 验证码发送冷却秒数。**必须和 Supabase Auth → SMTP → "Minimum interval per user" 一致**,
 * 否则会出现「按钮亮了但服务端还拒」。2026-07-15 owner 把 Supabase 侧改成 30s。
 */
export const OTP_COOLDOWN_SECONDS = 30

/**
 * 「发送验证码」按钮的本地冷却倒计时。start(seconds) 开始倒数,remaining>0 时按钮应禁用。
 *
 * WHY:Supabase 对同一邮箱有 ~60s 的验证码发送间隔 + 每小时总量限流。用户看不到邮件
 * 就狂点「发送」→ 直接触顶 `email rate limit exceeded`,把自己锁在登录第一步。
 * 从源头掐掉狂点,是治标里最有效的一环(治本是给 Supabase 接自建 SMTP)。
 */
export function useSendCooldown() {
  const [remaining, setRemaining] = useState(0)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const stop = useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current)
      timer.current = null
    }
  }, [])

  const start = useCallback((seconds: number) => {
    stop()
    setRemaining(seconds)
    timer.current = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          stop()
          return 0
        }
        return r - 1
      })
    }, 1000)
  }, [stop])

  useEffect(() => stop, [stop]) // 卸载时清定时器
  return { remaining, start }
}
