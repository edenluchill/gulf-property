/**
 * Map a free-text amenity string to a category (for grouped display). Keyword
 * matching, English + 中文; unmatched → 'other'. Pure data.
 */
import {
  Waves, Dumbbell, Baby, Shield, ShoppingBag, Car, Trees, Sparkles, Clapperboard,
  type LucideIcon,
} from 'lucide-react'

export type AmenityCategory =
  | 'pool' | 'fitness' | 'family' | 'security' | 'retail' | 'transport' | 'outdoor' | 'leisure' | 'other'

/**
 * 品类 → 图标。**文案不在这里** —— 走 `t('project:amenityCat.<cat>')`。
 *
 * 这里曾是 `{ zh, en }` 两个写死的字段,消费方写 `zh ? meta.zh : meta.en`
 * → **ar/ru/fr 用户看到的全是英文**。icon 是数据(语言无关),留下。
 *
 * ⚠️ key 的顺序 = 展示顺序(groupAmenities 依赖 Object.keys 的顺序),别乱排。
 */
export const CATEGORY_META: Record<AmenityCategory, { icon: LucideIcon }> = {
  pool: { icon: Waves },
  fitness: { icon: Dumbbell },
  family: { icon: Baby },
  security: { icon: Shield },
  retail: { icon: ShoppingBag },
  transport: { icon: Car },
  outdoor: { icon: Trees },
  leisure: { icon: Clapperboard },
  other: { icon: Sparkles },
}

const RULES: { cat: AmenityCategory; re: RegExp }[] = [
  { cat: 'pool', re: /pool|swim|jacuzzi|aqua|lagoon|泳池|水景|游泳/i },
  { cat: 'fitness', re: /gym|fitness|yoga|spa|sauna|wellness|jog|running|sport|tennis|padel|健身|瑜伽|运动|跑/i },
  { cat: 'family', re: /kid|child|playground|family|nursery|bbq|barbecue|儿童|亲子|游乐|烧烤/i },
  { cat: 'security', re: /security|concierge|cctv|guard|valet|reception|安保|礼宾|门禁|前台|保安/i },
  { cat: 'retail', re: /retail|shop|supermarket|cafe|coffee|restaurant|dining|mall|商店|餐厅|咖啡|零售|超市/i },
  { cat: 'transport', re: /parking|garage|charging|\bev\b|metro|valet park|停车|充电|车位/i },
  { cat: 'outdoor', re: /garden|park|landscape|beach|terrace|courtyard|green|花园|景观|海滩|露台|绿/i },
  { cat: 'leisure', re: /lounge|cinema|club|games?|library|theater|theatre|休闲|影院|会所|图书|娱乐/i },
]

export function categorizeAmenity(amenity: string): AmenityCategory {
  for (const r of RULES) if (r.re.test(amenity)) return r.cat
  return 'other'
}

/** Group a list of amenities by category, preserving meta order. */
export function groupAmenities(amenities: string[]): { cat: AmenityCategory; items: string[] }[] {
  const buckets = new Map<AmenityCategory, string[]>()
  for (const a of amenities) {
    const c = categorizeAmenity(a)
    if (!buckets.has(c)) buckets.set(c, [])
    buckets.get(c)!.push(a)
  }
  return (Object.keys(CATEGORY_META) as AmenityCategory[])
    .filter((c) => buckets.has(c))
    .map((c) => ({ cat: c, items: buckets.get(c)! }))
}
