/**
 * Shared types for Property Editor components
 */

export interface UnitType {
  id: string
  name: string
  category?: string
  typeName?: string
  unitNumbers?: string[]
  unitCount?: number
  bedrooms: number
  bathrooms: number
  area: number
  suiteArea?: number
  balconyArea?: number
  price?: number
  pricePerSqft?: number
  orientation?: string
  features?: string[]
  description?: string
  floorPlanImage?: string
  floorPlanImages?: string[]
}

export interface PropertyFormData {
  projectName: string
  developer: string
  address: string
  area: string
  completionDate: string
  launchDate?: string
  handoverDate?: string
  constructionProgress?: number
  description: string
  latitude?: number
  longitude?: number
  amenities: string[]
  unitTypes: UnitType[]
  paymentPlan: any[]
  projectImages?: string[]
  floorPlanImages?: string[]
  visualContent?: {
    hasRenderings?: boolean
    hasFloorPlans?: boolean
    hasLocationMaps?: boolean
    renderingDescriptions?: string[]
    floorPlanDescriptions?: string[]
  }
  extractedPricing?: any[]
}

export const initialFormData: PropertyFormData = {
  projectName: '',
  developer: '',
  address: '',
  area: '',
  completionDate: '',
  description: '',
  amenities: [],
  unitTypes: [],
  paymentPlan: [],
}

/**
 * Group units by building prefix (extracted from typeName)
 */
export function groupUnitsByBuilding(unitTypes: UnitType[]): Record<string, UnitType[]> {
  return unitTypes.reduce((acc, unit) => {
    let buildingGroup = null

    if (unit.typeName) {
      const matchWithHyphen = unit.typeName.match(/^([A-Z]+)-/)
      const matchLettersOnly = unit.typeName.match(/^([A-Z]+)$/)
      const matchBeforeDigits = unit.typeName.match(/^([A-Z]+)[\d\(]/)

      if (matchWithHyphen) {
        buildingGroup = matchWithHyphen[1]
      } else if (matchLettersOnly) {
        buildingGroup = matchLettersOnly[1]
      } else if (matchBeforeDigits) {
        buildingGroup = matchBeforeDigits[1]
      }
    }

    const groupKey = buildingGroup || 'Uncategorized'

    if (!acc[groupKey]) acc[groupKey] = []
    acc[groupKey].push(unit)
    return acc
  }, {} as Record<string, UnitType[]>)
}
