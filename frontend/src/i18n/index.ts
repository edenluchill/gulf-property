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
import findhomeEn from './locales/en/findhome.json'

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
import findhomeZh from './locales/zh-CN/findhome.json'

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
    findhome: findhomeEn,
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
    findhome: findhomeZh,
  },
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
    ns: ['common', 'home', 'map', 'filter', 'project', 'favorites', 'developer', 'admin', 'upload', 'auth', 'transactions', 'report', 'insights', 'agent', 'nav', 'editor', 'components', 'findhome'],
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'pinzos-lang',
      caches: ['localStorage'],
    },
  })

export default i18n
