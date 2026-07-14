/**
 * Luna Collab — **地图状态同步**（指标 / 筛选 / 项目显示）。
 *
 * 🔴 owner 实测:
 *   「经纪点击 filter panel 比如切换增长率,他不会 sync 到客户手机」
 *   「关闭/打开项目显示时也不会 sync」
 *   「filter 也不会 sync,比如 filter 交房日期,都只在经纪手机」
 *
 * 根因:**只有相机、光标、画笔在同步;地图的「状态」完全没进协议。**
 * 于是经纪切了增长率热力图、筛了交房日期,客户看到的还是原样 ——
 * **两个人在看不同的地图,而经纪以为在讲同一张。**
 *
 * ── 为什么不改协议 ─────────────────────────────────────────────────────
 * 协议里已经有 `mapAction` 这条**通用广播通道**(Luna 的工具输出、画笔都在复用它)。
 * 地图状态就是一种 mapAction。**不动协议、不动服务器**,加一个 type 前缀即可 ——
 * 这也意味着老客户端收到会**安全地忽略**它。
 *
 * ── 谁说了算 ───────────────────────────────────────────────────────────
 * **只有经纪广播,客户只听。** 客户改自己的筛选不该反向污染经纪
 *(他要是想自己逛,那是 Free 模式该管的事,不是这里)。
 *
 * ⚠️ 回环:收到远端状态时用 `applyingRef` 上锁 —— 否则「收到 → setState →
 *    看起来像本地改动 → 再广播出去」会在两端之间无限弹球。
 */
import { useCallback, useEffect, useRef } from 'react'
import type { CollabClient } from './CollabClient'
import type { ServerMsg } from './protocol'

export const MAP_STATE_TYPE = '__collab_mapstate'

/**
 * 同步的东西。判断标准只有一条:**它会不会改变「客户屏幕上看到什么」。**
 * 会 → 必须同步(否则两个人在看不同的地图)。
 * 不会(比如经纪自己那个 POI 面板开没开)→ 不同步,别给客户添乱。
 */
export interface CollabMapState {
  /** 区域指标热力图（增长率 / 回报 / 单价…）；'none' = 关掉 */
  areaMetric?: string
  /** 楼盘筛选（价格 / 卧室 / 交房日期 …） */
  filters?: Record<string, unknown>
  /** 项目卡片是否显示 */
  showCards?: boolean
  /** 地铁线图层 */
  showTransit?: boolean
  /**
   * POI 品类筛选（学校 / 医院 / 商场 / 地铁站…）。
   * owner:「POI 那些 filter 点击也不会在客户那里显示」—— 经纪点亮「学校」是为了
   * 讲学区,客户屏幕上却一个学校都没有。
   */
  poiCategories?: string[]
  /** 底图（矢量 / 卫星 / 夜景）—— 经纪切到卫星是为了让客户看清建筑 */
  baseMap?: string
}

interface Opts {
  client: CollabClient | null
  active: boolean
  /** 只有经纪广播 */
  isPresenter: boolean
  /** 收到经纪的状态 → 应用到本地地图 */
  onRemote: (s: CollabMapState) => void
}

export function useCollabMapState({ client, active, isPresenter, onRemote }: Opts) {
  const applyingRef = useRef(false)
  const onRemoteRef = useRef(onRemote)
  onRemoteRef.current = onRemote
  const lastSentRef = useRef<string>('')

  // ── 客户:收到经纪的状态 → 应用 ─────────────────────────────────────────
  useEffect(() => {
    if (!active || !client) return
    const off = client.on('mapAction', (m: ServerMsg) => {
      if (m.k !== 'mapAction') return
      const a = (m as { action?: { type?: string; state?: CollabMapState } }).action
      if (!a || a.type !== MAP_STATE_TYPE || !a.state) return
      applyingRef.current = true
      try {
        onRemoteRef.current(a.state)
      } finally {
        // 下一拍再解锁 —— setState 是异步的,立刻解锁会让「应用远端」被当成本地改动再广播出去
        setTimeout(() => { applyingRef.current = false }, 0)
      }
    })
    return () => off()
  }, [active, client])

  /**
   * 🔴 **客户后进来时,得知道经纪当前的地图长什么样。**
   *
   * 只在「状态变化」时广播是不够的:经纪先切了增长率、客户**之后**才点开链接 ——
   * 他收不到任何东西,看到的还是默认地图。**又变成两张不同的地图。**
   *
   * 所以经纪一看到有人加入,就把当前状态**重发一遍**(清掉去重指纹即可)。
   */
  const latestRef = useRef<CollabMapState | null>(null)
  useEffect(() => {
    if (!active || !client || !isPresenter) return
    const off = client.on('join', () => {
      lastSentRef.current = ''            // 清掉去重指纹 → 下一次 broadcast 一定会发
      const st = latestRef.current
      if (st) {
        client.send({ k: 'mapAction', seq: 0, action: { type: MAP_STATE_TYPE, state: st } })
        lastSentRef.current = JSON.stringify(st)
      }
    })
    return () => off()
  }, [active, client, isPresenter])

  // ── 经纪:本地状态变了 → 广播 ───────────────────────────────────────────
  const broadcast = useCallback((state: CollabMapState) => {
    if (!active || !client || !isPresenter) return
    if (applyingRef.current) return          // 正在应用远端 → 不回broadcast
    latestRef.current = state
    const json = JSON.stringify(state)
    if (json === lastSentRef.current) return // 没变就不发(state 对象每次渲染都是新的)
    lastSentRef.current = json
    client.send({ k: 'mapAction', seq: 0, action: { type: MAP_STATE_TYPE, state } })
  }, [active, client, isPresenter])

  return { broadcast }
}
