/**
 * Advanced Deduplication Utilities
 * 
 * Handles duplicate detection across multiple PDF chunks
 */

/**
 * Extract building group from unit type name
 * 
 * Supports multiple project types:
 * - Towers: "A-1B-A.1" → "Tower A"
 * - Villas: "DS-V45" → "Villas" (not "Tower DS"!)
 * - Townhouses: "TH-01" → "Townhouses"
 * 
 * Examples:
 *   "A-1B-A.1" → "Tower A" ✅
 *   "B-2BM-A.1" → "Tower B" ✅
 *   "DS-V45" → undefined (Villa project, no tower) ✅
 *   "TH-01" → undefined (Townhouse, no tower) ✅
 */
export function extractBuildingGroupFromTypeName(typeName: string): string | undefined {
  if (!typeName) return undefined;
  
  // 1. Check if it's a Villa/Townhouse (NOT a tower project)
  const lowerName = typeName.toLowerCase();
  if (lowerName.includes('villa') || 
      lowerName.includes('-v') || 
      lowerName.match(/\bv\d+/) ||
      lowerName.includes('townhouse') || 
      lowerName.includes('th-') ||
      lowerName.match(/\bth\d+/)) {
    // This is a villa/townhouse project, no tower grouping
    return undefined;
  }
  
  // 2. Only extract tower if it's SINGLE letter followed by dash
  // This avoids matching "DS-V45" as "Tower DS"
  const patterns = [
    /^([A-Z])-\d/,          // A-1B-A.1 → A (single letter + dash + number)
    /^Type-([A-Z])-/i,      // Type-A-1B-A.1 → A
    /^Type\s+([A-Z])-/i,    // Type A-1B-A.1 → A
  ];
  
  for (const pattern of patterns) {
    const match = typeName.match(pattern);
    if (match && match[1] && match[1].length === 1) {  // Must be single letter!
      return `Tower ${match[1]}`;
    }
  }
  
  return undefined;
}

/**
 * Generate unique key for unit type
 * 
 * Strategy: Extract base name and normalize for deduplication
 * 
 * Normalization rules:
 * - Extract base name before parentheses: "DSTH-M1 (4 BR - MID UNIT)" → "DSTH-M1"
 * - Remove spaces around dashes: "DSTH - M1" → "DSTH-M1"
 * - Case-insensitive: "dsth-m1" → "DSTH-M1"
 * - Remove "Type" prefix
 * 
 * Examples:
 * - "DSTH-M1" → "DSTH-M1"
 * - "DSTH-M1 (4 BR - MID UNIT)" → "DSTH-M1"
 * - "DSTH - M1" → "DSTH-M1"
 * - "dsth-m1" → "DSTH-M1"
 */
export function generateUnitKey(unit: any): string {
  // Use typeName directly as the key (with minimal normalization)
  // Examples: "B-2BM-A.1", "Type-A-1B-A.1", "Studio-S1"
  let typeName = (unit.typeName || unit.name || '').trim();
  
  if (!typeName || typeName === 'default') {
    // Fallback: generate from category + area
    const category = unit.category || `${unit.bedrooms || 0}BR`;
    const area = unit.area ? Math.round(unit.area) : 0;
    return `${category}_${area}sqft`;
  }
  
  // Step 1: Extract base name (before parentheses)
  // "DSTH-M1 (4 BR - MID UNIT)" → "DSTH-M1"
  // "DSTH-E (5 BR-END UNIT) + MAID" → "DSTH-E"
  const parenIndex = typeName.indexOf('(');
  if (parenIndex > 0) {
    typeName = typeName.substring(0, parenIndex).trim();
  }
  
  // Step 2: Normalize the base name
  const cleanName = typeName
    .replace(/^Type\s+/i, '')     // Remove leading "Type "
    .replace(/\s+Type\s+/i, ' ')  // Remove " Type " in middle
    .replace(/\s*-\s*/g, '-')     // "DSTH - M1" → "DSTH-M1" (remove spaces around dashes)
    .replace(/\s+/g, '-')         // Replace remaining spaces with dash
    .toUpperCase()                 // Normalize to uppercase for case-insensitive matching
    .trim();
  
  return cleanName;
}

/**
 * Filter out invalid/summary unit types
 */
