/**
 * 「更新历史里有你没看过的东西」—— 驱动导航栏那颗小红点。
 *
 * 纯本地(localStorage),不上报、不需要登录:一个匿名访客也该看到我们在改东西。
 * 存的是**最新一条的日期**,不是「看过/没看过」的布尔 —— 布尔会在下次更新时忘记
 * 该重新亮起来。
 */
import { useCallback, useSyncExternalStore } from 'react'
import { CHANGELOG } from '../data/changelog'
import { useIsAgentSide } from './useMyRole'

const KEY = 'pz-changelog-seen'

/**
 * 🔴 **「看过了」必须是全应用一份状态,不能每个 hook 实例各存各的。**
 *
 * 踩过的坑:这个 hook 同时挂在 Header(那颗红点)和 /changelog 页(进页面就
 * markSeen)。各自 useState 的话,页面把**自己那份** unseen 设成 false,Header 那份
 * 完全不知情 —— 于是「点进去看了,红点还在」,得刷新整页才消。而且它不报错,
 * 就是永远消不掉,看着像红点坏了。
 *
 * 所以状态存在模块级(localStorage 是真相源),用 useSyncExternalStore 订阅:
 * 谁写了,所有实例同一帧一起更新。顺带白拿跨标签页同步(storage 事件)。
 */
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  window.addEventListener('storage', cb)   // 另一个标签页看过了,这边的点也该灭
  return () => { listeners.delete(cb); window.removeEventListener('storage', cb) }
}

/**
 * localStorage 写不进去时的兜底(无痕模式 / 禁了存储)。只活到关标签页为止,
 * 但至少**本次会话里点进去看过之后红点会灭** —— 不然它会一直亮着追着人跑。
 */
let memSeen = ''

/** 快照必须是**值稳定**的(字符串按值比较),否则 React 会判定每次都变了。 */
function readSeen(): string {
  try { return localStorage.getItem(KEY) || memSeen } catch { return memSeen }
}

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
  const seen = useSyncExternalStore(subscribe, readSeen, () => '')

  const latest = latestChangelogDate(isAgentSide)
  const unseen = !!latest && seen < latest

  // 记的是**自己这一侧**的最新日期。经纪看完再切成买家不会倒亮回来(日期只会更大),
  // 买家看完之后升级成经纪则可能重新亮起 —— 那是对的:他确实多了一批没看过的更新。
  const markSeen = useCallback(() => {
    const d = latestChangelogDate(isAgentSide)
    if (!d) return
    memSeen = d
    try { localStorage.setItem(KEY, d) } catch { /* 无痕模式:靠 memSeen 撑过这次会话 */ }
    emit()
  }, [isAgentSide])

  return { unseen, markSeen }
}
