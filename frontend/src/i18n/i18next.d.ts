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
import authEn from './locales/en/auth.json'
import transactionsEn from './locales/en/transactions.json'
import reportEn from './locales/en/report.json'
import insightsEn from './locales/en/insights.json'
import agentEn from './locales/en/agent.json'
import navEn from './locales/en/nav.json'
import editorEn from './locales/en/editor.json'
import componentsEn from './locales/en/components.json'
import compareEn from './locales/en/compare.json'

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
      auth: typeof authEn
      transactions: typeof transactionsEn
      report: typeof reportEn
      insights: typeof insightsEn
      agent: typeof agentEn
      nav: typeof navEn
      editor: typeof editorEn
      components: typeof componentsEn
      compare: typeof compareEn
    }
  }
}
