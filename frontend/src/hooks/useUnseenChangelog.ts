/**
 * 「更新历史里有你没看过的东西」—— 驱动导航栏上那颗小红点。
 *
 * 纯本地(localStorage),不上报、不需要登录:一个匿名访客也该看到我们在改东西。
 * 存的是**最新一条的日期**,不是「看过/没看过」的布尔 —— 布尔会在下次更新时忘记
 * 该重新亮起来。
 *
 * 首次访问(还没有记录)**不亮**:对一个第一次来的人,"有更新"是没有意义的
 * —— 他什么都还没看过。只有"上次来之后又改了东西"才值得提示。
 */
import { useCallback, useEffect, useState } from 'react'
import { CHANGELOG } from '../data/changelog'

const KEY = 'pz-changelog-seen'

/** 最新一条更新的日期(YYYY-MM-DD);清单为空时返回 null。 */
export const latestChangelogDate = (): string | null => CHANGELOG[0]?.date ?? null

export function useUnseenChangelog(): { unseen: boolean; markSeen: () => void } {
  const [seen, setSeen] = useState<string | null>(null)

  useEffect(() => {
    try {
      const v = localStorage.getItem(KEY)
      if (v) { setSeen(v); return }
      // 第一次来:直接记成"已看到最新",别给新访客亮红点
      const latest = latestChangelogDate()
      if (latest) localStorage.setItem(KEY, latest)
      setSeen(latest)
    } catch {
      setSeen(latestChangelogDate())   // 隐私模式:当作已看过,宁可不提示也别一直亮
    }
  }, [])

  const markSeen = useCallback(() => {
    const latest = latestChangelogDate()
    if (!latest) return
    try { localStorage.setItem(KEY, latest) } catch { /* 隐私模式 */ }
    setSeen(latest)
  }, [])

  const latest = latestChangelogDate()
  return { unseen: !!latest && !!seen && seen < latest, markSeen }
}
