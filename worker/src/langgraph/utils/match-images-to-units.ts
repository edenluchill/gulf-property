/**
 * Match Floor Plan Images to Units
 * 
 * Associates floor plan images with their corresponding unit types
 */

interface ImageWithPage {
  pageNumber?: number;
  imagePath: string;
  category?: string;
}

type ImageInput = string | ImageWithPage;

interface UnitWithPage {
  id: string;
  typeName: string;
  pageNumber?: number;
  [key: string]: any;
}

/**
 * Match floor plan images to units based on page numbers
 * 
 * Strategy:
 * 1. Units extracted from page N get the floor plan image from page N
 * 2. If multiple units on same page, they share the same image
 * 3. Fallback: distribute images evenly if page info missing
 */
export function matchImagesToUnits(
  units: UnitWithPage[],
  images: ImageInput[]
): UnitWithPage[] {
  if (!images || images.length === 0) {
    return units;
  }

  // Normalize images to ImageWithPage format
  const normalizedImages: ImageWithPage[] = images.map((img, index) => {
    if (typeof img === 'string') {
      return { imagePath: img, pageNumber: index + 1 };
    }
    return img;
  });

  // Create map: pageNumber → imagePath
  const pageToImageMap = new Map<number, string>();
  normalizedImages.forEach(img => {
    if (img.pageNumber) {
      pageToImageMap.set(img.pageNumber, img.imagePath);
    }
  });

  console.log(`\n🔗 Matching ${normalizedImages.length} images to ${units.length} units...`);

  // Try to match by page number
  const matched = units.map((unit, index) => {
    // Strategy 1: Match by explicit pageNumber
    if (unit.pageNumber && pageToImageMap.has(unit.pageNumber)) {
      const floorPlanImage = pageToImageMap.get(unit.pageNumber)!;
      console.log(`   ✓ Unit ${unit.typeName}: page ${unit.pageNumber} → ${floorPlanImage.split('/').pop()}`);
      return {
        ...unit,
        floorPlanImage,
      };
    }

    // Strategy 2: Fallback - distribute images evenly
    const imageIndex = Math.floor((index / units.length) * normalizedImages.length);
    if (normalizedImages[imageIndex]) {
      const floorPlanImage = normalizedImages[imageIndex].imagePath;
      console.log(`   ≈ Unit ${unit.typeName}: fallback → ${floorPlanImage.split('/').pop()}`);
      return {
        ...unit,
        floorPlanImage,
      };
    }

    return unit;
  });

  const matchedCount = matched.filter(u => u.floorPlanImage).length;
  console.log(`\n📊 Matched ${matchedCount}/${units.length} units with images\n`);

  return matched;
}

/**
 * Add page numbers to units based on extraction context
 * Call this during unit extraction to track which page each unit came from
 */
export function tagUnitsWithPageNumbers(
  units: any[],
  pageNumber: number
): any[] {
  return units.map(unit => ({
    ...unit,
    pageNumber,  // Tag with source page
  }));
}
