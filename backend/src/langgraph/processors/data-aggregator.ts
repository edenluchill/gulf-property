/**
 * Data Aggregator Module
 * 
 * Handles merging and aggregation of building data from multiple chunks:
 * - Project/Building basic information
 * - Units (floor plans)
 * - Payment plans
 * - Amenities
 * - Images (project images and floor plan images)
 */

import { deduplicateUnits, deduplicatePaymentPlans, sortUnits } from '../../utils/deduplication';
import { matchImagesToUnits } from '../utils/match-images-to-units';

export interface BuildingImages {
  projectImages: string[];
  floorPlanImages: string[];
  allImages: string[];
}

export interface AggregatedBuildingData {
  name: string;
  developer: string;
  address: string;
  area: string;
  completionDate: string;
  launchDate: string;
  handoverDate?: string;              // ⭐ 新增
  constructionProgress?: number;      // ⭐ Percentage: 0-100
  description: string;
  amenities: string[];
  units: any[];
  paymentPlans: any[];
  towerInfos?: any[];                 // ⭐ 新增：Tower信息
  images: BuildingImages;
}

/**
 * Creates an empty aggregated building data structure
 */
export function createEmptyAggregatedData(): AggregatedBuildingData {
  return {
    name: '',
    developer: '',
    address: '',
    area: '',
    completionDate: '',
    launchDate: '',
    description: '',
    amenities: [],
    units: [],
    paymentPlans: [],
    images: {
      projectImages: [],
      floorPlanImages: [],
      allImages: [],
    },
  };
}

/**
 * Merge project basic information (name, developer, address, etc.)
 * Strategy: Keep first non-empty value for most fields, longest for description
 */
export function mergeProjectInfo(
  aggregated: AggregatedBuildingData,
  chunkData: any
): void {
  // Only set basic info once (first chunk wins)
  if (!aggregated.name && chunkData.name) {
    aggregated.name = chunkData.name;
  }
  if (!aggregated.developer && chunkData.developer) {
    aggregated.developer = chunkData.developer;
  }
  if (!aggregated.address && chunkData.address) {
    aggregated.address = chunkData.address;
  }
  if (!aggregated.area && chunkData.area) {
    aggregated.area = chunkData.area;
  }
  if (!aggregated.completionDate && chunkData.completionDate) {
    aggregated.completionDate = chunkData.completionDate;
  }
  if (!aggregated.launchDate && chunkData.launchDate) {
    aggregated.launchDate = chunkData.launchDate;
  }

  // Description: Choose longest (most detailed)
  if (chunkData.description && 
      (!aggregated.description || chunkData.description.length > aggregated.description.length)) {
    aggregated.description = chunkData.description;
  }
}

/**
 * Merge units from chunk into aggregated data
 */
export function mergeUnits(
  aggregated: AggregatedBuildingData,
  chunkData: any
): void {
  if (chunkData.units && chunkData.units.length > 0) {
    aggregated.units.push(...chunkData.units);
  }
}

/**
 * Merge payment plans from chunk into aggregated data
 */
export function mergePaymentPlans(
  aggregated: AggregatedBuildingData,
  chunkData: any
): void {
  if (chunkData.paymentPlans && chunkData.paymentPlans.length > 0) {
    aggregated.paymentPlans.push(...chunkData.paymentPlans);
  }
}

/**
 * Merge amenities from chunk into aggregated data (unique only)
 */
export function mergeAmenities(
  aggregated: AggregatedBuildingData,
  chunkData: any
): void {
  if (chunkData.amenities && Array.isArray(chunkData.amenities)) {
    chunkData.amenities.forEach((amenity: string) => {
      if (!aggregated.amenities.includes(amenity)) {
        aggregated.amenities.push(amenity);
      }
    });
  }
}

/**
 * Merge images from chunk into aggregated data
 */
export function mergeImages(
  aggregated: AggregatedBuildingData,
  chunkData: any
): void {
  const chunkImages = chunkData.images;
  
  if (!chunkImages) return;

  if (chunkImages.projectImages && Array.isArray(chunkImages.projectImages)) {
    aggregated.images.projectImages.push(...chunkImages.projectImages);
  }
  
  if (chunkImages.floorPlanImages && Array.isArray(chunkImages.floorPlanImages)) {
    aggregated.images.floorPlanImages.push(...chunkImages.floorPlanImages);
  }
  
  if (chunkImages.allImages && Array.isArray(chunkImages.allImages)) {
    aggregated.images.allImages.push(...chunkImages.allImages);
  }
}

/**
 * Merge all data from a chunk result into aggregated building data
 */
export function mergeChunkData(
  aggregated: AggregatedBuildingData,
  chunkData: any
): void {
  if (!chunkData) return;

  mergeProjectInfo(aggregated, chunkData);
  mergeUnits(aggregated, chunkData);
  mergePaymentPlans(aggregated, chunkData);
  mergeAmenities(aggregated, chunkData);
  mergeImages(aggregated, chunkData);
}

/**
 * Perform final deduplication and sorting on aggregated data
 * Returns a clean, finalized building data object
 */
export function finalizeAggregatedData(
  aggregated: AggregatedBuildingData
): any {
  const finalUnits = deduplicateUnits(aggregated.units);
  const sortedUnits = sortUnits(finalUnits);
  const finalPaymentPlans = deduplicatePaymentPlans(aggregated.paymentPlans);

  // ⭐ CRITICAL: Match floor plan images to units (same as getDeduplicatedUnits)
  const allImagesWithPage = aggregated.images.allImages || [];
  const unitsWithImages = matchImagesToUnits(sortedUnits, allImagesWithPage);

  // Calculate min/max price and area
  const unitsWithPrice = finalUnits.filter(u => u.price);
  const unitsWithArea = finalUnits.filter(u => u.area);

  return {
    name: aggregated.name,
    developer: aggregated.developer,
    address: aggregated.address,
    area: aggregated.area,
    completionDate: aggregated.completionDate,
    launchDate: aggregated.launchDate,
    description: aggregated.description,
    amenities: aggregated.amenities,
    units: unitsWithImages,  // ⭐ Use units with matched images
    paymentPlans: finalPaymentPlans,
    images: aggregated.images,
    minPrice: unitsWithPrice.length > 0 
      ? Math.min(...unitsWithPrice.map(u => u.price)) 
      : undefined,
    maxPrice: unitsWithPrice.length > 0
      ? Math.max(...unitsWithPrice.map(u => u.price))
      : undefined,
    minArea: unitsWithArea.length > 0
      ? Math.min(...unitsWithArea.map(u => u.area))
      : undefined,
    maxArea: unitsWithArea.length > 0
      ? Math.max(...unitsWithArea.map(u => u.area))
      : undefined,
  };
}

/**
 * Get deduplicated and sorted units for progress updates
 */
export function getDeduplicatedUnits(aggregated: AggregatedBuildingData): any[] {
  const deduped = deduplicateUnits(aggregated.units);
  const sorted = sortUnits(deduped);
  
  // Match floor plan images to units
  const allImagesWithPage = aggregated.images.allImages || [];
  const withImages = matchImagesToUnits(sorted, allImagesWithPage);
  
  return withImages;
}
