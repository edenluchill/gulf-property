import { ResidentialProject, UnitType, PaymentPlan } from '../types'

interface ProjectData {
  project: ResidentialProject
  units: UnitType[]
  paymentPlan: PaymentPlan[]
  projectUrl?: string
}

type Language = 'en' | 'zh-CN'

// Format price in millions (AED)
function formatPriceShort(price: number, lang: Language): string {
  if (price >= 10000000) {
    const millions = (price / 1000000).toFixed(1).replace(/\.0$/, '')
    return lang === 'zh-CN' ? `${millions}00万迪拉姆` : `AED ${millions}M`
  } else if (price >= 1000000) {
    const millions = (price / 10000).toFixed(0)
    return lang === 'zh-CN' ? `${millions}万迪拉姆` : `AED ${(price / 1000000).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')}M`
  } else {
    const thousands = (price / 1000).toFixed(0)
    return lang === 'zh-CN' ? `${thousands}K迪拉姆` : `AED ${thousands}K`
  }
}

// Format area with ~
function formatArea(area: string, lang: Language): string {
  const num = parseFloat(area)
  if (isNaN(num)) return area
  const rounded = Math.round(num / 10) * 10
  return lang === 'zh-CN' ? `约 ${rounded.toLocaleString()} 平方英尺` : `~${rounded.toLocaleString()} sq ft`
}

// Get bedroom label
function getBedroomLabel(bedrooms: number, lang: Language): string {
  if (bedrooms === 0) {
    return lang === 'zh-CN' ? '开间' : 'Studio'
  }
  return lang === 'zh-CN' ? `${bedrooms}房` : `${bedrooms}BR`
}

// Group units by tower and calculate stats
function getTowerStats(units: UnitType[]): Map<string, { unitCount: number; floors?: number }> {
  const towerMap = new Map<string, { unitCount: number; floors?: number }>()

  for (const unit of units) {
    const tower = unit.tower || 'Main'
    const existing = towerMap.get(tower) || { unitCount: 0 }
    existing.unitCount += unit.unit_count

    // Try to extract floor info from floor_level
    if (unit.floor_level) {
      const match = unit.floor_level.match(/(\d+)/g)
      if (match) {
        const maxFloor = Math.max(...match.map(Number))
        existing.floors = Math.max(existing.floors || 0, maxFloor)
      }
    }

    towerMap.set(tower, existing)
  }

  return towerMap
}

// Group units by bedrooms and get price/area stats
function getUnitStats(units: UnitType[]): Map<number, { minPrice: number | null; minArea: number | null; maxArea: number | null; hasMaid?: boolean }> {
  const bedroomMap = new Map<number, { minPrice: number | null; minArea: number | null; maxArea: number | null; hasMaid?: boolean }>()

  for (const unit of units) {
    const bedrooms = unit.bedrooms
    const existing = bedroomMap.get(bedrooms) || { minPrice: null, minArea: null, maxArea: null }

    if (unit.price && (existing.minPrice === null || unit.price < existing.minPrice)) {
      existing.minPrice = unit.price
    }

    const area = parseFloat(unit.area)
    if (!isNaN(area)) {
      if (existing.minArea === null || area < existing.minArea) {
        existing.minArea = area
      }
      if (existing.maxArea === null || area > existing.maxArea) {
        existing.maxArea = area
      }
    }

    // Check for maid's room in features or name
    const hasMaid = unit.features?.some(f => /maid|helper|domestic/i.test(f)) ||
                    /maid|保姆/i.test(unit.unit_type_name || '')
    if (hasMaid) {
      existing.hasMaid = true
    }

    bedroomMap.set(bedrooms, existing)
  }

  return bedroomMap
}

// Get down payment info from payment plan
function getDownPaymentInfo(paymentPlan: PaymentPlan[], startingPrice: number | undefined, lang: Language): string | null {
  if (!paymentPlan || paymentPlan.length === 0) return null

  const sortedPlan = [...paymentPlan].sort((a, b) => a.display_order - b.display_order)
  const firstMilestone = sortedPlan[0]

  if (!firstMilestone) return null

  const percentage = typeof firstMilestone.percentage === 'string'
    ? parseFloat(firstMilestone.percentage.replace('%', ''))
    : firstMilestone.percentage

  if (isNaN(percentage)) return null

  const isZh = lang === 'zh-CN'

  // If we have starting price, show actual amount
  if (startingPrice && startingPrice > 0) {
    const downPayment = startingPrice * (percentage / 100)
    const formatted = formatPriceShort(downPayment, lang)
    return isZh
      ? `💵 首付：${percentage}%（约${formatted}起）`
      : `💵 Down Payment: ${percentage}% (~${formatted})`
  }

  return isZh ? `💵 首付：${percentage}%` : `💵 Down Payment: ${percentage}%`
}

// Get payment plan summary (e.g., "20/80" or "10/40/50")
function getPaymentPlanSummary(paymentPlan: PaymentPlan[], lang: Language): string | null {
  if (!paymentPlan || paymentPlan.length === 0) return null

  const sortedPlan = [...paymentPlan].sort((a, b) => a.display_order - b.display_order)
  const validMilestones = sortedPlan.filter(m => m.milestone_name && m.milestone_name !== 'undefined')

  if (validMilestones.length === 0) return null

  // Calculate during construction vs on handover
  let duringConstruction = 0
  let onHandover = 0

  for (const m of validMilestones) {
    const pct = typeof m.percentage === 'string'
      ? parseFloat(m.percentage.replace('%', ''))
      : m.percentage

    if (isNaN(pct)) continue

    const name = (m.milestone_name || '').toLowerCase()
    if (name.includes('handover') || name.includes('completion') || name.includes('交付') || name.includes('交楼')) {
      onHandover += pct
    } else {
      duringConstruction += pct
    }
  }

  // If we couldn't categorize, skip
  if (duringConstruction === 0 && onHandover === 0) return null

  const isZh = lang === 'zh-CN'
  return isZh
    ? `💳 付款方式：${Math.round(duringConstruction)}/${Math.round(onHandover)}（建设期/交付）`
    : `💳 Payment: ${Math.round(duringConstruction)}/${Math.round(onHandover)} (Construction/Handover)`
}

