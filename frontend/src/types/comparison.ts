// User Profile for personalized AI analysis
export interface UserProfile {
  // Free-form natural language description (preferred for simplicity)
  freeformDescription?: string

  // Basic info
  name?: string
  age?: number
  nationality?: string

  // Family status
  familyStatus?: 'single' | 'couple' | 'family-small' | 'family-large'
  familySize?: number
  hasChildren?: boolean
  childrenAges?: string // e.g., "3, 7, 12"

  // Purchase purpose
  purpose?: 'investment' | 'residence' | 'work' | 'mixed'

  // Investment preferences (if purpose includes investment)
  investmentHorizon?: 'short' | 'medium' | 'long' // <2yr, 2-5yr, >5yr
  riskTolerance?: 'conservative' | 'moderate' | 'aggressive'

  // Residence preferences (if purpose includes residence)
  workLocation?: string // Work location/area
  schoolPreference?: boolean
  commutePriority?: boolean

  // Budget
  budget?: {
    min: number
    max: number
  }

  // Preferences (legacy)
  preferences?: string
  timeline?: string

  // 经纪人模式（自助开通的免费早鸟试用；正式订阅上线后启用计费）
  agent?: {
    activatedAt: number
    name?: string
    agency?: string
    rera?: string
    phone?: string
  }

  // Timestamps
  createdAt: number
  updatedAt: number
}

// Item to compare (project or specific unit type)
export interface ComparisonItem {
  projectId: string
  unitTypeId?: string // If comparing specific unit type
}

// Score for a dimension
export interface AnalysisScore {
  score: number // 0-100
  explanation: string
}

// AI-generated comparison report
export interface ComparisonReport {
  id: string
  createdAt: number
  items: ComparisonItem[]

  // AI generated content
  summary: string
  recommendation: {
    winnerId: string
    winnerIndex: number // 0 or 1
    confidence: 'high' | 'medium' | 'low'
    reasons: string[]
  }

  // Detailed analysis by dimension
  dimensions: {
    investment: { scores: number[]; explanation: string }
    lifestyle: { scores: number[]; explanation: string }
    location: { scores: number[]; explanation: string }
    value: { scores: number[]; explanation: string }
  }

  // Personalized advice for user
  personalizedAdvice: string
}

// Property data for comparison (simplified from ResidentialProject)
export interface ComparisonPropertyData {
  id: string
  projectId: string
  unitTypeId?: string

  // Basic info
  projectName: string
  developer: string
  area: string
  address: string

  // Unit details (if specific unit type)
  unitTypeName?: string
  bedrooms: number
  bathrooms?: string
  size: number // sqft

  // Pricing
  price: number
  pricePerSqft?: number

  // Timeline
  completionDate?: string
  status: string
  constructionProgress?: number

  // Features
  amenities: string[]

  // Payment plan summary
  paymentPlan?: {
    downPayment: number
    duringConstruction: number
    onHandover: number
  }

  // Image
  imageUrl?: string
}

// API request for comparison
export interface CompareAnalyzeRequest {
  items: ComparisonItem[]
  profile: UserProfile
}

// API response for comparison
export interface CompareAnalyzeResponse {
  success: boolean
  report?: ComparisonReport
  error?: string
}
