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

/** 白名单归一化的公开版(给 body/DB 里来的 lang 值用,不是从 req 解析)。 */
export function normLang(raw?: string | null): LangCode | null {
  return norm(raw)
}

/**
 * 写进 AI prompt 的语言名。**用目标语言自称**(endonym)——
 * 对模型比英文名更硬,不容易被 prompt 主体的语言带跑。
 */
const LANG_ENDONYM: Record<LangCode, string> = {
  en: 'English',
  zh: '简体中文 (Simplified Chinese)',
  ar: 'العربية (Arabic)',
  ru: 'Русский (Russian)',
  fr: 'Français (French)',
}

/**
 * 给 AI 的"用哪种语言写"指令。
 *
 * ⚠️ **别再用「跟随客户输入的语言,自动检测」那套。** 在报告/导览这类场景里,
 * 喂给模型的"客户画像"是**经纪**填的(wizard 选项本身就是中文)——
 * 自动检测检到的是**经纪**的语言,不是客户的。俄罗斯客户拿到中文报告就是这么来的。
 * 语言必须由调用方显式传入。
 */
export function langInstruction(lang: LangCode): string {
  return `**全文用 ${LANG_ENDONYM[lang]} 写。** 这是这份文档的指定语言 —— 与上面提示词本身的语言无关,`
    + `也与输入数据碰巧是什么语言无关。人名、项目名、开发商名保持原文;AED / m² / DLD 等单位与专有名词不译。`
}
