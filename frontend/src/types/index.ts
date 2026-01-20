// Residential Project - matches backend residential_projects table
export interface ResidentialProject {
  id: string
  project_name: string
  developer: string
  address: string
  area: string
  description?: string
  latitude: number
  longitude: number
  launch_date?: string
  completion_date?: string
  handover_date?: string
  construction_progress: number | string
  status: 'upcoming' | 'under-construction' | 'completed' | 'handed-over'
  min_price?: number
  max_price?: number
  starting_price?: number
  total_unit_types: number
  total_units: number
  min_bedrooms: number
  max_bedrooms: number
  project_images: string[]
  floor_plan_images: string[]
  brochure_url?: string
  has_renderings: boolean
  has_floor_plans: boolean
  has_location_maps: boolean
  rendering_descriptions: string[]
  floor_plan_descriptions: string[]
  amenities: string[]
  verified: boolean
  featured: boolean
  views_count: number
  created_at: string
  updated_at: string
}

// Unit Type - matches backend unit_types table
export interface UnitType {
  id: string
  project_id: string
  unit_type_name: string
  category: string
  type_code: string
  tower?: string
  unit_numbers: string[]
  unit_count: number
  bedrooms: number
  bathrooms: string
  area: string
  balcony_area?: string
  built_up_area: string
  price?: number
  price_per_sqft?: number
  orientation?: string
  floor_level?: string
  view_type?: string
  features: string[]
  floor_plan_image?: string
  unit_images: string[]
  display_order: number
  description?: string
  created_at: string
  updated_at: string
}

// Payment Plan - matches backend payment_plans table
export interface PaymentPlan {
  id: string
  project_id: string
  milestone_name: string
  percentage: string
  milestone_date?: string
  display_order: number
  description?: string
  interval_months?: number
  interval_description?: string
  created_at: string
}

// API Response for project detail
export interface ProjectDetailResponse {
  success: boolean
  project: ResidentialProject
  units: UnitType[]
  payment_plan: PaymentPlan[]
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
  status?: 'upcoming' | 'under-construction' | 'completed' | 'handed-over'
  amenities?: string[]
  
  // Search
  searchQuery?: string
  
  // Pagination
  limit?: number
  offset?: number
}

export interface PropertySearchResult {
  properties: ResidentialProject[]
  total: number
  bounds?: MapBounds
}

// Dubai areas and landmarks
export interface DubaiArea {
  id: string
  name: string
  nameAr?: string
  boundary: GeoJSON.Geometry  // GeoJSON Polygon
  description?: string
  descriptionAr?: string
  color: string
  opacity: number
  displayOrder: number
  // Area attributes
  areaType?: string
  wealthLevel?: string
  culturalAttribute?: string
  // Market statistics
  projectCounts?: number
  averagePrice?: number
  salesVolume?: number
  capitalAppreciation?: number
  rentalYield?: number
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

// Legacy types for backward compatibility with old components
export interface OffPlanProperty {
  id: string
  buildingId?: number
  buildingName: string
  projectName: string
  buildingDescription?: string
  developer: string
  developerId?: number
  developerLogoUrl?: string
  location: {
    lat: number
    lng: number
  }
  areaName: string
  areaId?: number
  dldLocationId?: string
  minBedrooms: number
  maxBedrooms: number
  bedsDescription?: string
  minSize?: number
  maxSize?: number
  startingPrice?: number
  medianPriceSqft?: number
  medianPricePerUnit?: number
  medianRentPerUnit?: number
  launchDate?: string
  completionDate?: string
  completionPercent?: number
  status: 'upcoming' | 'under-construction' | 'completed'
  unitCount?: number
  buildingUnitCount?: number
  salesVolume?: number
  propSalesVolume?: number
  images: string[]
  logoUrl?: string
  brochureUrl?: string
  amenities: string[]
  displayAs: 'building' | 'project'
  verified: boolean
  createdAt?: string
  updatedAt?: string
}

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
  status: string
  images: string[]
  description: string
  features: string[]
  floorPlans?: {
    id: string
    name: string
    bedrooms: number
    bathrooms: number
    area: number
    price: number
  }[]
  paymentPlan?: {
    downPayment: number
    duringConstruction: number
    onHandover: number
    installments?: {
      percentage: number
      period: string
    }[]
  }
  amenities: string[]
}