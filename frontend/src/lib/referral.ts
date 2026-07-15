/**
 * 推荐码的本地归因 (2026-07-14) — docs/referral-program-spec.md
 *
 * cookie 阶段(60 天,last-click 覆盖)活在这里:落地 /i/:code 时 rememberCode(),
 * 登录成功那一刻 attachStoredCode() 把它回传后端钉死。之后由账号接管,本地这份
 * 就可以清掉了 —— 换设备、清缓存、隔月付费都不影响归属(后端 UNIQUE 永久锁定)。
 */
import { attachReferral } from './referralApi'
import { trackEvent } from './track'

const KEY = 'pz-ref'
const WINDOW_DAYS = 60

interface Stored {
  code: string
  ts: number // 存入时间(ms);超过 60 天视为过期
}

/** 落地 /i/:code:记住码(last-click 直接覆盖旧值)+ 埋点点击量。 */
export function rememberCode(code: string): void {
  const c = String(code || '').trim().toLowerCase()
  if (!c) return
  try {
    localStorage.setItem(KEY, JSON.stringify({ code: c, ts: Date.now() } as Stored))
  } catch {
    /* localStorage 不可用(隐私模式)→ 放弃归因,不影响落地跳转 */
  }
  // 点击量走 app_events(推广面板漏斗第一环)。immediate:落地页可能马上跳走。
  trackEvent('referral_click', { code: c }, { immediate: true })
}

/** 读未过期的码;过期自动清掉。 */
function readCode(): string | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as Stored
    if (!s?.code || !s?.ts) return null
    if (Date.now() - s.ts > WINDOW_DAYS * 86400_000) {
      localStorage.removeItem(KEY)
      return null
    }
    return s.code
  } catch {
    return null
  }
}

function clearCode(): void {
  try { localStorage.removeItem(KEY) } catch { /* noop */ }
}

/**
 * 登录成功后调:若本地有未过期的推荐码,回传后端 attach。
 * 幂等且失败静默 —— attach 由后端做全部校验(自荐/老用户/已归因都返回「已处理」)。
 * 无论结果如何都清掉本地码:attach 成功 = 已永久锁定,不需要再试;
 * 被拒(自荐/老用户)= 这个码对我无效,留着也没用。
 */
export async function attachStoredCode(): Promise<void> {
  const code = readCode()
  if (!code) return
  try {
    await attachReferral(code)
  } finally {
    clearCode()
  }
}
