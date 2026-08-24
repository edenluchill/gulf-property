/**
 * 订阅状态的**单一真源** —— 「谁还享有套餐权益」由这里定义。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 **`past_due` 必须算作「还有权益」。** 这是本文件存在的全部理由。
 *
 * `past_due` = 卡扣失败，但 **Stripe 还在按 dunning 计划重试**（默认约 2 周，
 * 重试完才会转 `unpaid` / `canceled`）。**处在这个状态的人是「正在试图付钱的客户」**，
 * 不是「没订阅的人」。
 *
 * 2026-07 的真实损失（全站唯一一个真扣过款的外部客户，RichKey 的 Yaroslava）：
 * 她 7/28 扣款失败 → 全站十几处 `status IN ('active','trialing')` 同时把她判成
 * 「从没订阅过」→ **地图当场锁死**，前端还提示她「去选套餐」（`requiresPlan: true`）。
 * 她之后反复看定价页十几次，再没买过。**我们亲手把唯一的付费客户锁在门外。**
 *
 * ⚠️ 这个坑记忆条 `subscription-past-due-hidden` 记过一次，之后**又散点复发了 11 处** ——
 * 所以这次收口成一个常量。**新写任何订阅判断，从这里 import，不要再手打状态数组。**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 不包含的两个，都是有意的：
 *   · `unpaid`     —— Stripe 已经重试完并放弃了。到这一步才该真正断权益。
 *   · `incomplete` —— 首次付款从没成功过（3DS 没做完等），压根没成为过客户。
 */

/** 仍享有套餐权益的状态。用于**授权判断**（能不能用地图/积分/上传/席位）。 */
export const ENTITLED_STATUSES = ['active', 'trialing', 'past_due'] as const
export type EntitledStatus = (typeof ENTITLED_STATUSES)[number]

/**
 * 直接拼进 SQL 的字面量，形如 `('active','trialing','past_due')`。
 *
 * 用法：`WHERE status IN ${ENTITLED_SQL}`
 * 安全性：纯代码内常量，**不含任何用户输入**，不存在注入面。
 * （用参数化 `= ANY($n)` 也可以，但那样每个查询的参数序号都要跟着改，更容易出错。）
 */
export const ENTITLED_SQL = `(${ENTITLED_STATUSES.map((s) => `'${s}'`).join(',')})`

/** 钱出了问题、但还没到断权益的状态 —— UI 上必须显示「去换卡」而不是「去选套餐」。 */
export const NEEDS_PAYMENT_FIX: readonly string[] = ['past_due']

/** 该状态是否仍享有权益。 */
export function isEntitled(status: string | null | undefined): boolean {
  return !!status && (ENTITLED_STATUSES as readonly string[]).includes(status)
}
