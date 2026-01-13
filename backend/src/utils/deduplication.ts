/**
 * Advanced Deduplication Utilities
 * 
 * Handles duplicate detection across multiple PDF chunks
 */

/**
 * Generate unique key for unit type
 * 
 * Strategy: Use multiple fields to create composite key
 */
export function generateUnitKey(unit: any): string {
  // Normalize category
  const category = unit.category || `${unit.bedrooms || 0}BR`;
  
  // Normalize type name
  const typeName = (unit.typeName || unit.name || 'default')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_');
  
  // Round area to nearest 10 sqft (handles small variations)
  const areaRounded = unit.area ? Math.floor(unit.area / 10) * 10 : 0;
  
  // Composite key
  const key = `${category}_${typeName}_${areaRounded}sqft`;
  
  return key;
}

/**
 * Advanced unit deduplication with smart merging
 */
export function deduplicateUnits(units: any[]): any[] {
  const unitMap = new Map<string, any>();

  for (const unit of units) {
    const key = generateUnitKey(unit);
    
    if (!unitMap.has(key)) {
      // First occurrence - add with generated ID
      unitMap.set(key, {
        ...unit,
        id: key,
        _key: key, // Store key for debugging
      });
    } else {
      // Duplicate found - merge intelligently
      const existing = unitMap.get(key)!;
      
      // Merge unit numbers (deduplicate)
      if (unit.unitNumbers || existing.unitNumbers) {
        const merged = [
          ...(existing.unitNumbers || []),
          ...(unit.unitNumbers || [])
        ];
        existing.unitNumbers = [...new Set(merged)].sort();
      }
      
      // Add unit counts
      if (unit.unitCount != null) {
        existing.unitCount = (existing.unitCount || 0) + unit.unitCount;
      }
      
      // Merge features
      if (unit.features || existing.features) {
        const merged = [
          ...(existing.features || []),
          ...(unit.features || [])
        ];
        existing.features = [...new Set(merged)];
      }
      
      // Prefer non-null values for other fields
      Object.entries(unit).forEach(([field, value]) => {
        if (value != null && (existing[field] == null || existing[field] === '')) {
          existing[field] = value;
        }
      });
      
      // Update orientation (prefer longer/more detailed)
      if (unit.orientation && (!existing.orientation || unit.orientation.length > existing.orientation.length)) {
        existing.orientation = unit.orientation;
      }
      
      // Average prices if both exist
      if (unit.price && existing.price && unit.price !== existing.price) {
        existing.price = Math.round((existing.price + unit.price) / 2);
      } else if (unit.price) {
        existing.price = unit.price;
      }
    }
  }

  return Array.from(unitMap.values());
}

/**
 * Deduplicate amenities (case-insensitive)
 */
export function deduplicateAmenities(amenities: string[]): string[] {
  const normalized = new Map<string, string>();
  
  amenities.forEach(amenity => {
    const key = amenity.toLowerCase().trim();
    if (!normalized.has(key)) {
      normalized.set(key, amenity); // Keep original case
    }
  });
  
  return Array.from(normalized.values());
}

/**
 * Select best payment plan from duplicates
 */
export function deduplicatePaymentPlans(plans: any[]): any[] {
  if (plans.length === 0) return [];
  if (plans.length === 1) return plans;
  
  // Score each plan
  const scored = plans.map(plan => ({
    plan,
    score: calculatePaymentPlanScore(plan),
  }));
  
  // Sort by score (highest first)
  scored.sort((a, b) => b.score - a.score);
  
  // Return top plan
  return [scored[0].plan];
}

/**
 * Score payment plan completeness
 */
function calculatePaymentPlanScore(plan: any): number {
  let score = 0;
  
  // Has milestones
  if (plan.milestones && plan.milestones.length > 0) {
    score += plan.milestones.length * 10; // More milestones = better
  }
  
  // Percentages add up to 100
  if (plan.totalPercentage && Math.abs(plan.totalPercentage - 100) < 5) {
    score += 50;
  }
  
  // Has dates
  const milestonesWithDates = plan.milestones?.filter((m: any) => m.date)?.length || 0;
  score += milestonesWithDates * 5;
  
  return score;
}

/**
 * Sort units by category and type for consistent display order
 */
export function sortUnits(units: any[]): any[] {
  const categoryOrder = ['Studio', '1BR', '2BR', '3BR', '4BR', '5BR', 'Penthouse', 'Duplex', 'Townhouse'];
  
  return units.sort((a, b) => {
    // First sort by category
    const catA = a.category || `${a.bedrooms}BR`;
    const catB = b.category || `${b.bedrooms}BR`;
    
    const orderA = categoryOrder.indexOf(catA);
    const orderB = categoryOrder.indexOf(catB);
    
    if (orderA !== orderB) {
      return (orderA === -1 ? 999 : orderA) - (orderB === -1 ? 999 : orderB);
    }
    
    // Then sort by typeName
    const typeA = (a.typeName || a.name || '').toLowerCase();
    const typeB = (b.typeName || b.name || '').toLowerCase();
    
    return typeA.localeCompare(typeB);
  });
}