// Get top amenities
function getTopAmenities(amenities: string[] | undefined, lang: Language, maxCount: number = 3): string | null {
  if (!amenities || amenities.length === 0) return null

  // Priority amenities (in order of importance for buyers)
  const priorityKeywords = [
    'beach', 'pool', 'gym', 'spa', 'golf', 'marina', 'sea', 'lagoon',
    'private', 'infinity', 'rooftop', 'smart', 'concierge',
    '海滩', '泳池', '健身', '水疗', '高尔夫', '码头', '海景', '私人', '无边', '天台', '智能', '礼宾'
  ]

  // Sort amenities by priority
  const sorted = [...amenities].sort((a, b) => {
    const aLower = a.toLowerCase()
    const bLower = b.toLowerCase()
    const aPriority = priorityKeywords.findIndex(k => aLower.includes(k))
    const bPriority = priorityKeywords.findIndex(k => bLower.includes(k))

    // Items with priority keywords come first
    if (aPriority >= 0 && bPriority < 0) return -1
    if (bPriority >= 0 && aPriority < 0) return 1
    if (aPriority >= 0 && bPriority >= 0) return aPriority - bPriority

    return 0
  })

  const top = sorted.slice(0, maxCount)
  if (top.length === 0) return null

  const isZh = lang === 'zh-CN'
  const separator = isZh ? '、' : ' | '
  return isZh
    ? `✨ 配套：${top.join(separator)}`
    : `✨ Amenities: ${top.join(separator)}`
}

export function generateProjectNotes(data: ProjectData, lang: Language = 'en'): string {
  const { project, units, paymentPlan, projectUrl } = data
  const lines: string[] = []

  const isZh = lang === 'zh-CN'

  // Header with emoji border for WeChat
  lines.push(`🏗 ${project.project_name}`)
  if (project.developer) {
    lines.push(`🏢 ${isZh ? '开发商' : 'Developer'}：${project.developer}`)
  }
  if (project.area) {
    lines.push(`📍 ${project.area}`)
  }
  lines.push('')

  // Down payment info (extracted from first payment milestone)
  const downPaymentInfo = getDownPaymentInfo(paymentPlan, project.starting_price, lang)
  if (downPaymentInfo) {
    lines.push(downPaymentInfo)
  }

  // Tower info (if multiple towers exist)
  const towerStats = getTowerStats(units)
  if (towerStats.size > 1 || (towerStats.size === 1 && !towerStats.has('Main'))) {
    lines.push('')
    const towerNames = Array.from(towerStats.keys()).join('、')
    const towerCount = towerStats.size
    lines.push(isZh
      ? `🏢 ${towerCount}栋塔楼（${towerNames}）`
      : `🏢 ${towerCount} Towers (${towerNames})`)

    for (const [tower, stats] of towerStats) {
      let towerLine = `• ${tower}`
      if (stats.floors) {
        towerLine += isZh ? `：${stats.floors} 层` : `: ${stats.floors} floors`
        towerLine += isZh ? `，${stats.unitCount} 套` : `, ${stats.unitCount} units`
      } else {
        towerLine += isZh ? `：${stats.unitCount} 套` : `: ${stats.unitCount} units`
      }
      lines.push(towerLine)
    }
  }

  // Price and area by bedroom type - only show bedrooms with price info
  const unitStats = getUnitStats(units)
  const sortedBedrooms = Array.from(unitStats.keys()).sort((a, b) => a - b)
  const bedroomsWithPrice = sortedBedrooms.filter(b => unitStats.get(b)?.minPrice)

  if (bedroomsWithPrice.length > 0) {
    lines.push('')
    lines.push(isZh ? '💰 项目起价与面积' : '💰 Starting Prices & Sizes')

    for (const bedrooms of bedroomsWithPrice) {
      const stats = unitStats.get(bedrooms)!
      const label = getBedroomLabel(bedrooms, lang)
      let line = `• ${label}：${formatPriceShort(stats.minPrice!, lang)}`

      if (stats.minArea) {
        line += isZh ? '｜' : ' | '
        line += formatArea(stats.minArea.toString(), lang)
      }

      lines.push(line)
    }
  }

  // Payment plan summary (e.g., "20/80")
  const paymentSummary = getPaymentPlanSummary(paymentPlan, lang)
  if (paymentSummary) {
    lines.push('')
    lines.push(paymentSummary)
  }

  // Top amenities
  const amenitiesLine = getTopAmenities(project.amenities, lang)
  if (amenitiesLine) {
    lines.push('')
    lines.push(amenitiesLine)
  }

  // Completion date
  if (project.completion_date) {
    lines.push('')
    const date = new Date(project.completion_date)
    const dateStr = date.toLocaleDateString(isZh ? 'zh-CN' : 'en-US', {
      year: 'numeric',
      month: 'short'
    })
    lines.push(isZh ? `📆 预计交付：${dateStr}` : `📆 Expected Completion: ${dateStr}`)
  }

  // Project link
  if (projectUrl) {
    lines.push('')
    lines.push(isZh ? `🔗 查看详情：${projectUrl}` : `🔗 View Details: ${projectUrl}`)
  }

  return lines.join('\n').trim()
}
