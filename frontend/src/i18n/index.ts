import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

// 自动加载所有 locale JSON —— 放一个 locales/<lang>/<ns>.json 文件即生效,零配置改动。
// (工业化 i18n framework:配合 backend/scripts/i18n-translate.ts 批翻,加语言=跑脚本。)
// 缺的 <lang>/<ns> 由 fallbackLng 回退 en。
const files = import.meta.glob('./locales/*/*.json', { eager: true }) as Record<string, { default: Record<string, unknown> }>
const resources: Record<string, Record<string, Record<string, unknown>>> = {}
const nsSet = new Set<string>()
for (const p in files) {
  const m = p.match(/\.\/locales\/([^/]+)\/([^/]+)\.json$/)
  if (!m) continue
  const [, lng, ns] = m
  ;(resources[lng] ||= {})[ns] = files[p].default
  nsSet.add(ns)
}
const allNs = [...nsSet]

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    // Our resources are keyed 'en' and 'zh-CN'. Browsers / older cached prefs can
    // report bare 'zh' (or zh-Hans/zh-TW). Without this mapping those resolve to
    // 'en' for every t() key while `startsWith('zh')` checks still go Chinese —
    // producing the "labels English but content Chinese" mix. Map all zh variants
    // to the zh-CN bundle first, then en.
    fallbackLng: {
      zh: ['zh-CN', 'en'],
      'zh-Hans': ['zh-CN', 'en'],
      'zh-Hans-CN': ['zh-CN', 'en'],
      'zh-TW': ['zh-CN', 'en'],
      'zh-HK': ['zh-CN', 'en'],
      'zh-Hant': ['zh-CN', 'en'],
      default: ['en'],
    },
    nonExplicitSupportedLngs: true,
    defaultNS: 'common',
    ns: allNs,
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'pinzos-lang',
      caches: ['localStorage'],
    },
  })

// <html lang/dir> 随语言动态(阿拉伯语=RTL)。装一次,首屏 + 每次切换都生效。
// 内联归一(不 import lib/tt 防循环依赖)。
function applyHtmlLangDir(lng?: string) {
  if (typeof document === 'undefined') return
  const l = (lng || 'en').toLowerCase()
  const code = l.startsWith('zh') ? 'zh' : (['ar', 'ru', 'fr'].includes(l.slice(0, 2)) ? l.slice(0, 2) : 'en')
  document.documentElement.lang = code
  document.documentElement.dir = code === 'ar' ? 'rtl' : 'ltr'
}
i18n.on('languageChanged', applyHtmlLangDir)
applyHtmlLangDir(i18n.language)

export default i18n