export function isValidUnitType(unit: any): boolean {
  const name = (unit.typeName || unit.name || '').toLowerCase();
  
  // Filter out summary/overall entries
  if (name.includes('overall') || 
      name.includes('summary') || 
      name.includes('total') ||
      name === 'default' ||
      name === '') {
    return false;
  }
  
  // Must have basic information
  if (!unit.area || unit.area <= 0) {
    return false;
  }
  
  // Must have bedroom count defined
  if (unit.bedrooms === undefined || unit.bedrooms === null) {
    return false;
  }
  
  return true;
}

/**
 * Advanced unit deduplication with smart merging
 */
export function deduplicateUnits(units: any[]): any[] {
  // First, filter out invalid units
  const validUnits = units.filter(unit => {
    const isValid = isValidUnitType(unit);
    if (!isValid) {
      console.log(`   ⨯ Filtered out invalid unit: ${unit.category} ${unit.typeName || unit.name} (missing data or summary type)`);
    }
    return isValid;
  });
  
  console.log(`\n🔍 Deduplicating ${validUnits.length} valid units (filtered out ${units.length - validUnits.length} invalid)...`);

  const unitMap = new Map<string, any>();

  for (const unit of validUnits) {
    const key = generateUnitKey(unit);
    const buildingGroup = extractBuildingGroupFromTypeName(unit.typeName || unit.name || '');
    
    if (!unitMap.has(key)) {
      // First occurrence - add with generated ID and building group info
      unitMap.set(key, {
        ...unit,
        id: key,
        tower: buildingGroup || unit.tower, // Extract building group from typeName or keep existing
        _key: key, // Store key for debugging
      });
      const groupInfo = buildingGroup ? ` [${buildingGroup}]` : '';
      console.log(`   ✓ New unit: ${unit.category} ${unit.typeName || unit.name} (${unit.area} sqft)${groupInfo} → Key: ${key}`);
    } else {
      console.log(`   ⚠ Duplicate found: ${unit.category} ${unit.typeName || unit.name} (${unit.area} sqft) → Merging...`);
      // Duplicate found - merge intelligently
      const existing = unitMap.get(key)!;
      
      // Prefer cleaner typeName (without extra spaces)
      // "DSTH-M1" is preferred over "DSTH - M1"
      const currentTypeName = unit.typeName || unit.name || '';
      const existingTypeName = existing.typeName || existing.name || '';
      if (currentTypeName.length < existingTypeName.length || 
          (currentTypeName.length === existingTypeName.length && !currentTypeName.includes(' '))) {
        existing.typeName = currentTypeName;
        if (unit.name && !unit.typeName) existing.name = unit.name;
      }
      
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
      
      // Merge floor plan images (collect all images for this unit type)
      if (unit.floorPlanImage || unit.floorPlanImages) {
        const existingImages = existing.floorPlanImages || (existing.floorPlanImage ? [existing.floorPlanImage] : []);
        const newImages = unit.floorPlanImages || (unit.floorPlanImage ? [unit.floorPlanImage] : []);
        const merged = [...existingImages, ...newImages];
        existing.floorPlanImages = [...new Set(merged)]; // Deduplicate
        // Keep single image for backward compatibility
        existing.floorPlanImage = existing.floorPlanImages[0];
      }
      
      // Prefer non-null values for other fields
      Object.entries(unit).forEach(([field, value]) => {
        if (field === 'floorPlanImage' || field === 'floorPlanImages') return; // Already handled
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
 * Sort units by tower, then category, then type name
 */
export function sortUnits(units: any[]): any[] {
  const categoryOrder = ['Studio', '1BR', '2BR', '3BR', '4BR', '5BR', 'Penthouse', 'Duplex', 'Townhouse'];
  
  return units.sort((a, b) => {
    // First sort by tower (Tower A, Tower B, Tower C, then undefined)
    const towerA = a.tower || '';
    const towerB = b.tower || '';
    
    if (towerA !== towerB) {
      // Put units with tower first, alphabetically
      if (!towerA) return 1;
      if (!towerB) return -1;
      return towerA.localeCompare(towerB);
    }
    
    // Then sort by category
    const catA = a.category || `${a.bedrooms}BR`;
    const catB = b.category || `${b.bedrooms}BR`;
    
    const orderA = categoryOrder.indexOf(catA);
    const orderB = categoryOrder.indexOf(catB);
    
    if (orderA !== orderB) {
      return (orderA === -1 ? 999 : orderA) - (orderB === -1 ? 999 : orderB);
    }
    
    // Finally sort by typeName
    const typeA = (a.typeName || a.name || '').toLowerCase();
    const typeB = (b.typeName || b.name || '').toLowerCase();
    
    return typeA.localeCompare(typeB);
  });
}
