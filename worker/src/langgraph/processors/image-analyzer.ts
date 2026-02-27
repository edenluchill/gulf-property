/**
 * Image Analyzer Module
 * 
 * Analyzes and classifies images from PDF pages:
 * - Floor plan images (linked to specific unit types)
 * - Project images (exterior renderings, environment)
 * - Facility images (lobby, gym, amenities)
 * - Location maps
 */

export enum ImageCategory {
  FLOOR_PLAN = 'floor_plan',           // 户型平面图
  UNIT_RENDERING = 'unit_rendering',   // 户型效果图
  PROJECT_EXTERIOR = 'project_exterior', // 项目外观
  PROJECT_ENVIRONMENT = 'project_environment', // 项目环境
  FACILITY = 'facility',               // 建筑内部设施（大厅、健身房等）
  LOCATION_MAP = 'location_map',       // 位置地图
  AMENITY = 'amenity',                 // 配套设施
  COVER = 'cover',                     // 封面
  OTHER = 'other',                     // 其他
}

export interface ImageInfo {
  pageNumber: number;
  imagePath: string;           // Saved image file path
  category: ImageCategory;     // Image classification
  linkedUnitType?: string;     // If it's a floor plan, which unit type it belongs to
  description?: string;        // AI-generated description
  boundingBox?: {              // Image position on page (for future precise cropping)
    x: number;
    y: number;
    width: number;
    height: number;
  };
  confidence?: number;         // Classification confidence (0-1)
}

export interface PageImageAnalysis {
  pageNumber: number;
  hasImages: boolean;
  images: ImageInfo[];
  pageClassification?: string;  // Overall page classification (from existing classifier)
}

/**
 * Classify image category based on page classification and content
 */
export function classifyImageCategory(
  pageClassification: string,
  pageContent?: any
): ImageCategory {
  const classification = pageClassification.toLowerCase();

  // Floor plan pages
  if (classification.includes('floorplan') || classification.includes('floor plan')) {
    return ImageCategory.FLOOR_PLAN;
  }

  // Rendering/exterior pages
  if (classification.includes('rendering')) {
    return ImageCategory.PROJECT_EXTERIOR;
  }

  // Cover pages
  if (classification.includes('cover')) {
    return ImageCategory.COVER;
  }

  // Amenity pages
  if (classification.includes('amenities') || classification.includes('amenity')) {
    return ImageCategory.AMENITY;
  }

  // Location/map pages
  if (classification.includes('map') || classification.includes('location')) {
    return ImageCategory.LOCATION_MAP;
  }

  // Check content for more specific classification
  if (pageContent) {
    const contentStr = JSON.stringify(pageContent).toLowerCase();
    
    if (contentStr.includes('lobby') || 
        contentStr.includes('gym') || 
        contentStr.includes('pool') ||
        contentStr.includes('fitness')) {
      return ImageCategory.FACILITY;
    }
    
    if (contentStr.includes('garden') || 
        contentStr.includes('park') || 
        contentStr.includes('landscape')) {
      return ImageCategory.PROJECT_ENVIRONMENT;
    }
  }

  return ImageCategory.OTHER;
}

/**
 * Link floor plan images to specific unit types
 * Based on page content and extracted unit data
 */
export function linkImagesToUnits(
  images: ImageInfo[],
  extractedUnits: any[]
): ImageInfo[] {
  // If this page has floor plans and extracted units, link them
  const floorPlanImages = images.filter(img => img.category === ImageCategory.FLOOR_PLAN);
  
  if (floorPlanImages.length > 0 && extractedUnits && extractedUnits.length > 0) {
    // Simple heuristic: if there's 1 unit and multiple floor plan images, they all belong to that unit
    // If there are multiple units, try to match by count or leave unlinked
    
    if (extractedUnits.length === 1) {
      const unitType = extractedUnits[0].typeName || extractedUnits[0].name;
      floorPlanImages.forEach(img => {
        img.linkedUnitType = unitType;
        img.description = `Floor plan for ${unitType}`;
      });
    } else if (extractedUnits.length === floorPlanImages.length) {
      // One-to-one mapping
      floorPlanImages.forEach((img, idx) => {
        if (extractedUnits[idx]) {
          const unitType = extractedUnits[idx].typeName || extractedUnits[idx].name;
          img.linkedUnitType = unitType;
          img.description = `Floor plan for ${unitType}`;
        }
      });
    } else {
      // Multiple units, unclear mapping - mark as general floor plans
      floorPlanImages.forEach(img => {
        img.description = 'Floor plan (multiple units on this page)';
      });
    }
  }

  return images;
}

/**
 * Determine if a page should be saved as image
 * Based on image importance and category
 */
export function shouldSavePageAsImage(analysis: PageImageAnalysis): boolean {
  if (!analysis.hasImages) return false;

  // Always save pages with these important image types
  const importantCategories = [
    ImageCategory.FLOOR_PLAN,
    ImageCategory.PROJECT_EXTERIOR,
    ImageCategory.COVER,
  ];

  return analysis.images.some(img => 
    importantCategories.includes(img.category)
  );
}

/**
 * Generate image filename based on category and page
 */
export function generateImageFilename(
  pageNumber: number,
  category: ImageCategory,
  index: number = 0
): string {
  const categoryShort = category.replace('_', '-');
  return `page${pageNumber}_${categoryShort}_${index}.png`;
}
