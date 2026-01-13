/**
 * Zod Schemas for Property Data Validation
 * 
 * These schemas enforce structured output from AI models
 * and provide type-safe data validation throughout the pipeline
 */

import { z } from 'zod';

/**
 * Page Classification Schema
 */
export const PageCategorySchema = z.enum([
  'Cover',
  'Rendering',
  'FloorPlan',
  'PaymentPlan',
  'LocationMap',
  'GeneralText',
  'Amenities',
  'Unknown'
]);

export type PageCategory = z.infer<typeof PageCategorySchema>;

/**
 * Page Classification Result
 */
export const PageClassificationSchema = z.object({
  category: PageCategorySchema,
  confidence: z.number().min(0).max(1),
  description: z.string(),
  hasTable: z.boolean().optional(),
  hasFloorPlan: z.boolean().optional(),
});

export type PageClassification = z.infer<typeof PageClassificationSchema>;

/**
 * Unit Type Schema (Floor Plan)
 */
export const UnitTypeSchema = z.object({
  id: z.string(),
  name: z.string(), // e.g., "1 BEDROOM", "STUDIO", "2BR TYPE A"
  bedrooms: z.number().int().min(0),
  bathrooms: z.number().min(0),
  area: z.number().positive(), // in sqft
  areaUnit: z.enum(['sqft', 'sqm']).default('sqft'),
  orientation: z.string().optional(), // e.g., "North-facing"
  balconyArea: z.number().optional(),
  price: z.number().positive().optional(),
  // Bounding box for cropping floor plan image
  boundingBox: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }).optional(),
});

export type UnitType = z.infer<typeof UnitTypeSchema>;

/**
 * Payment Plan Schema
 */
export const PaymentMilestoneSchema = z.object({
  milestone: z.string(), // e.g., "Down Payment", "On Handover", "Month 6"
  percentage: z.number().min(0).max(100),
  amount: z.number().positive().optional(),
  date: z.string().optional(), // ISO date or relative like "On Completion"
  description: z.string().optional(),
});

export type PaymentMilestone = z.infer<typeof PaymentMilestoneSchema>;

export const PaymentPlanSchema = z.object({
  milestones: z.array(PaymentMilestoneSchema),
  totalPercentage: z.number().min(0).max(100),
  currency: z.string().default('AED'),
});

export type PaymentPlan = z.infer<typeof PaymentPlanSchema>;

/**
 * Building/Project Core Data
 */
export const BuildingDataSchema = z.object({
  name: z.string().min(1),
  projectName: z.string().optional(),
  developer: z.string().min(1),
  address: z.string(),
  area: z.string().optional(), // District/Area
  city: z.string().default('Dubai'),
  country: z.string().default('UAE'),
  
  // Geo-location
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  
  // Dates
  launchDate: z.string().optional(), // ISO format
  completionDate: z.string().optional(),
  handoverDate: z.string().optional(),
  
  // Description and marketing
  description: z.string().optional(),
  amenities: z.array(z.string()).default([]),
  
  // Units and payment
  units: z.array(UnitTypeSchema).default([]),
  paymentPlans: z.array(PaymentPlanSchema).default([]),
  
  // Pricing summary
  minPrice: z.number().positive().optional(),
  maxPrice: z.number().positive().optional(),
  minArea: z.number().positive().optional(),
  maxArea: z.number().positive().optional(),
  minBedrooms: z.number().int().min(0).optional(),
  maxBedrooms: z.number().int().min(0).optional(),
});

export type BuildingData = z.infer<typeof BuildingDataSchema>;

/**
 * Market Intelligence Data
 */
export const MarketContextSchema = z.object({
  // Nearby infrastructure
  nearbyMetroStations: z.array(z.object({
    name: z.string(),
    distance: z.number(), // in meters
    walkingTime: z.number().optional(), // in minutes
  })).default([]),
  
  // Competitor analysis
  competitorProjects: z.array(z.object({
    name: z.string(),
    developer: z.string(),
    avgPriceSqft: z.number().optional(),
    distance: z.number().optional(),
  })).default([]),
  
  // Area insights
  areaInsights: z.object({
    averagePriceSqft: z.number().optional(),
    priceGrowthYoY: z.number().optional(), // percentage
    demandLevel: z.enum(['High', 'Medium', 'Low']).optional(),
    investmentGrade: z.string().optional(),
  }).optional(),
  
  // Future developments
  governmentPlans: z.array(z.string()).default([]),
  
  // Source URLs
  sources: z.array(z.object({
    title: z.string(),
    url: z.string(),
    snippet: z.string(),
  })).default([]),
});

export type MarketContext = z.infer<typeof MarketContextSchema>;

/**
 * Marketing Content
 */
export const MarketingContentSchema = z.object({
  // Different platforms/styles
  xiaohongshu: z.string().optional(), // 小红书 (lifestyle/emotional)
  twitter: z.string().optional(), // Concise, professional
  investorEmail: z.string().optional(), // Detailed, data-driven
  
  // General content
  headline: z.string(),
  tagline: z.string(),
  highlights: z.array(z.string()),
  investmentHighlights: z.array(z.string()),
});

export type MarketingContent = z.infer<typeof MarketingContentSchema>;

/**
 * Final Analysis Report
 */
export const AnalysisReportSchema = z.object({
  summary: z.string(),
  strengths: z.array(z.string()),
  considerations: z.array(z.string()),
  investmentScore: z.number().min(0).max(10).optional(),
  recommendedFor: z.array(z.string()), // e.g., ["First-time buyers", "Investors"]
  marketComparison: z.string().optional(),
  appreciationPotential: z.enum(['High', 'Medium', 'Low']).optional(),
});

export type AnalysisReport = z.infer<typeof AnalysisReportSchema>;

/**
 * Complete Processed PDF Output
 */
export const ProcessedPdfOutputSchema = z.object({
  buildingData: BuildingDataSchema,
  marketContext: MarketContextSchema.optional(),
  analysisReport: AnalysisReportSchema.optional(),
  marketingContent: MarketingContentSchema.optional(),
  
  // Metadata
  processingTime: z.number().optional(),
  pagesProcessed: z.number().int().positive(),
  imagesExtracted: z.number().int().min(0).default(0),
  errors: z.array(z.string()).default([]),
});

export type ProcessedPdfOutput = z.infer<typeof ProcessedPdfOutputSchema>;
