/**
 * telemetry/funnel — 通用多步漏斗。任何 feature 都能用。
 *
 * 为什么需要:2026-07-13 那批带看房间里,大部分 `peak_participants = 1`
 * (客户压根没进来)—— 这是**手查数据库**才发现的。而经纪那头看不出
 * 「客户没进来」和「客户卡住了」的区别,两者在他眼里都是「怎么半天没反应」。
 * 漏斗把这个断崖直接画出来。
 *
 * 实现刻意极简:**一步一个 counter**(`funnel.<name>`,label = step),
 * 转化率 = 相邻两步的比值。不建表、不存 session、不做 join。
 *
 * 代价(明说):这是**聚合**漏斗,不是逐用户路径 —— 能告诉你「30% 的人卡在身份门」,
 * 不能告诉你「张三卡在身份门」。想追单个用户,那是 app_events 的活,不是这里。
 */
import { counter } from './metrics'

export interface Funnel {
  /** 记一次「有人走到了这一步」。 */
  step(step: string): void
}

/**
 * 声明一个漏斗。步骤顺序在 `steps` 里定义 —— 它同时也是**白名单**:
 * 传了没声明过的步骤会被丢掉,避免 label 基数被写错的代码炸开。
 */
export function funnel(name: string, steps: readonly string[]): Funnel {
  const allowed = new Set(steps)
  return {
    step(step: string) {
      if (!allowed.has(step)) return   // 未声明的步骤直接丢 —— 基数护栏
      counter(`funnel.${name}`, { step }).inc()
    },
  }
}

// ── 已声明的漏斗 ────────────────────────────────────────────────────────────

/**
 * 实时带看进房漏斗。前两步由前端上报(RUM),后三步服务端直接记。
 *
 *   link_open       客户点开分享链接(/t/:code)
 *   identity_submit 填了称呼、点「进入带看」  ← 今天怀疑的流失点
 *   ws_connect      WS 连上
 *   sync            收到房间快照(= 真正进房成功)
 *   first_cam       收到经纪的第一帧相机(= 画面开始跟随)
 */
export const COLLAB_JOIN_STEPS = ['link_open', 'identity_submit', 'ws_connect', 'sync', 'first_cam'] as const
export const collabJoin = funnel('collab.join', COLLAB_JOIN_STEPS)

/**
 * Luna Tour 生成 → 客户观看。
 *
 * 这条漏斗回答的是**唯一重要的问题**:辛苦生成的 tour,到底有没有人看?
 * (最后一步 client_open 之前,整条链路的价值都是零。)
 *
 *   create        经纪点「生成」
 *   draft_ready   草稿生成成功(AI 出剧本)      ← 失败现在只写内存 + console
 *   render        经纪确认发布(**额度在这一步扣**)
 *   audio_ready   语音全部渲染成功              ← 部分失败也会被标成"成功"
 *   client_open   客户真的点开看了
 */
export const TOUR_PUBLISH_STEPS = ['create', 'draft_ready', 'render', 'audio_ready', 'client_open'] as const
export const tourPublish = funnel('tour.publish', TOUR_PUBLISH_STEPS)
