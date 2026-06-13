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
  renderingImages?: string[]   // ⭐ 户型外观效果图（高端楼书一户型多页渲染）
  interiorImages?: string[]    // ⭐ 户型室内效果图
  balconyImages?: string[]     // ⭐ 阳台/露台图
  parkingSpaces?: number    // ⭐ 车位配比（来自楼书文本层库存表）
}

export interface Landmark {
  name: string
  distanceKm: number
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
  status?: string  // 'upcoming' | 'under-construction' | 'completed' | 'handed-over' | 'sold-out'
  description: string
  latitude?: number
  longitude?: number
  amenities: string[]
  unitTypes: UnitType[]
  paymentPlan: any[]
  projectImages?: string[]
  floorPlanImages?: string[]
  hiddenProjectImages?: string[]  // Images hidden by user (not deleted, can restore)
  hiddenFloorPlanImages?: string[]  // Floor plan images hidden by user
  primaryImage?: string  // User-selected featured image for map pin display
  visualContent?: {
    hasRenderings?: boolean
    hasFloorPlans?: boolean
    hasLocationMaps?: boolean
    renderingDescriptions?: string[]
    floorPlanDescriptions?: string[]
  }
  extractedPricing?: any[]
  serviceCharge?: number       // ⭐ 服务费 AED/sqft/年（文本层提取）
  landmarks?: Landmark[]       // ⭐ 周边地标距离（文本层提取）
}

/**
 * Build the submit/update payload from form data — single source of truth
 * shared by the upload page, the admin task review page and the property
 * edit page (POST /submit and PUT /:id accept the same shape).
 */
export function buildSubmitPayload(formData: PropertyFormData) {
  const visibleProjectImages = (formData.projectImages || []).filter(
    img => !(formData.hiddenProjectImages || []).includes(img)
  )
  const visibleFloorPlanImages = (formData.floorPlanImages || []).filter(
    img => !(formData.hiddenFloorPlanImages || []).includes(img)
  )

  return {
    projectName: formData.projectName,
    developer: formData.developer,
    address: formData.address,
    area: formData.area,
    description: formData.description,
    latitude: formData.latitude,
    longitude: formData.longitude,
    launchDate: formData.launchDate || null,
    completionDate: formData.completionDate || null,
    handoverDate: formData.handoverDate || null,
    constructionProgress: formData.constructionProgress,
    status: formData.status || 'upcoming',
    projectImages: visibleProjectImages,
    floorPlanImages: visibleFloorPlanImages,
    primaryImage: formData.primaryImage || null,
    amenities: formData.amenities || [],
    visualContent: formData.visualContent,
    unitTypes: formData.unitTypes.map(unit => ({
      id: unit.id,  // PUT update matches existing units by id; POST submit ignores it
      name: unit.name,
      typeName: unit.typeName,
      category: unit.category,
      unitNumbers: unit.unitNumbers,
      unitCount: unit.unitCount || 1,
      bedrooms: unit.bedrooms,
      bathrooms: unit.bathrooms,
      area: unit.area,
      suiteArea: unit.suiteArea,
      balconyArea: unit.balconyArea,
      price: unit.price,
      pricePerSqft: unit.pricePerSqft,
      orientation: unit.orientation,
      features: unit.features,
      description: unit.description,
      floorPlanImage: unit.floorPlanImage,
      floorPlanImages: unit.floorPlanImages,
      renderingImages: unit.renderingImages,
      interiorImages: unit.interiorImages,
      balconyImages: unit.balconyImages,
      parkingSpaces: unit.parkingSpaces,
    })),
    paymentPlan: formData.paymentPlan || [],
    serviceCharge: formData.serviceCharge ?? null,
    landmarks: formData.landmarks || [],
  }
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
