/**
 * 配套品类 / 便利度档位 → **当前语言**的展示文案。
 *
 * 【为什么需要它】
 * 后端 session-builder 以前把展示文案烤进 snapshot 的 jsonb:
 *   - `distances[].label` = `🚇 地铁（Dubai Mall）` —— `AMENITY_SPECS` **只有 `zh` 一个分支**,
 *     于是英/阿/俄/法的导览里,配套行照样是中文。
 *   - `amenity_tier` = `优秀/良好/一般/偏远` —— 同上,直接显示在 FactSheet / 导览卡上。
 * 翻完页面标签也没用:**数据行本身就是中文**。
 * 现在后端改送结构化真值(`cat` / `name` / tier code),文案在前端按语言拼。
 *
 * 【历史 session 必须留兜底】
 * DB 里既有的 session jsonb **只有 label、tier 只有中文**。认不出就原样显示 ——
 * 不留兜底就是"修一个 bug 造一个"(`distances[].cat` 那次的教训)。
 *
 * 【t 由调用方给】
 * 两个消费方的语言模型不同:FactSheet 锁文档语言(getFixedT),
 * OverlayLayer 跟 tour 语言(TourOverlay 打开时已全局切好)。所以这里只收 t,不自己拿。
 * 约定:传进来的 t 已按 ns 绑好,查的是
 * `amenityCat.<cat>` / `amenityTier.<tier>` / `amenityCatNamed`。
 */
import type { TourAmenityCat } from './types'

type T = (k: string, o?: Record<string, unknown>) => string

const TIERS = new Set(['excellent', 'good', 'fair', 'remote'])
/** emoji **不进译文** —— 它是语言无关的,五份 JSON 各存一遍只会漂移。 */
const CAT_EMOJI: Record<string, string> = {
  metro_station: '🚇',
  school: '🏫',
  mall: '🛍️',
  hospital: '🏥',
  supermarket: '🛒',
}

/** 便利度档位。认不出 code = 历史 session 的中文 → 原样显示(总比空白强)。 */
export function tierLabel(t: T, tier: string | undefined): string | null {
  if (!tier) return null
  return TIERS.has(tier) ? t(`amenityTier.${tier}`) : tier
}

/**
 * 一条配套距离的展示文案。
 * cat 有 → 按语言出品类词,`name` 有才拼专名(name 已过地名防线,null = 不能给这语言看)。
 * cat 无 → 历史 session,只能回退到后端拼死的 label。
 */
export function distanceLabel(
  t: T,
  d: { label: string; cat?: TourAmenityCat; name?: string | null }
): string {
  const emoji = d.cat ? CAT_EMOJI[d.cat] : undefined
  if (!d.cat || !emoji) return d.label // 历史 session:label 里本来就带 emoji
  // 「品类 + 专名」怎么拼**是语言的事**,别在代码里写死 —— 中文用全角「（）」,
  // 英/俄/法用半角,阿语还得考虑 RTL 下括号的方向。所以整句交给译文。
  const cat = t(`amenityCat.${d.cat}`)
  return `${emoji} ${d.name ? t('amenityCatNamed', { cat, name: d.name }) : cat}`
}
