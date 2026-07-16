/**
 * AppErrorBoundary — 全局渲染崩溃兜底。
 *
 * 2026-07-03 教训:一个数据函数把 429 错误对象当数组返回,下游 .map 抛错,
 * 没有任何 boundary → 整站白屏,用户以为"网站永久坏了"。这里兜住:友好卡片 +
 * 一键刷新,并把崩溃上报进错误监控(app_events api_error),owner 后台能看到。
 */
import { Component, type ReactNode } from 'react'
import { trackEvent } from '../lib/track'
import i18n from '../i18n'

interface State { crashed: boolean }

export default class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { crashed: false }

  static getDerivedStateFromError(): State {
    return { crashed: true }
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    try {
      trackEvent('api_error', {
        kind: 'render_crash',
        message: String(error?.message || error).slice(0, 300),
        stack: String(info?.componentStack || '').slice(0, 500),
        path: window.location.pathname,
      }, { immediate: true })
    } catch { /* 上报失败无所谓 */ }
  }

  render() {
    if (!this.state.crashed) return this.props.children
    const t = (i18n.getFixedT as (l: string, ns: string) => (k: string) => string)(i18n.language, 'gate')
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', padding: 16 }}>
        <div style={{ maxWidth: 380, textAlign: 'center', background: '#fff', borderRadius: 16, padding: 32, boxShadow: '0 10px 40px -12px rgba(15,23,42,0.15)' }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>🛠️</div>
          <h2 style={{ margin: 0, fontSize: 18, color: '#0f172a' }}>{t('gate:somethingWentWrong')}</h2>
          <p style={{ marginTop: 8, fontSize: 14, color: '#64748b', lineHeight: 1.6 }}>
            {t('gate:aQuickRefreshWill')}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{ marginTop: 16, width: '100%', height: 44, borderRadius: 12, border: 'none', background: '#0d9488', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
          >
            {t('gate:reload')}
          </button>
        </div>
      </div>
    )
  }
}
