/**
 * 「更新历史里有你没看过的东西」—— 驱动导航栏那颗小红点。
 *
 * 纯本地(localStorage),不上报、不需要登录:一个匿名访客也该看到我们在改东西。
 * 存的是**最新一条的日期**,不是「看过/没看过」的布尔 —— 布尔会在下次更新时忘记
 * 该重新亮起来。
 */
import { useCallback, useEffect, useState } from 'react'
import { CHANGELOG } from '../data/changelog'
import { useIsAgentSide } from './useMyRole'

const KEY = 'pz-changelog-seen'

/**
 * **这个人看得到的**最新一条更新的日期(YYYY-MM-DD);没有可见条目时返回 null。
 *
 * 必须按受众取,不能无脑取 CHANGELOG[0]:某天只发了经纪侧的更新时,买家会被点亮一颗
 * 红点、点进去发现什么新东西都没有 —— 一次这样的空跑就够让人以后不再理这颗点了。
 */
export const latestChangelogDate = (isAgentSide: boolean): string | null =>
  CHANGELOG.find((e) => isAgentSide || e.audience !== 'agent')?.date ?? null

/**
 * 规则只有一条:**没读过最新那条就亮,读过就熄。**
 *
 * 🔴 这里我绕过两次弯,两次都错,记下来别再绕第三次:
 *
 *   ① 第一版:「没有 KEY = 新访客 → 不亮」。理由听着对("对第一次来的人『有更新』
 *      没意义"),但功能上线那天**所有老用户身上同样没有这个 KEY** → 红点对
 *      **该看到它的每一个人**都不亮。owner 当场问「去哪看呀?」——他自己都看不到。
 *
 *   ② 第二版:改成「看别的 localStorage 痕迹(访客 id / 语言)判断是不是老用户」。
 *      也错:app 启动时**自己就会写**这些键,所以真·新访客在 effect 跑到时早就
 *      "有痕迹"了 —— 判据恒真,等于没判。
 *
 * 结论:那个"别打扰新访客"的贴心是**不值得的复杂度**。一颗小圆点而已,新访客点进去
 * 看到半年的更新记录,反而是「这产品活着」的正面信号。简单到不可能错 > 聪明但会错。
 */
export function useUnseenChangelog(): { unseen: boolean; markSeen: () => void } {
  const isAgentSide = useIsAgentSide()
  const [unseen, setUnseen] = useState(false)

  useEffect(() => {
    const latest = latestChangelogDate(isAgentSide)
    if (!latest) return
    try {
      const seen = localStorage.getItem(KEY)
      setUnseen(!seen || seen < latest)
    } catch {
      /* 隐私模式:当作已看过,宁可不提示也别一直亮 */
    }
  }, [isAgentSide])

  // 记的是**自己这一侧**的最新日期。经纪看完再切成买家不会倒亮回来(日期只会更大),
  // 买家看完之后升级成经纪则可能重新亮起 —— 那是对的:他确实多了一批没看过的更新。
  const markSeen = useCallback(() => {
    const latest = latestChangelogDate(isAgentSide)
    if (!latest) return
    try { localStorage.setItem(KEY, latest) } catch { /* 隐私模式 */ }
    setUnseen(false)
  }, [isAgentSide])

  return { unseen, markSeen }
}
