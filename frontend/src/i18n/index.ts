import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import commonEn from './locales/en/common.json'
import homeEn from './locales/en/home.json'
import mapEn from './locales/en/map.json'
import filterEn from './locales/en/filter.json'
import projectEn from './locales/en/project.json'
import favoritesEn from './locales/en/favorites.json'
import developerEn from './locales/en/developer.json'
import adminEn from './locales/en/admin.json'
import uploadEn from './locales/en/upload.json'
import authEn from './locales/en/auth.json'
import transactionsEn from './locales/en/transactions.json'
import reportEn from './locales/en/report.json'
import insightsEn from './locales/en/insights.json'
import agentEn from './locales/en/agent.json'
import navEn from './locales/en/nav.json'
import editorEn from './locales/en/editor.json'
import componentsEn from './locales/en/components.json'

import commonZh from './locales/zh-CN/common.json'
import homeZh from './locales/zh-CN/home.json'
import mapZh from './locales/zh-CN/map.json'
import filterZh from './locales/zh-CN/filter.json'
import projectZh from './locales/zh-CN/project.json'
import favoritesZh from './locales/zh-CN/favorites.json'
import developerZh from './locales/zh-CN/developer.json'
import adminZh from './locales/zh-CN/admin.json'
import uploadZh from './locales/zh-CN/upload.json'
import authZh from './locales/zh-CN/auth.json'
import transactionsZh from './locales/zh-CN/transactions.json'
import reportZh from './locales/zh-CN/report.json'
import insightsZh from './locales/zh-CN/insights.json'
import agentZh from './locales/zh-CN/agent.json'
import navZh from './locales/zh-CN/nav.json'
import editorZh from './locales/zh-CN/editor.json'
import componentsZh from './locales/zh-CN/components.json'

// compare 命名空间 —— 多语言 framework pilot,5 语言全 JSON(ar/ru/fr 只随翻译进度补 ns,
// 其余 ns 缺失自动回退 en)。新语言的其它 ns 在 P1 逐步加。
import compareEn from './locales/en/compare.json'
import compareZh from './locales/zh-CN/compare.json'
import compareAr from './locales/ar/compare.json'
import compareRu from './locales/ru/compare.json'
import compareFr from './locales/fr/compare.json'
import investEn from './locales/en/invest.json'
import investZh from './locales/zh-CN/invest.json'
import investAr from './locales/ar/invest.json'
import investRu from './locales/ru/invest.json'
import investFr from './locales/fr/invest.json'

const resources = {
  en: {
    common: commonEn,
    home: homeEn,
    map: mapEn,
    filter: filterEn,
    project: projectEn,
    favorites: favoritesEn,
    developer: developerEn,
    admin: adminEn,
    upload: uploadEn,
    auth: authEn,
    transactions: transactionsEn,
    report: reportEn,
    insights: insightsEn,
    agent: agentEn,
    nav: navEn,
    editor: editorEn,
    components: componentsEn,
    compare: compareEn,
    invest: investEn,
  },
  'zh-CN': {
    common: commonZh,
    home: homeZh,
    map: mapZh,
    filter: filterZh,
    project: projectZh,
    favorites: favoritesZh,
    developer: developerZh,
    admin: adminZh,
    upload: uploadZh,
    auth: authZh,
    transactions: transactionsZh,
    report: reportZh,
    insights: insightsZh,
    agent: agentZh,
    nav: navZh,
    editor: editorZh,
    components: componentsZh,
    compare: compareZh,
    invest: investZh,
  },
  // 新语言:目前只有 compare ns(pilot),其余 ns 缺失 → fallbackLng 回退 en。P1 逐步补齐。
  ar: { compare: compareAr, invest: investAr },
  ru: { compare: compareRu, invest: investRu },
  fr: { compare: compareFr, invest: investFr },
}

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
    ns: ['common', 'home', 'map', 'filter', 'project', 'favorites', 'developer', 'admin', 'upload', 'auth', 'transactions', 'report', 'insights', 'agent', 'nav', 'editor', 'components', 'compare', 'invest'],
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
