/**
 * Detect new frontend deploys while the app is open.
 *
 * Why: iOS Safari (iPad especially) restores tabs from a snapshot without
 * reloading — users can sit on a weeks-old bundle even after "refreshing".
 * Cache headers can't fix that; the running app has to check by itself.
 *
 * How: every production build embeds __BUILD_ID__ and ships /version.json
 * with the same id. We re-fetch version.json (no-store) when the tab
 * becomes visible and every POLL_INTERVAL_MS, and compare.
 *
 * Behavior on mismatch:
 * - On tab-return (visibilitychange) outside edit pages → hard reload
 *   immediately (user just arrived, nothing to lose).
 * - Otherwise → expose updateAvailable so the app can show a refresh banner
 *   (edit pages must not lose form state to an auto reload).
 */

import { useEffect, useState } from 'react'

declare const __BUILD_ID__: string

const POLL_INTERVAL_MS = 10 * 60 * 1000 // 10 min

// 这些路径上有表单编辑状态，绝不自动刷新
const EDIT_PATH_PREFIXES = ['/developer/upload', '/admin/tasks', '/admin/property']

function isEditPage(): boolean {
  return EDIT_PATH_PREFIXES.some(p => window.location.pathname.startsWith(p))
}

async function fetchServerBuildId(): Promise<string | null> {
  try {
    const res = await fetch(`/version.json?_=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return null
    const json = await res.json()
    return typeof json.buildId === 'string' ? json.buildId : null
  } catch {
    return null
  }
}

export function useVersionCheck(): { updateAvailable: boolean } {
  const [updateAvailable, setUpdateAvailable] = useState(false)

  useEffect(() => {
    // Dev server has no version.json / stable build id
    if (typeof __BUILD_ID__ === 'undefined' || import.meta.env.DEV) return

    let cancelled = false

    const check = async (allowAutoReload: boolean) => {
      const serverId = await fetchServerBuildId()
      if (cancelled || !serverId || serverId === __BUILD_ID__) return

      console.log(`🔄 New frontend build detected: ${__BUILD_ID__} → ${serverId}`)
      if (allowAutoReload && !isEditPage()) {
        window.location.reload()
      } else {
        setUpdateAvailable(true)
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // 用户刚回到页面（iPad 恢复快照的典型时机）→ 可安全自动刷新
        check(true)
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    const timer = setInterval(() => check(false), POLL_INTERVAL_MS)
    // Initial check shortly after load (covers restored snapshots that
    // don't fire visibilitychange)
    const initial = setTimeout(() => check(true), 5000)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibilityChange)
      clearInterval(timer)
      clearTimeout(initial)
    }
  }, [])

  return { updateAvailable }
}
