/**
 * 买家联系方式的校验 —— **和前端 frontend/src/lib/contactValidation.ts 逐字同一套规则**。
 *
 * 为什么后端也要有一份:只在前端校验等于没校验。/reveal 是公开接口,
 * 直接 curl 就能把「asdf」塞进 buyer_contact,经纪拿到一条打不通的 lead。
 *
 * 改任何一边都必须同步另一边。
 */
export type ContactType = 'whatsapp' | 'phone' | 'email'

export const CONTACT_TYPES: ContactType[] = ['whatsapp', 'phone', 'email']

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/

export function normalizeContact(type: ContactType, raw: string): string {
  const v = (raw || '').trim()
  if (type === 'email') return v.toLowerCase()
  const digits = v.replace(/[\s\-().]/g, '')
  return digits.startsWith('+') ? digits : digits ? `+${digits}` : ''
}

/** 合法 → null;否则返回出错的字段类型 */
export function contactError(type: ContactType, raw: string): 'email' | 'phone' | null {
  const v = normalizeContact(type, raw)
  if (type === 'email') return EMAIL_RE.test(v) ? null : 'email'
  if (!/^\+[1-9]\d{7,14}$/.test(v)) return 'phone'
  if (new Set(v.slice(1)).size < 3) return 'phone'   // +11111111 这类随手乱敲
  return null
}

export function isContactType(v: unknown): v is ContactType {
  return typeof v === 'string' && (CONTACT_TYPES as string[]).includes(v)
}
