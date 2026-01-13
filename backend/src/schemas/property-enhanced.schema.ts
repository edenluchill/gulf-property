/**
 * Enhanced Property Schema with Image Extraction
 */

import { z } from 'zod';

/**
 * Enhanced Unit Type with grouping and images
 */
export const EnhancedUnitTypeSchema = z.object({
  // Unit category (大类)
  category: z.enum(['Studio', '1BR', '2BR', '3BR', '4BR', '5BR', 'Penthouse', 'Duplex', 'Townhouse']),
  
  // Specific type within category (e.g., "Type A", "Type B")
  typeName: z.string().optional(), // e.g., "Type A", "Corner Unit"
  
  // Unit numbers (optional)
  unitNumbers: z.array(z.string()).optional(), // e.g., ["101", "201", "301"]
  unitCount: z.number().int().positive().optional(), // Total units of this type
  
  // Specifications
  bedrooms: z.number().int().min(0),
  bathrooms: z.number().min(0),
  area: z.number().positive(), // in sqft
  areaUnit: z.enum(['sqft', 'sqm']).default('sqft'),
  
  // Pricing
  price: z.number().positive().optional(),
  pricePerSqft: z.number().positive().optional(),
  
  // Features
  orientation: z.string().optional(), // e.g., "North-facing", "Sea view"
  balconyArea: z.number().optional(),
  terraceArea: z.number().optional(),
  features: z.array(z.string()).optional(), // ["Walk-in closet", "Maid's room"]
  
  // Images
  floorPlanImage: z.string().optional(), // Base64 or URL
  renderingImage: z.string().optional(), // 3D rendering
  viewImage: z.string().optional(), // View from unit
});

export type EnhancedUnitType = z.infer<typeof EnhancedUnitTypeSchema>;

/**
 * Extracted Images with Categories
 */
export const ExtractedImagesSchema = z.object({
  coverImages: z.array(z.string()).default([]), // Base64 images
  floorPlans: z.array(z.string()).default([]),
  renderings: z.array(z.string()).default([]),
  amenityImages: z.array(z.string()).default([]),
  locationMaps: z.array(z.string()).default([]),
  otherImages: z.array(z.string()).default([]),
});

export type ExtractedImages = z.infer<typeof ExtractedImagesSchema>;

/**
 * Enhanced Building Data
 */
export const EnhancedBuildingDataSchema = z.object({
  name: z.string().min(1),
  developer: z.string().min(1),
  address: z.string(),
  area: z.string().optional(),
  
  // Dates
  completionDate: z.string().optional(),
  launchDate: z.string().optional(),
  
  // Description
  description: z.string().optional(),
  amenities: z.array(z.string()).default([]),
  
  // Units - grouped by category
  units: z.array(EnhancedUnitTypeSchema).default([]),
  
  // Payment plans
  paymentPlans: z.array(z.any()).default([]),
  
  // Images
  images: ExtractedImagesSchema.optional(),
  
  // Stats
  minPrice: z.number().positive().optional(),
  maxPrice: z.number().positive().optional(),
  minArea: z.number().positive().optional(),
  maxArea: z.number().positive().optional(),
});

export type EnhancedBuildingData = z.infer<typeof EnhancedBuildingDataSchema>;
