/**
 * 页面分析Agent（重构版）
 * 
 * ⭐ TWO-STAGE OPTIMIZATION:
 * 1. Phase 1: Lightweight classification (page-classifier)
 * 2. Phase 2: Conditional detailed extraction (unit-detail-extractor)
 * 
 * Benefits:
 * - 60-70% token reduction
 * - Faster processing for non-unit pages
 * - More focused extraction for unit pages
 */

import { 
  PageMetadata, 
  PageType,
  ImageCategory,
  PageImage,
  UnitPageInfo,
} from '../types/page-metadata';
import type { ImageUrls } from '../../services/r2-storage';
import { classifyPage } from './page-classifier.agent';
import { extractUnitDetails } from './unit-detail-extractor.agent';
import { extractAmenities } from './amenity-extractor.agent';
import { extractProjectInfo } from './project-info-extractor.agent';
import { extractPaymentPlan } from './payment-plan-extractor.agent';

/**
 * 分析单页，返回完整的PageMetadata
 * 
 * ⭐ TWO-STAGE OPTIMIZATION:
 * 1. Lightweight classification (fast, cheap)
 * 2. Conditional detailed extraction (only when needed)
 * 
 * @param imageUrl - R2 image URL (for AI analysis via URL)
 * @param pageNumber - Global page number
 * @param pdfSource - PDF file name
 * @param chunkIndex - Chunk index
 * @param jobId - Job ID (optional)
 * @param imageUrls - All variant URLs (original, large, medium, thumbnail)
 */
