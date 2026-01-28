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

import commonZh from './locales/zh-CN/common.json'
import homeZh from './locales/zh-CN/home.json'
import mapZh from './locales/zh-CN/map.json'
import filterZh from './locales/zh-CN/filter.json'
import projectZh from './locales/zh-CN/project.json'
import favoritesZh from './locales/zh-CN/favorites.json'
import developerZh from './locales/zh-CN/developer.json'
import adminZh from './locales/zh-CN/admin.json'
import uploadZh from './locales/zh-CN/upload.json'

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
  },
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    defaultNS: 'common',
    ns: ['common', 'home', 'map', 'filter', 'project', 'favorites', 'developer', 'admin', 'upload'],
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'gulf-property-lang',
      caches: ['localStorage'],
    },
  })

export default i18n
