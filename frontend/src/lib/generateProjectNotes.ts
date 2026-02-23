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

export function generateProjectNotes(data: ProjectData, lang: Language = 'en'): string {
  const { project, units, paymentPlan, projectUrl } = data
  const lines: string[] = []

  const isZh = lang === 'zh-CN'

  // Header with emoji border for WeChat
  lines.push(`🏗 ${project.project_name}`)
  lines.push(`🏢 ${isZh ? '开发商' : 'Developer'}：${project.developer}`)
  lines.push(`📍 ${project.area}`)
  lines.push('')

  // Tower info (if multiple towers exist)
  const towerStats = getTowerStats(units)
  if (towerStats.size > 1 || (towerStats.size === 1 && !towerStats.has('Main'))) {
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
    lines.push('')
  }

  // Price and area by bedroom type
  const unitStats = getUnitStats(units)
  const sortedBedrooms = Array.from(unitStats.keys()).sort((a, b) => a - b)

  if (sortedBedrooms.length > 0) {
    lines.push(isZh ? '💰 项目起价与面积' : '💰 Starting Prices & Sizes')

    for (const bedrooms of sortedBedrooms) {
      const stats = unitStats.get(bedrooms)!
      const label = getBedroomLabel(bedrooms, lang)

      let line = `• ${label}`

      if (stats.minPrice) {
        line += `：${formatPriceShort(stats.minPrice, lang)}`
      }

      if (stats.minArea) {
        line += isZh ? '｜' : ' | '
        line += formatArea(stats.minArea.toString(), lang)
      }

      lines.push(line)
    }
    lines.push('')
  }

  // Payment plan
  if (paymentPlan && paymentPlan.length > 0) {
    lines.push(isZh ? '📅 付款计划' : '📅 Payment Plan')

    // Sort by display_order
    const sortedPlan = [...paymentPlan].sort((a, b) => a.display_order - b.display_order)

    for (const milestone of sortedPlan) {
      const name = milestone.milestone_name
      const percentage = milestone.percentage.replace('%', '').trim()
      lines.push(`• ${name}：${percentage}%`)
    }
    lines.push('')
  }

  // Completion date
  if (project.completion_date) {
    const date = new Date(project.completion_date)
    const dateStr = date.toLocaleDateString(isZh ? 'zh-CN' : 'en-US', {
      year: 'numeric',
      month: 'short'
    })
    lines.push(isZh ? `📆 预计交付：${dateStr}` : `📆 Expected Completion: ${dateStr}`)
    lines.push('')
  }

  // Project link
  if (projectUrl) {
    lines.push(isZh ? `🔗 查看详情：${projectUrl}` : `🔗 View Details: ${projectUrl}`)
  }

  return lines.join('\n').trim()
}
