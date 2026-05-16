/**
 * Voice Assistant Types
 */

// Phase-based state (replaces 7 booleans)
export type VoicePhase = 'idle' | 'connecting' | 'listening' | 'processing' | 'speaking' | 'error'

// Unit type summary
export interface UnitTypeSummary {
  category: string
  bedrooms: number
  minPrice: number
  maxPrice: number
  minAreaSqft: number
  sampleFloorPlan?: string
}

// Project card data from search results
export interface ProjectCard {
  id: string
  name: string
  developer: string
  area: string
  minPrice?: number
  maxPrice?: number
  image?: string
  status?: string
  rentalYield?: number
  priceGrowth?: number
  unitTypes?: UnitTypeSummary[]
}

// Area info card data
export interface AreaInfoCard {
  name: string
  rentalYield?: number
  priceGrowth?: number
  transactionCount?: number
  medianPrice?: number
}

// 5-year investment projection
export interface Investment5yr {
  projectName: string
  purchasePrice: number
  rentalIncome5yr: number
  appreciation5yr: number
  totalProfit5yr: number
  annualizedReturnPct: number
  growthPct: number
}

// Rich content that can be attached to messages
export interface MessageAttachment {
  type: 'projects' | 'area_info' | 'comparison' | 'investment'
  projects?: ProjectCard[]
  areaInfo?: AreaInfoCard
  comparison?: {
    area1: AreaInfoCard
    area2: AreaInfoCard
  }
  investment?: Investment5yr
}

// Transient bubble content (latest assistant message only)
export interface BubbleContent {
  text: string
  attachment?: MessageAttachment
  timestamp: number
}

export interface MapAction {
  type: 'fly_to' | 'highlight_projects' | 'show_pois' | 'toggle_transport' |
        'show_area_info' | 'highlight_areas' | 'navigate' | 'add_favorite' | 'reset' |
        'measure_distance'
  projectIds?: string[]
  lat?: number
  lng?: number
  zoom?: number
  bounds?: { sw: [number, number]; ne: [number, number] }
  category?: string
  radius?: number
  areaId?: string
  areas?: string[]
  show?: boolean
  path?: string
  projectId?: string
  points?: [number, number][]
  distanceKm?: number
  fromName?: string
  toName?: string
}
