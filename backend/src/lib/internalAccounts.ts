/**
 * 内部账号名单 —— **单一真源**。
 *
 * 起因(2026-08-09):派单功能自己拼了一份 4 个人的名单,漏了 `edenlu1995@gmail.com`
 * (owner 的另一个账号)和 `realtorgptapp@gmail.com`,结果 owner 的小号真的出现在
 * 「给买家挑的候选」里。而正式名单一直存在,只是散在三处:
 *   · analyticsQueries.ts  OWNER_EMAILS + ANALYTICS_INTERNAL_EMAILS(env,可覆盖)
 *   · healthQueries.ts     INTERNAL_AGENTS(硬编码 6 个)
 *   · routes/agent-match   我又拼了第三份 ← 就是这次的 bug
 *
 * 🔴 **往这里加人 = 让某个「客户」从统计里消失,必须 owner 确认过才能加。**
 *    2026-07-18 就因为把自己人误当外部客户,得出过「真实外部用户建过 tour = 1 人」
 *    的错误结论(实际是 0)。
 */

/** owner 名下的账号 + 内置 demo。**任何面向客户的地方都要排除**。 */
const OWNER_ACCOUNTS = [
  'lzp6529@gmail.com',      // owner
  'edenlu1995@gmail.com',   // owner 另一个账号
  'admin@yesir.ai',         // owner 另一个账号
  'realtorgptapp@gmail.com', // owner 另一个账号
  'demo-agent@luna.tour',   // 内置 demo 账号(手机号是 +971500000000,派出去打不通)
]

/** 合伙人 SHUAI WANG(乙方,见 docs/signed/ 的合伙协议)。 */
export const PARTNER_EMAIL = 'shelldubai26@gmail.com'

/**
 * **统计口径**的内部账号 —— owner 的号 + 合伙人。
 * dashboard/健康度这类"有多少真实外部客户"的问题,合伙人也算自己人。
 */
export const INTERNAL_EMAILS = [...OWNER_ACCOUNTS, PARTNER_EMAIL]
  .map((s) => s.trim().toLowerCase())

/**
 * **派单池**排除的账号 —— 只排 owner 的号和 demo,**合伙人留在池子里**。
 *
 * owner 2026-08-09:「除了 shell 的账户之外,其他内部假测试账户都不要进入排班」。
 * 理由说得通:合伙人是迪拜本地一个**真能接待买家**的人,不是测试号;
 * 而 owner 的小号和 demo 派出去,买家那头等于石沉大海。
 *
 * ⚠️ 这份和 INTERNAL_EMAILS **有意不同**。别看着像重复就合并 ——
 *    合并的结果要么是合伙人接不到买家,要么是 owner 的小号混进候选名单。
 */
export const DISPATCH_EXCLUDED_EMAILS = OWNER_ACCOUNTS
  .map((s) => s.trim().toLowerCase())
