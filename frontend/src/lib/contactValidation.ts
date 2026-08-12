/**
 * 买家留下的联系方式 —— 校验 + 归一化。
 *
 * owner 2026-08-11:「客户输入联系方式应该选然后要验证,不能随便现在什么垃圾都可以」。
 * 之前是一个纯文本框,写「asdf」也照收 —— 经纪拿到一条打不通的 lead,
 * 比没有 lead 更伤(他会觉得这个来源是垃圾)。
 *
 * 🔴 **后端有一份一模一样的规则**(backend/src/lib/contactValidation.ts)。
 *    只在前端校验等于没校验:直接打接口就能塞任何东西进去。
 *    改这里必须同步改那边,两边都有测试用例注释。
 *
 * 🔴 **电话/WhatsApp 一律要求国家区号**。迪拜的盘,买家来自中国/俄罗斯/海湾各地,
 *    看到「0501234567」我们没法知道是哪国的 —— 猜一个 +971 上去,经纪就永远打不通。
 *    宁可让他多打三个字符。
 */
export type ContactType = 'whatsapp' | 'phone' | 'email'

/**
 * **这个数组的顺序就是界面上三颗按钮的顺序**(owner 2026-08-11:
 * 「第一个是手机,第二个是邮箱,然后才是 WhatsApp」),第一个同时也是默认选中的。
 * 改顺序前先问 —— 这是他定的,不是随便排的。
 */
export const CONTACT_TYPES: ContactType[] = ['phone', 'email', 'whatsapp']

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/

/** 去掉空格/横杠/括号这些人肉分隔符;邮箱只做 trim + 小写 */
export function normalizeContact(type: ContactType, raw: string): string {
  const v = (raw || '').trim()
  if (type === 'email') return v.toLowerCase()
  const digits = v.replace(/[\s\-().]/g, '')
  return digits.startsWith('+') ? digits : digits ? `+${digits}` : ''
}

/**
 * 合法吗?返回 null = 合法,否则返回错误原因的 i18n key 后缀。
 *
 * 号码判据:
 *   · 归一化后必须是 `+` 开头、首位非 0、总共 8–15 位数字(E.164 上限 15);
 *   · **不同数字至少 3 种** —— 挡掉 +11111111 / +12121212 这类随手乱敲。
 */
export function contactError(type: ContactType, raw: string): 'email' | 'phone' | null {
  const v = normalizeContact(type, raw)
  if (type === 'email') return EMAIL_RE.test(v) ? null : 'email'
  if (!/^\+[1-9]\d{7,14}$/.test(v)) return 'phone'
  if (new Set(v.slice(1)).size < 3) return 'phone'
  return null
}

export function isContactValid(type: ContactType, raw: string): boolean {
  return contactError(type, raw) === null
}
