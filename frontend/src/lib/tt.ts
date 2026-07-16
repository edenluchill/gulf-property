/**
 * tt() —— 内联多语言桥接 helper（见 docs/i18n-multilang-framework-spec.md §2.2）。
 *
 * 迁移目标:把 542 处 `zh ? '中' : '英'` 双语三元换成 `tt({ zh:'中', en:'英' })`,
 * 天然支持 5 语言(en/zh/ar/ru/fr),AI 可批量补齐缺的语言。en 永远兜底。
 *
 * 用法(必须在组件内或渲染路径上——依赖 useTranslation 订阅语言变化触发重渲染):
 *   const { t } = useTranslation()   // 订阅语言变化
 *   tt({ zh: '本项目', en: 'This project' })
 *
 * codemod: `cond ? 'A' : 'B'`(含 zh 判定) → `tt({ zh:'A', en:'B' })`。
 */
import i18n from '../i18n'

export type LangCode = 'en' | 'zh' | 'ar' | 'ru' | 'fr'
export type Multi = Partial<Record<LangCode, string>>

/** 把 i18next 的 language(可能是 zh-CN / en-US / ar-AE) 归一到 ISO 语言码。 */
export function normLang(lng?: string | null): LangCode {
  const l = (lng || i18n.language || 'en').toLowerCase()
  if (l.startsWith('zh')) return 'zh'
  const two = l.slice(0, 2)
  return (['en', 'ar', 'ru', 'fr'] as string[]).includes(two) ? (two as LangCode) : 'en'
}

/** 按当前语言取串;缺当前语言 → en → zh → 任意第一个 → ''。 */
export function tt(m: Multi, lng?: string): string {
  const code = normLang(lng)
  return m[code] ?? m.en ?? m.zh ?? Object.values(m).find(Boolean) ?? ''
}

/** 阿拉伯语=RTL,其余 LTR。用于 <html dir> 与逻辑布局判断。 */
export function isRTL(lng?: string | null): boolean {
  return normLang(lng) === 'ar'
}

/**
 * 这个**地名专名**能不能拿去给这个语言的用户看?
 * (后端 lib/lang.ts 的 placeNameUsable 的镜像 —— 两边判据必须一致。)
 *
 * dubai_pois 的 name 混着中文/拉丁/**阿拉伯原名**。不挡的话,一份中文报告的「周边」
 * 会赫然写着「دبي مول / برج خليفة · 3.6km」,客户一个字看不懂。
 *
 * 后端在**生成时**已经挡了一道,但 DB 里的存量报告是在那之前生成的、名字已烤进
 * jsonb —— 所以渲染时还得挡一道,老链接才救得回来。
 *
 * 名字不可读 → 调用方应退回「品类 + 距离」(仍然是真的,只是不荒谬)。
 */
export function placeNameUsable(name: string | null | undefined, lng?: string | null): boolean {
  const n = (name || '').trim()
  if (!n) return false
  const lang = normLang(lng)
  if (/[؀-ۿ]/.test(n)) return lang === 'ar'      // 阿拉伯字母:只有阿语用户能读
  if (lang === 'zh') return /[一-龥a-zA-Z]/.test(n) // 中文用户:中文名或拉丁名都行
  return /[a-zA-Z]/.test(n)                                  // 其余:要有拉丁字母
}
