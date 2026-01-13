/**
 * Manager Agent (Orchestrator & Quality Controller)
 * 
 * Responsibilities:
 * - Validate and quality-check extracted data
 * - Aggregate results from parallel processing
 * - Decide on retries if data is incomplete
 * - Merge duplicate information
 * - Coordinate workflow decisions
 */

import type { BuildingData, UnitType, PaymentPlan } from '../schemas/property.schema';

/**
 * Quality check extracted building data
 * 
 * Returns issues found (empty array if all good)
 */
export function validateBuildingData(data: Partial<BuildingData>): string[] {
  const issues: string[] = [];

  // Critical fields
  if (!data.name || data.name.trim().length === 0) {
    issues.push('Building name is missing or empty');
  }

  if (!data.developer || data.developer.trim().length === 0) {
    issues.push('Developer name is missing or empty');
  }

  if (!data.address || data.address.trim().length < 5) {
    issues.push('Address is missing or too short');
  }

  // Unit data validation
  if (!data.units || data.units.length === 0) {
    issues.push('No unit types extracted - floor plans may be missing');
  }

  // Payment plan validation
  if (!data.paymentPlans || data.paymentPlans.length === 0) {
    issues.push('No payment plan found');
  } else {
    // Check if payment percentages add up
    const plan = data.paymentPlans[0];
    if (plan && Math.abs(plan.totalPercentage - 100) > 5) {
      issues.push(`Payment plan percentages don't add up to 100% (got ${plan.totalPercentage}%)`);
    }
  }

  // Pricing validation
  if (data.minPrice && data.maxPrice && data.minPrice > data.maxPrice) {
    issues.push('Min price is greater than max price');
  }

  return issues;
}

/**
 * Merge duplicate unit types
 * 
 * Removes duplicates based on name similarity
 */
export function mergeDuplicateUnits(units: UnitType[]): UnitType[] {
  if (units.length === 0) return [];

  const merged = new Map<string, UnitType>();

  for (const unit of units) {
    // Normalize unit name for comparison
    const normalizedName = unit.name.toLowerCase().trim();
    
    // Check if we already have a similar unit
    let found = false;
    for (const [key, existingUnit] of merged.entries()) {
      if (key === normalizedName) {
        // Merge data - prefer non-null values
        merged.set(key, {
          ...existingUnit,
          bedrooms: unit.bedrooms ?? existingUnit.bedrooms,
          bathrooms: unit.bathrooms ?? existingUnit.bathrooms,
          area: unit.area ?? existingUnit.area,
          price: unit.price ?? existingUnit.price,
          orientation: unit.orientation ?? existingUnit.orientation,
          balconyArea: unit.balconyArea ?? existingUnit.balconyArea,
          boundingBox: unit.boundingBox ?? existingUnit.boundingBox,
        });
        found = true;
        break;
      }
    }

    if (!found) {
      merged.set(normalizedName, unit);
    }
  }

  return Array.from(merged.values());
}

/**
 * Calculate min/max values from units
 */
export function calculateBuildingStats(
  units: UnitType[]
): Pick<BuildingData, 'minBedrooms' | 'maxBedrooms' | 'minArea' | 'maxArea' | 'minPrice' | 'maxPrice'> {
  if (units.length === 0) {
    return {
      minBedrooms: undefined,
      maxBedrooms: undefined,
      minArea: undefined,
      maxArea: undefined,
      minPrice: undefined,
      maxPrice: undefined,
    };
  }

  const bedrooms = units.map(u => u.bedrooms).filter(b => b !== undefined) as number[];
  const areas = units.map(u => u.area).filter(a => a !== undefined) as number[];
  const prices = units.map(u => u.price).filter(p => p !== undefined) as number[];

  return {
    minBedrooms: bedrooms.length > 0 ? Math.min(...bedrooms) : undefined,
    maxBedrooms: bedrooms.length > 0 ? Math.max(...bedrooms) : undefined,
    minArea: areas.length > 0 ? Math.min(...areas) : undefined,
    maxArea: areas.length > 0 ? Math.max(...areas) : undefined,
    minPrice: prices.length > 0 ? Math.min(...prices) : undefined,
    maxPrice: prices.length > 0 ? Math.max(...prices) : undefined,
  };
}

/**
 * Aggregate building data from multiple sources
 */
export function aggregateBuildingData(
  partialData: Partial<BuildingData>[],
  units: UnitType[],
  paymentPlans: PaymentPlan[]
): Partial<BuildingData> {
  // Merge all partial data (later entries override earlier ones)
  const merged: Partial<BuildingData> = {};

  for (const data of partialData) {
    Object.assign(merged, data);
  }

  // Add units and payment plans
  merged.units = mergeDuplicateUnits(units);
  merged.paymentPlans = paymentPlans;

  // Calculate stats from units
  const stats = calculateBuildingStats(merged.units);
  Object.assign(merged, stats);

  return merged;
}

/**
 * Decide if retry is needed based on data quality
 * 
 * @param data - Building data to check
 * @param currentRetry - Current retry count
 * @param maxRetries - Maximum allowed retries
 * @returns true if should retry
 */
export function shouldRetry(
  data: Partial<BuildingData>,
  currentRetry: number,
  maxRetries: number = 2
): boolean {
  if (currentRetry >= maxRetries) {
    return false; // Max retries reached
  }

  const issues = validateBuildingData(data);
  
  // Retry if critical data is missing
  const criticalIssues = issues.filter(issue => 
    issue.includes('Building name') ||
    issue.includes('Developer name') ||
    issue.includes('No unit types')
  );

  return criticalIssues.length > 0;
}

/**
 * Extract general building info from cover/text pages using AI
 */
export async function extractGeneralInfo(
  _imagePath: string,
  existingData: Partial<BuildingData>
): Promise<Partial<BuildingData>> {
  // This would use Gemini to extract basic info from cover pages
  // Implementation similar to other agents
  
  // For now, return existing data
  return existingData;
}
