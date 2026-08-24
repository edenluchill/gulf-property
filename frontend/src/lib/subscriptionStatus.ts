/**
 * 订阅状态的**单一真源**（前端）—— 后端同名文件 `backend/src/lib/subscriptionStatus.ts`。
 *
 * 🔴 **`past_due` 算「还有权益」。** 那是卡扣失败但 Stripe 仍在重试（约 2 周）的状态，
 * 处在里面的人是**正在试图付钱的客户**，不是没订阅的人。
 *
 * 2026-07 的真实损失：全站唯一真扣过款的外部客户扣款失败后，前后端十几处
 * `['active','trialing'].includes(status)` 同时把她判成免费用户 —— 地图锁死、
 * 定价页给她看「7 天免费试用」而不是「更新支付方式」。她再没买过。
 *
 * ⚠️ **别再手打状态数组。** 新增任何订阅判断从这里 import。
 */

/** 仍享有套餐权益的状态。 */
export const ENTITLED_STATUSES = ['active', 'trialing', 'past_due'] as const

/** 该状态是否仍享有权益（能用付费功能、显示付费徽章、走付费入口）。 */
export function isEntitled(status: string | null | undefined): boolean {
  return !!status && (ENTITLED_STATUSES as readonly string[]).includes(status)
}

/**
 * 钱出了问题、但还没断权益 —— UI 必须显示「更新支付方式」，
 * **绝不能显示「选套餐」或「免费试用」**（那等于告诉一个已经在付钱的人他不是客户）。
 */
export function needsPaymentFix(status: string | null | undefined): boolean {
  return status === 'past_due'
}
