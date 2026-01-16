/**
 * TypeScript types for Residential Projects
 * Matches the database schema: residential-projects-schema.sql
 */

export interface ResidentialProject {
  id: string
  
  // Basic Information
  project_name: string
  developer: string
  address: string
  area: string
  description?: string
  
  // Location
  latitude?: number
  longitude?: number
  
  // Project Timeline
  launch_date?: string
  completion_date?: string
  handover_date?: string
  construction_progress?: string
  
  // Status
  status: 'upcoming' | 'under-construction' | 'completed' | 'handed-over'
  
  // Pricing Summary
  min_price?: number
  max_price?: number
  starting_price?: number
  
  // Unit Summary
  total_unit_types: number
  total_units: number
  min_bedrooms?: number
  max_bedrooms?: number
  
  // Media
  project_images: string[]
  floor_plan_images: string[]
  brochure_url?: string
  
  // Visual Content Metadata
  has_renderings: boolean
  has_floor_plans: boolean
  has_location_maps: boolean
  rendering_descriptions: string[]
  floor_plan_descriptions: string[]
  
  // Amenities
  amenities: string[]
  
  // Metadata
  verified: boolean
  featured: boolean
  views_count: number
  
  // Timestamps
  created_at: string
  updated_at: string
}

export interface ProjectUnitType {
  id: string
  project_id: string
  
  // Unit Identification
  unit_type_name: string
  category?: string
  type_code?: string
  tower?: string
  
  // Unit Numbers
  unit_numbers: string[]
  unit_count: number
  
  // Room Configuration
  bedrooms: number
  bathrooms: number
  
  // Size (square feet)
  area: number
  balcony_area?: number
  built_up_area?: number
  
  // Pricing
  price?: number
  price_per_sqft?: number
  
  // Unit Details
  orientation?: string
  floor_level?: string
  view_type?: string
  
  // Features
  features: string[]
  
  // Media
  floor_plan_image?: string
  unit_images: string[]
  
  // Display
  display_order: number
  
  // Timestamps
  created_at: string
  updated_at: string
}

export interface ProjectPaymentPlan {
  id: string
  project_id: string
  
  milestone_name: string
  percentage: number
  milestone_date?: string
  display_order: number
  description?: string
  
  created_at: string
}

// ============================================================================
// Frontend submission types (from DeveloperPropertyUploadPageV2)
// ============================================================================

export interface SubmitProjectRequest {
  // Basic info
  projectName: string
  developer: string
  address: string
  area: string
  description?: string
  
  // Location
  latitude?: number
  longitude?: number
  
  // Timeline
  launchDate?: string
  completionDate?: string
  handoverDate?: string
  constructionProgress?: string
  
  // Media
  projectImages?: string[]
  floorPlanImages?: string[]
  amenities: string[]
  
  // Visual content metadata
  visualContent?: {
    hasRenderings?: boolean
    hasFloorPlans?: boolean
    hasLocationMaps?: boolean
    renderingDescriptions?: string[]
    floorPlanDescriptions?: string[]
  }
  
  // Unit types
  unitTypes: SubmitUnitType[]
  
  // Payment plan
  paymentPlan: SubmitPaymentMilestone[]
}

export interface SubmitUnitType {
  // From frontend
  id?: string  // Frontend temp ID
  name: string
  typeName?: string
  category?: string
  tower?: string
  
  // Unit numbers
  unitNumbers?: string[]
  unitCount?: number
  
  // Configuration
  bedrooms: number
  bathrooms: number
  
  // Size
  area: number
  balconyArea?: number
  
  // Pricing
  price?: number
  pricePerSqft?: number
  
  // Details
  orientation?: string
  features?: string[]
  
  // Media
  floorPlanImage?: string
}

export interface SubmitPaymentMilestone {
  milestone: string
  percentage: number
  date?: string
}

// ============================================================================
// API Response types
// ============================================================================

export interface SubmitProjectResponse {
  success: boolean
  projectId: string
  message: string
}

export interface GetProjectResponse {
  project: ResidentialProject
  unitTypes: ProjectUnitType[]
  paymentPlan: ProjectPaymentPlan[]
}

export interface ListProjectsResponse {
  projects: ResidentialProject[]
  total: number
  page: number
  limit: number
}