export async function analyzePageWithAI(
  imageUrl: string,
  pageNumber: number,
  pdfSource: string,
  chunkIndex: number,
  _jobId?: string,
  imageUrls?: ImageUrls
): Promise<PageMetadata> {
  
  try {
    // ============ Phase 1: Lightweight Classification ============
    const classification = await classifyPage(imageUrl, pageNumber);
    
    // ============ Phase 2: Conditional Detailed Extraction（根据pageType一次性提取）⭐ ============
    let unitInfo: UnitPageInfo | undefined = undefined;
    let amenitiesData: { amenities: string[] } | undefined = undefined;
    let projectInfoData: any | undefined = undefined;
    let paymentPlanData: any | undefined = undefined;
    
    // ⭐ 根据页面类型，条件提取详细信息（避免重复AI调用）
    const extractionPromises: Promise<any>[] = [];
    
    // 1. Unit details extraction
    if (classification.pageType === PageType.UNIT_ANCHOR && classification.unitTypeName) {
      console.log(`   🎯 [PAGE-ANALYZER] Detected unit_anchor: ${classification.unitTypeName} on page ${pageNumber}, scheduling extraction...`);
      extractionPromises.push(
        extractUnitDetails(imageUrl, classification.unitTypeName, pageNumber)
          .then((details: any) => {
            console.log(`   ✅ [PAGE-ANALYZER] Unit details extraction completed for ${classification.unitTypeName}`);
            console.log(`   📊 [PAGE-ANALYZER] Specs: bedrooms=${details.specs?.bedrooms}, area=${details.specs?.area}, bathrooms=${details.specs?.bathrooms}`);
            unitInfo = {
              unitTypeName: classification.unitTypeName!,
              unitCategory: classification.unitCategory || deriveCategory(classification.unitTypeName!),
              hasDetailedSpecs: Object.keys(details.specs).length > 0,
              specs: details.specs,
              features: details.features,
              description: details.description,
              hasFloorPlan: true,
              roleInUnit: 'main',
            };
          })
          .catch((err) => {
            console.warn(`   ⚠️  [PAGE-ANALYZER] Failed to extract unit details for ${classification.unitTypeName}, using basic info`);
            console.error(`   ❌ [PAGE-ANALYZER] Error:`, err);
            unitInfo = {
              unitTypeName: classification.unitTypeName!,
              unitCategory: classification.unitCategory || deriveCategory(classification.unitTypeName!),
              hasDetailedSpecs: false,
              hasFloorPlan: true,
              roleInUnit: 'main',
            };
          })
      );
    }
    
    // 2. Amenities extraction ⭐
    if (classification.pageType === PageType.AMENITIES_LIST || 
        classification.pageType === PageType.AMENITIES_IMAGES ||
        classification.pageType === PageType.TOWER_CHARACTERISTICS) {
      extractionPromises.push(
        extractAmenities(imageUrl, pageNumber)
          .then((amenities: string[]) => {
            if (amenities.length > 0) {
              amenitiesData = { amenities };
              console.log(`   🏊 Extracted ${amenities.length} amenities inline`);
            }
          })
          .catch(() => {
            console.warn(`   ⚠️  Failed to extract amenities from page ${pageNumber}`);
          })
      );
    }
    
    // 3. Project info extraction ⭐
    if (classification.pageType === PageType.PROJECT_COVER ||
        classification.pageType === PageType.PROJECT_OVERVIEW ||
        classification.pageType === PageType.PROJECT_SUMMARY) {
      extractionPromises.push(
        extractProjectInfo(imageUrl, pageNumber)
          .then((info: any) => {
            if (Object.keys(info).length > 0) {
              projectInfoData = info;
              console.log(`   🏗️  Extracted project info inline: ${Object.keys(info).join(', ')}`);
            }
          })
          .catch(() => {
            console.warn(`   ⚠️  Failed to extract project info from page ${pageNumber}`);
          })
      );
    }
    
    // 4. Payment plan extraction ⭐
    if (classification.pageType === PageType.PAYMENT_PLAN) {
      extractionPromises.push(
        extractPaymentPlan(imageUrl, pageNumber)
          .then((plan: any) => {
            if (plan) {
              paymentPlanData = plan;
              console.log(`   💰 Extracted payment plan inline`);
            }
          })
          .catch(() => {
            console.warn(`   ⚠️  Failed to extract payment plan from page ${pageNumber}`);
          })
      );
    }
    
    // ⭐ 并行等待所有提取完成
    if (extractionPromises.length > 0) {
      await Promise.all(extractionPromises);
    }
    
    // ============ Build Final PageMetadata ============
    const metadata: PageMetadata = {
      pageNumber,
      pdfSource,
      chunkIndex,
      pageType: classification.pageType,
      subTypes: [],  // Can be derived from pageType if needed
      confidence: classification.confidence,
      content: {
        textDensity: 'medium',
        hasTable: classification.pageType === PageType.PAYMENT_PLAN || classification.pageType === PageType.PRICING_TABLE,
        hasDiagram: classification.pageType === PageType.UNIT_ANCHOR,
        hasMarketingText: false,
        marketingTexts: [],
      },
      images: buildImages(
        classification.imageInfo ? [classification.imageInfo] : [],  // ⭐ 使用分类器返回的图片信息
        pageNumber,
        imageUrl,
        imageUrls,
        classification.shouldUse
      ),
      unitInfo,
      amenitiesData,      // ⭐ 新增：直接包含提取的amenities
      projectInfoData,    // ⭐ 新增：直接包含提取的project info
      paymentPlanData,    // ⭐ 新增：直接包含提取的payment plan
      boundaryMarkers: {
        isSectionStart: classification.boundaryMarkers?.isSectionStart || false,
        isSectionEnd: false,
        isUnitStart: classification.boundaryMarkers?.isUnitStart || false,
        isUnitEnd: false,
        startMarkerText: classification.boundaryMarkers?.startMarkerText,
      },
    };

    console.log(`   Page ${pageNumber} analyzed: ${metadata.pageType} | Use: ${classification.shouldUse ? 'YES' : 'NO'}`);
    
    return metadata;

  } catch (error) {
    console.error(`   Error analyzing page ${pageNumber}:`, error);
    return createFallback(pageNumber, pdfSource, chunkIndex, imageUrl, imageUrls);
  }
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Derive unit category from unit type name
 */
function deriveCategory(unitTypeName: string): string {
  const name = unitTypeName.toLowerCase();
  if (name.includes('studio') || name.includes('st')) return 'Studio';
  if (name.includes('1b') || name.includes('1-b')) return '1BR';
  if (name.includes('2b') || name.includes('2-b')) return '2BR';
  if (name.includes('3b') || name.includes('3-b')) return '3BR';
  if (name.includes('4b') || name.includes('4-b')) return '4BR';
  if (name.includes('5b') || name.includes('5-b')) return '5BR';
  if (name.includes('penthouse') || name.includes('ph')) return 'Penthouse';
  return 'Unknown';
}

/**
 * 构建图片数组（使用预生成的R2 URLs）
 */
function buildImages(
  aiImages: any[],
  pageNumber: number,
  imageUrl: string,
  imageUrls?: ImageUrls,
  shouldUse: boolean = true
): PageImage[] {
  
  // Use pre-generated R2 URLs
  const imagePath = imageUrl;
  
  if (aiImages.length === 0) {
    return [{
      imageId: `page_${pageNumber}_img_0`,
      imagePath,
      imageUrls,
      pageNumber,
      category: ImageCategory.UNKNOWN,
      confidence: 0.5,
      shouldUse,
      features: {
        isFullPage: true,
        hasDimensions: false,
        hasScale: false,
      },
    }];
  }
  
  // All images use the same R2 URL
  return aiImages.map((img, idx) => ({
    imageId: `page_${pageNumber}_img_${idx}`,
    imagePath,
    imageUrls,
    pageNumber,
    category: mapImageCategory(img.category),
    confidence: img.confidence || 0.8,
    shouldUse,
    features: {
      isFullPage: img.isFullPage || false,
      hasDimensions: img.hasDimensions || false,
      hasScale: img.hasScale || false,
    },
    aiDescription: img.aiDescription,
    marketingText: img.marketingText,
  }));
}

/**
 * 映射图片类别
 */
function mapImageCategory(category: string): ImageCategory {
  const map: Record<string, ImageCategory> = {
    'floor_plan': ImageCategory.FLOOR_PLAN,
    'unit_exterior': ImageCategory.UNIT_EXTERIOR,
    'unit_interior_living': ImageCategory.UNIT_INTERIOR_LIVING,
    'unit_interior_bedroom': ImageCategory.UNIT_INTERIOR_BEDROOM,
    'unit_interior_kitchen': ImageCategory.UNIT_INTERIOR_KITCHEN,
    'unit_balcony': ImageCategory.UNIT_BALCONY,
    'building_exterior': ImageCategory.BUILDING_EXTERIOR,
    'building_aerial': ImageCategory.BUILDING_AERIAL,
    'location_map': ImageCategory.LOCATION_MAP,
    'amenity_pool': ImageCategory.AMENITY_POOL,
    'amenity_gym': ImageCategory.AMENITY_GYM,
    'logo': ImageCategory.LOGO,
  };
  
  return map[category] || ImageCategory.UNKNOWN;
}

/**
 * 创建fallback metadata（AI失败时）
 */
function createFallback(
  pageNumber: number,
  pdfSource: string,
  chunkIndex: number,
  imageUrl: string,
  imageUrls?: ImageUrls
): PageMetadata {
  return {
    pageNumber,
    pdfSource,
    chunkIndex,
    pageType: PageType.UNKNOWN,
    subTypes: [],
    confidence: 0.1,
    content: {
      textDensity: 'medium',
      hasTable: false,
      hasDiagram: false,
      hasMarketingText: false,
    },
    images: [{
      imageId: `page_${pageNumber}_img_0`,
      imagePath: imageUrl,
      imageUrls,
      pageNumber,
      category: ImageCategory.UNKNOWN,
      confidence: 0.1,
      shouldUse: true,  // Conservative: show fallback pages
      features: {
        isFullPage: true,
        hasDimensions: false,
        hasScale: false,
      },
    }],
    boundaryMarkers: {
      isSectionStart: false,
      isSectionEnd: false,
      isUnitStart: false,
      isUnitEnd: false,
    },
  };
}
