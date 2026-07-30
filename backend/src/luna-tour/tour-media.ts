/**
 * Luna Tour —— 把**真实素材**（海景/环境视频、实拍照片）贴到导览的拍上。
 *
 * owner:「导览要能贴上附近视频和环境视频比如海景视频，然后项目照片或者自己上传视频。」
 *
 * ── 为什么是代码贴，不是模型贴 ──────────────────────────────────────────────
 * `media` overlay 需要一个 `url`。**只要让模型填 url，它就会编一个出来** ——
 * 而编出来的 URL 在客户屏幕上就是一个加载失败的黑框（同一个坑在 roi_card 的数字上
 * 已经证明过一次）。所以模型压根看不到素材清单：它只管讲话，素材由这里按
 * `slot`（落地 / 周边 / 户型 / 收尾）确定性地贴上去。
 *
 * ── 素材从哪来 ────────────────────────────────────────────────────────────
 * 1. `lt_project_tour_media` —— 人工挑过的（视频 + 照片），有 slot 和说明文字。
 *    用 `scripts/project-tour.ts --media-add` 加（本地文件会上传到 R2）。
 * 2. 兜底：`residential_projects` 的封面/相册图。⚠️ 那是**楼书抠图**，里面混着户型图
 *    和 logo 页，所以只在没有人工素材时用，而且只取封面（第一张最可能是主视觉）。
 *
 * ISOLATION：删掉这个文件 + tour-generator 里那一行调用即可移除。
 */
import type { PoolClient } from 'pg'
import type { TourScript, Beat } from './tour-script.types'

export type MediaSlot = 'arrival' | 'nearby' | 'homes' | 'outro'

export interface TourMediaItem {
  kind: 'video' | 'image'
  url: string
  caption?: string | null
  slot: MediaSlot
}

/** 读一个楼盘的导览素材：人工挑过的优先，没有就用封面兜底。 */
export async function fetchTourMedia(
  client: PoolClient,
  projectId: string,
  fallbackCover?: string | null
): Promise<TourMediaItem[]> {
  const { rows } = await client.query<{
    kind: 'video' | 'image'
    url: string
    caption: string | null
    slot: MediaSlot
  }>(
    `SELECT kind, url, caption, slot
       FROM lt_project_tour_media
      WHERE project_id = $1
      ORDER BY slot, sort_order, created_at`,
    [projectId]
  )
  if (rows.length) return rows
  // 一条人工素材都没有 → 至少让「落地」那一拍有张真实照片，别只有卫星图
  if (fallbackCover) return [{ kind: 'image', url: fallbackCover, caption: null, slot: 'arrival' }]
  return []
}

/**
 * 把素材贴进剧本：每个 slot 最多一条（一拍上叠两个视频是噪音）。
 *
 * `nearby` 的素材贴在**第一个**配套拍上 —— 那一拍讲的是「周边环境」，
 * 一段海景/街景视频正好是那句话的证据；后面几拍的主角是品类卡，别抢。
 *
 * ⚠️ 幂等：先清掉剧本里已有的 media overlay 再贴，重生成不会越贴越多。
 */
export function attachMedia(script: TourScript, media: TourMediaItem[]): number {
  const beats: Beat[] = [script.intro, ...script.acts.flatMap((a) => a.beats), script.outro].filter(Boolean)
  for (const b of beats) {
    if (b.overlays?.length) b.overlays = b.overlays.filter((o) => o.type !== 'media')
  }
  if (!media.length) return 0

  const bySlot = new Map<MediaSlot, TourMediaItem>()
  for (const m of media) if (!bySlot.has(m.slot)) bySlot.set(m.slot, m)

  const pick = (slot: MediaSlot): Beat | undefined => {
    if (slot === 'outro') return script.outro
    const all = script.acts.flatMap((a) => a.beats)
    if (slot === 'arrival') return all.find((b) => b.kind === 'arrival') ?? all[0]
    if (slot === 'homes') return all.find((b) => b.kind === 'homes')
    return all.find((b) => b.kind === 'nearby') // 第一个配套拍
  }

  let attached = 0
  for (const [slot, m] of bySlot) {
    const beat = pick(slot)
    if (!beat) continue
    beat.overlays = beat.overlays ?? []
    beat.overlays.push({
      type: 'media',
      // 素材从第一帧就在 —— 它是这一拍的证据，不是迟到的注脚（同 property_card 的规矩）
      at_ms: 0,
      duration_ms: beat.duration_ms,
      media_kind: m.kind,
      url: m.url,
      ...(m.caption ? { caption: m.caption } : {}),
      fit: 'cover',
    })
    attached++
  }
  return attached
}
