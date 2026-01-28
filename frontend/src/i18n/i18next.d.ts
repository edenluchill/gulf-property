import 'i18next'

import commonEn from './locales/en/common.json'
import homeEn from './locales/en/home.json'
import mapEn from './locales/en/map.json'
import filterEn from './locales/en/filter.json'
import projectEn from './locales/en/project.json'
import favoritesEn from './locales/en/favorites.json'
import developerEn from './locales/en/developer.json'
import adminEn from './locales/en/admin.json'
import uploadEn from './locales/en/upload.json'

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common'
    resources: {
      common: typeof commonEn
      home: typeof homeEn
      map: typeof mapEn
      filter: typeof filterEn
      project: typeof projectEn
      favorites: typeof favoritesEn
      developer: typeof developerEn
      admin: typeof adminEn
      upload: typeof uploadEn
    }
  }
}
