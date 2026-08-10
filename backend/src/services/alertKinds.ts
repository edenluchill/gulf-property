/**
 * 事故型告警的 kind 名单 —— **单一真源**。
 *
 * 事故(incident)和状态告警(state alert)的关闭语义完全不同,见
 * [[alerts-are-incidents-not-state]]:
 *   • 状态告警(延迟高、连接池满)会自己恢复 → 状态机按 kind 开/关
 *   • 事故(接口 5xx、客户页面崩溃)**已经发生了,不会"恢复"** → 永不自动关闭,
 *     只有人查清根因后手动关
 *
 * 所有"扫一遍活跃状态告警"的查询都必须排除这些 kind。以前这个名单是散在两处的
 * 字面量 `kind <> 'API_5XX'`,加第二种事故(CLIENT_CRASH)时极容易漏掉一处 ——
 * 漏掉的后果是**事故被状态机当成"已恢复"自动关掉**,正是当初要根治的那个病。
 *
 * 零依赖,谁都能 import。
 */
export const INCIDENT_KINDS = ['API_5XX', 'CLIENT_CRASH'] as const
