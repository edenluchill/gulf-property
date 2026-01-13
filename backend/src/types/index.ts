// Off-plan property interface matching the new database schema
export interface OffPlanProperty {
  id: string
  
  // Building information
  building_id?: number
  building_name: string
  project_name: string
  building_description?: string
  
  // Developer information
  developer: string
  developer_id?: number
  developer_logo_url?: string
  
  // Location
  location: {
    lat: number
    lng: number
  }
  area_name: string
  area_id?: number
  dld_location_id?: number
  
  // Bedroom configuration
  min_bedrooms: number
  max_bedrooms: number
  beds_description?: string
  
  // Size (square feet)
  min_size?: number
  max_size?: number
  
  // Pricing
  starting_price?: number
  median_price_sqft?: number
  median_price_per_unit?: number
  median_rent_per_unit?: number
  
  // Project status and timeline
  launch_date?: string
  completion_date?: string
  completion_percent: number
  status: 'upcoming' | 'under-construction' | 'completed'
  
  // Units
  unit_count?: number
  building_unit_count?: number
  
  // Sales data
  sales_volume?: number
  prop_sales_volume?: number
  
  // Media and marketing
  images: string[]
  logo_url?: string
  brochure_url?: string
  amenities: string[]
  
  // Metadata
  display_as?: string
  verified: boolean
  created_at?: Date
  updated_at?: Date
}

// Raw data from dubai_off_plan_datapoint.json
export interface DubaiOffPlanDataPoint {
  building_id: number
  building: string
  display_as: string
  building_csv: any[]
  area_name: string
  area_id: number
  building_coordinates: string
  dev: string
  dev_id: number
  developer_logo_url: string
  unit_count: number | null
  launch_date: string
  completion_percent: number
  completion_date: string
  project: string
  logo_url: string | null
  brochure_url: string | null
  amenities: string[]
  images: string[]
  building_description: string | null
  beds: string
  min_bed: number
  max_bed: number
  building_unit_count: number | null
  building_min_size: number
  building_max_size: number
  building_starting_price: number
  building_median_price_sqft: number
  building_sales_volume: number
  prop_sales_volume: number
  prop_median_price_sqft: number
  prop_median_price_per_unit: number
  prop_median_rent_per_unit: number
  dld_location_id: number
  coordinates: [number, number] // [lng, lat]
}

// Search and filter interfaces
export interface PropertySearchFilters {
  // Geographic bounds for map viewport
  bounds?: {
    minLng: number
    minLat: number
    maxLng: number
    maxLat: number
  }
  
  // Filters
  developer?: string
  area?: string
  minPrice?: number
  maxPrice?: number
  minBedrooms?: number
  maxBedrooms?: number
  completionDateStart?: string
  completionDateEnd?: string
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
  bounds?: {
    minLng: number
    minLat: number
    maxLng: number
    maxLat: number
  }
}

// Legacy Project interface (kept for backward compatibility)
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
  completion_date: string
  status: 'upcoming' | 'under-construction' | 'completed'
  images: string[]
  description: string
  features: string[]
  floor_plans: FloorPlan[]
  payment_plan: PaymentPlan
  amenities: string[]
  created_at?: Date
  updated_at?: Date
  verified: boolean
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
  down_payment: number
  during_construction: number
  on_handover: number
  installments?: {
    percentage: number
    period: string
  }[]
}

export interface ProjectFilters {
  developer?: string
  district?: string
  minPrice?: number
  maxPrice?: number
  completionDateStart?: string
  completionDateEnd?: string
  status?: string
}

export interface DeveloperSubmission {
  project_name: string
  developer_name: string
  location: string
  district: string
  min_price: number
  max_price: number
  completion_date: string
  contact_email: string
  contact_phone: string
  description: string
  verified: boolean
  created_at?: Date
}
