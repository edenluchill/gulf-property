/**
 * getLang(req) —— 后端语言解析单一入口（见 docs/i18n-multilang-framework-spec.md §2.1）。
 *
 * 目标:把 D 层(~942 条后端中文串) 和 E 层(AI 生成内容) 的语言从"写死中文"改成
 * "按请求注入"。所有需要产出面向用户文案 / 调 AI 的端点,都从这里取语言,别再写死。
 *
 * 解析顺序:?lang= 显式参数 → Accept-Language 头 → 回退 en。白名单外一律 en。
 */
import type { Request } from 'express'

export type LangCode = 'en' | 'zh' | 'ar' | 'ru' | 'fr'
export const SUPPORTED_LANGS: LangCode[] = ['en', 'zh', 'ar', 'ru', 'fr']

/** 归一任意 locale 串到 ISO 语言码(白名单外 → null)。 */
function norm(raw?: string | null): LangCode | null {
  if (!raw) return null
  const l = raw.trim().toLowerCase()
  if (l.startsWith('zh')) return 'zh'
  const two = l.slice(0, 2)
  return (SUPPORTED_LANGS as string[]).includes(two) ? (two as LangCode) : null
}

/** 从 Accept-Language 头挑第一个受支持的语言(忽略 q 权重的粗解析,够用)。 */
function fromAcceptLanguage(header?: string): LangCode | null {
  if (!header) return null
  for (const part of header.split(',')) {
    const code = norm(part.split(';')[0])
    if (code) return code
  }
  return null
}

/** 解析请求语言:?lang= → Accept-Language → 'en'。 */
export function getLang(req: Request): LangCode {
  const q = norm((req.query?.lang as string) || undefined)
  if (q) return q
  const h = fromAcceptLanguage(req.headers['accept-language'] as string | undefined)
  return h ?? 'en'
}
