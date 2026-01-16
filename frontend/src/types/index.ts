// Off-plan property interface matching backend
export interface OffPlanProperty {
  id: string
  
  // Building information
  buildingId?: number
  buildingName: string
  projectName: string
  buildingDescription?: string
  
  // Developer information
  developer: string
  developerId?: number
  developerLogoUrl?: string
  
  // Location
  location: {
    lat: number
    lng: number
  }
  areaName: string
  areaId?: number
  dldLocationId?: number
  
  // Bedroom configuration
  minBedrooms: number
  maxBedrooms: number
  bedsDescription?: string
  
  // Size (square feet)
  minSize?: number
  maxSize?: number
  
  // Pricing
  startingPrice?: number
  medianPriceSqft?: number
  medianPricePerUnit?: number
  medianRentPerUnit?: number
  
  // Project status and timeline
  launchDate?: string
  completionDate?: string
  completionPercent: number
  status: 'upcoming' | 'under-construction' | 'completed'
  
  // Units
  unitCount?: number
  buildingUnitCount?: number
  
  // Sales data
  salesVolume?: number
  propSalesVolume?: number
  
  // Media and marketing
  images: string[]
  logoUrl?: string
  brochureUrl?: string
  amenities: string[]
  
  // Metadata
  displayAs?: string
  verified: boolean
  createdAt?: string
  updatedAt?: string
}

// Map bounds for viewport queries
export interface MapBounds {
  minLng: number
  minLat: number
  maxLng: number
  maxLat: number
}

// Search and filter interfaces
export interface PropertyFilters {
  // Geographic bounds for map viewport
  bounds?: MapBounds
  
  // Filters
  developer?: string
  project?: string
  area?: string
  minPrice?: number
  maxPrice?: number
  minPriceSqft?: number
  maxPriceSqft?: number
  minBedrooms?: number
  maxBedrooms?: number
  minSize?: number
  maxSize?: number
  launchDateStart?: string
  launchDateEnd?: string
  completionDateStart?: string
  completionDateEnd?: string
  minCompletionPercent?: number
  maxCompletionPercent?: number
  status?: 'upcoming' | 'under-construction' | 'completed'
  amenities?: string[]
  
  // Search
  searchQuery?: string
  
  // Pagination
  limit?: number
  offset?: number
}

export interface PropertySearchResult {
  properties: OffPlanProperty[]
  total: number
  bounds?: MapBounds
}

// Legacy Project interface (for backward compatibility during transition)
export interface Project {
  id: string
  name: string
  developer: string
  location: {
    lat: number
    lng: number
    address: string
    district: string
  }
  price: {
    min: number
    max: number
  }
  units: number
  completionDate: string
  status: 'upcoming' | 'under-construction' | 'completed'
  images: string[]
  description: string
  features: string[]
  floorPlans: FloorPlan[]
  paymentPlan: PaymentPlan
  amenities: string[]
}

export interface FloorPlan {
  id: string
  name: string
  bedrooms: number
  bathrooms: number
  area: number
  price: number
  image?: string
}

export interface PaymentPlan {
  downPayment: number
  duringConstruction: number
  onHandover: number
  installments?: {
    percentage: number
    period: string
  }[]
}

// Legacy Filters interface
export interface Filters {
  developer?: string
  district?: string
  priceRange?: {
    min: number
    max: number
  }
  completionDate?: {
    start: string
    end: string
  }
}

// Dubai areas and landmarks
export interface DubaiArea {
  id: string
  name: string
  nameAr?: string
  boundary: GeoJSON.Geometry  // GeoJSON Polygon
  areaType?: string
  wealthLevel?: string
  culturalAttribute?: string
  description?: string
  descriptionAr?: string
  color: string
  opacity: number
  displayOrder: number
}

export interface DubaiLandmark {
  id: string
  name: string
  nameAr?: string
  location: {
    lat: number
    lng: number
  }
  landmarkType: string
  iconName: string
  description?: string
  descriptionAr?: string
  yearBuilt?: number
  websiteUrl?: string
  imageUrl?: string
  color: string
  size: 'small' | 'medium' | 'large'
  displayOrder: number
}