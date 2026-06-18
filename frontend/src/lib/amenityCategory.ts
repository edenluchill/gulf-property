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

export const CATEGORY_META: Record<AmenityCategory, { zh: string; en: string; icon: LucideIcon }> = {
  pool: { zh: '泳池水景', en: 'Pools & Water', icon: Waves },
  fitness: { zh: '健身健康', en: 'Fitness & Wellness', icon: Dumbbell },
  family: { zh: '家庭亲子', en: 'Family & Kids', icon: Baby },
  security: { zh: '安全服务', en: 'Security & Services', icon: Shield },
  retail: { zh: '生活配套', en: 'Retail & Dining', icon: ShoppingBag },
  transport: { zh: '交通停车', en: 'Transport & Parking', icon: Car },
  outdoor: { zh: '户外景观', en: 'Outdoor & Nature', icon: Trees },
  leisure: { zh: '休闲娱乐', en: 'Leisure', icon: Clapperboard },
  other: { zh: '其他配套', en: 'Other', icon: Sparkles },
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
