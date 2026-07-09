/**
 * 页面分析Agent（重构版）
 *
 * ⭐ TWO-STAGE OPTIMIZATION:
 * 1. Phase 1: Lightweight classification (page-classifier)
 * 2. Phase 2: Conditional detailed extraction (unit-detail-extractor)
 *
 * ⭐ MULTI-UNIT SUPPORT:
 * - Detects pages with multiple floor plans
 * - Crops individual regions and uploads to R2
 * - Extracts each unit separately
 *
 * Benefits:
 * - 60-70% token reduction
 * - Faster processing for non-unit pages
 * - More focused extraction for unit pages
 * - Accurate multi-unit extraction via cropping
 */

import sharp from 'sharp';
import {
  PageMetadata,
  PageType,
  ImageCategory,
  PageImage,
  UnitPageInfo,
} from '../types/page-metadata';
import type { ImageUrls } from '../../services/r2-storage';
import { uploadToPdfCache } from '../../services/r2-storage';
import { generateImageVariantsFromBuffer, IMAGE_VARIANTS } from '../../utils/pdf/image-processor';
import { classifyPage, type ClassificationResult } from './page-classifier.agent';
import { extractUnitDetails } from './unit-detail-extractor.agent';
import { extractAmenities } from './amenity-extractor.agent';
import { extractProjectInfo } from './project-info-extractor.agent';
import { extractPaymentPlan } from './payment-plan-extractor.agent';
import { extractPricing, PricingExtractionResult } from './pricing-extractor.agent';

/**
 * 分析单页，返回完整的PageMetadata
 *
 * ⭐ TWO-STAGE OPTIMIZATION:
 * 1. Lightweight classification (fast, cheap)
 * 2. Conditional detailed extraction (only when needed)
 *
 * ⭐ MULTI-UNIT SUPPORT:
 * - Detects pages with multiple floor plans
 * - Crops individual regions and uploads to R2
 * - Extracts each unit separately
 * - Returns array of PageMetadata (one per unit)
 *
 * @param imageUrl - R2 image URL (for AI analysis via URL)
 * @param pageNumber - Global page number
 * @param pdfSource - PDF file name
 * @param chunkIndex - Chunk index
 * @param jobId - Job ID (optional)
 * @param imageUrls - All variant URLs (original, large, medium, thumbnail)
 * @param pdfHash - PDF hash for R2 cache key (required for multi-unit cropping)
 */
export async function analyzePageWithAI(
  imageUrl: string,
  pageNumber: number,
  pdfSource: string,
  chunkIndex: number,
  _jobId?: string,
  imageUrls?: ImageUrls,
  pdfHash?: string,   // ⭐ 多户型裁剪上传 R2 需要(caller 已传 chunk.pdfHash)
  pageText?: string,  // ⭐ PDF 文本层内容（辅助分类与提取）
  precomputedClassification?: ClassificationResult  // ⭐ 批量分类结果（跳过 Phase 1）
): Promise<PageMetadata | PageMetadata[]> {

  try {
    // ============ Phase 1: Lightweight Classification ============
    // ⚡ 批量分类已覆盖时直接复用；否则单页分类（含降级路径）
    const classification = precomputedClassification
      ?? await classifyPage(imageUrl, pageNumber, pageText);

    // ============ ⭐ 一页多户型(2/4/8 均衡等分)→ 裁成多张,各成独立户型 ============
    if (
      classification.pageType === PageType.UNIT_ANCHOR &&
      classification.multiUnit &&
      pdfHash
    ) {
      try {
        const multi = await buildMultiUnitPages(
          imageUrl, imageUrls, pageNumber, pdfSource, chunkIndex, pdfHash, classification.multiUnit
        );
        if (multi.length > 0) {
          console.log(`   ✂️  Page ${pageNumber}: split into ${multi.length} unit crops (${classification.multiUnit.layout})`);
          return multi;
        }
      } catch (err) {
        // 裁剪失败不阻断:退回单页单户型(下面的常规路径)
        console.warn(`   ⚠️  Multi-unit crop failed on page ${pageNumber}, falling back to single page:`, (err as Error).message);
      }
    }

    // ============ Phase 2: Conditional Detailed Extraction ============
    let unitInfo: UnitPageInfo | undefined = undefined;
    let amenitiesData: { amenities: string[] } | undefined = undefined;
    let projectInfoData: any | undefined = undefined;
    let paymentPlanData: any | undefined = undefined;
    let pricingData: PricingExtractionResult | undefined = undefined;
    
    // ⭐ 根据页面类型，条件提取详细信息（避免重复AI调用）
    const extractionPromises: Promise<any>[] = [];
    
    // 1. Unit details extraction
    if (classification.pageType === PageType.UNIT_ANCHOR && classification.unitTypeName) {
      console.log(`   🎯 [PAGE-ANALYZER] Detected unit_anchor: ${classification.unitTypeName} on page ${pageNumber}, scheduling extraction...`);
      extractionPromises.push(
        extractUnitDetails(imageUrl, classification.unitTypeName, pageNumber, pageText)
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
    
    // 1.5 Supplementary unit label for rendering/interior pages ⭐
    // 高端楼书一个户型连续多页效果图，角标带户型名 → 记录标签供 assign-images 按标签归属
    // （不跑 extractUnitDetails，零额外 AI 调用）
    if (
      (classification.pageType === PageType.UNIT_RENDERING ||
       classification.pageType === PageType.UNIT_INTERIOR) &&
      classification.unitTypeName
    ) {
      unitInfo = {
        unitTypeName: classification.unitTypeName,
        unitCategory: classification.unitCategory || undefined,
        hasDetailedSpecs: false,
        hasFloorPlan: false,
        roleInUnit: 'supplementary',
      };
      console.log(`   🏷️  Page ${pageNumber} carries unit label: "${classification.unitTypeName}" (supplementary)`);
    }

    // 2. Amenities extraction ⭐
    // ⚡ OPTIMIZED: Skip AMENITIES_IMAGES - they're photos, not text lists
    // Classifier already identified page type, no need to run text extraction
    if (classification.pageType === PageType.AMENITIES_LIST ||
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
        extractProjectInfo(imageUrl, pageNumber, pageText)
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
    // ⭐ 与 pageType 解耦：一页可同时有价格表+付款计划（如 "Prices and Payment Plan" 单页 PDF）
    if (classification.pageType === PageType.PAYMENT_PLAN || classification.hasPaymentPlan) {
      extractionPromises.push(
        extractPaymentPlan(imageUrl, pageNumber, pageText)
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

    // 5. Pricing table extraction ⭐
    if (classification.pageType === PageType.PRICING_TABLE || classification.hasPricingTable) {
      // ⭐ 从当前页面的 section 上下文获取 building
      const currentBuilding = extractBuildingFromClassification(classification);
      if (currentBuilding) {
        console.log(`   🏢 [PAGE-ANALYZER] Building context for pricing: ${currentBuilding}`);
      }

      extractionPromises.push(
        extractPricing(imageUrl, pageNumber, currentBuilding, pageText)  // ⭐ currentBuilding + 文本层辅助
          .then((result: PricingExtractionResult) => {
            if (result.entries.length > 0) {
              pricingData = result;
              console.log(`   💵 Extracted ${result.entries.length} pricing entries inline`);
              if (result.pageBuilding) {
                console.log(`   🏢 Pricing page building: ${result.pageBuilding}`);
              }
            }
          })
          .catch(() => {
            console.warn(`   ⚠️  Failed to extract pricing from page ${pageNumber}`);
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
        classification.shouldUse,
        classification.pageType  // ⭐ 类别未知时按页面类型兜底
      ),
      unitInfo,
      amenitiesData,      // ⭐ 新增：直接包含提取的amenities
      projectInfoData,    // ⭐ 新增：直接包含提取的project info
      paymentPlanData,    // ⭐ 新增：直接包含提取的payment plan
      pricingData,        // ⭐ 新增：价格表数据（用于后处理映射到户型）
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
// 多户型均衡等分裁剪(2/4/8)
// ============================================================

interface Region { x: number; y: number; width: number; height: number }

/**
 * 按 count + layout 把 W×H 整页均衡等分成 count 块,行主序(左→右、上→下)。
 * horizontal=一排 N 列;vertical=一列 N 行;grid=2 行 ×(count/2)列(4=2×2,8=2×4)。
 */
function computeEvenRegions(W: number, H: number, count: number, layout: string): Region[] {
  const regions: Region[] = [];
  if (layout === 'horizontal') {
    const w = Math.floor(W / count);
    for (let i = 0; i < count; i++) regions.push({ x: i * w, y: 0, width: i === count - 1 ? W - i * w : w, height: H });
  } else if (layout === 'vertical') {
    const h = Math.floor(H / count);
    for (let i = 0; i < count; i++) regions.push({ x: 0, y: i * h, width: W, height: i === count - 1 ? H - i * h : h });
  } else {
    // grid: 2 行 × cols 列
    const rows = 2;
    const cols = count / 2;
    const w = Math.floor(W / cols);
    const h = Math.floor(H / rows);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        regions.push({
          x: c * w, y: r * h,
          width: c === cols - 1 ? W - c * w : w,
          height: r === rows - 1 ? H - r * h : h,
        });
      }
    }
  }
  return regions;
}

/** 把一个裁剪 buffer 生成多尺寸变体并上传 R2,返回 ImageUrls。 */
async function uploadCropVariants(
  cropBuffer: Buffer, pdfHash: string, pageNumber: number, cropIndex: number
): Promise<ImageUrls> {
  const variants = await generateImageVariantsFromBuffer(cropBuffer);
  const urls: Partial<ImageUrls> = {};
  for (const v of IMAGE_VARIANTS) {
    const buf = variants.get(v.name);
    if (!buf) continue;
    const filename = `p${pageNumber}_u${cropIndex}_${v.name}.jpg`;
    urls[v.name] = await uploadToPdfCache(buf, pdfHash, filename);
  }
  return urls as ImageUrls;
}

/**
 * 一页多户型 → 裁成 count 张,每张成独立的 UNIT_ANCHOR PageMetadata。
 * 每块并行跑 extractUnitDetails 拿各自 specs(失败退回名字兜底)。
 */
async function buildMultiUnitPages(
  imageUrl: string,
  imageUrls: ImageUrls | undefined,
  pageNumber: number,
  pdfSource: string,
  chunkIndex: number,
  pdfHash: string,
  multiUnit: NonNullable<ClassificationResult['multiUnit']>
): Promise<PageMetadata[]> {
  // 用最高清的原图裁,保证清晰度
  const src = imageUrls?.original || imageUrl;
  const res = await fetch(src);
  if (!res.ok) throw new Error(`fetch original failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const meta = await sharp(buf).metadata();
  const W = meta.width || 0;
  const H = meta.height || 0;
  if (!W || !H) throw new Error('image has no dimensions');

  const regions = computeEvenRegions(W, H, multiUnit.count, multiUnit.layout);

  return Promise.all(regions.map(async (r, i) => {
    // ⭐ 每个 crop 一个微小分数页码(N, N.001, N.002…):PageRegistry 去重、边界范围、
    // assign-images 全按页码比较,分数页码让同页多户型互不覆盖、各自成独立边界/户型;
    // crop0 保持原整数页码(与非多户型页一致);id/文件名仍用整数基页,保持稳定。
    const cropPage = pageNumber + i * 0.001;
    const cropBuf = await sharp(buf)
      .extract({ left: r.x, top: r.y, width: r.width, height: r.height })
      .jpeg({ quality: 90 })
      .toBuffer();
    const cropUrls = await uploadCropVariants(cropBuf, pdfHash, pageNumber, i);

    const u = multiUnit.units[i];
    // 每块单独抽 specs(只喂裁剪图,不喂整页文本以免混入邻块面积表)
    let unitInfo: UnitPageInfo;
    try {
      const details = await extractUnitDetails(cropUrls.large, u.unitTypeName, pageNumber);
      unitInfo = {
        unitTypeName: u.unitTypeName,
        unitCategory: u.unitCategory || deriveCategory(u.unitTypeName),
        hasDetailedSpecs: Object.keys(details.specs || {}).length > 0,
        specs: details.specs,
        features: details.features,
        description: details.description,
        hasFloorPlan: true,
        roleInUnit: 'main',
      };
    } catch {
      unitInfo = {
        unitTypeName: u.unitTypeName,
        unitCategory: u.unitCategory || deriveCategory(u.unitTypeName),
        hasDetailedSpecs: false,
        hasFloorPlan: true,
        roleInUnit: 'main',
      };
    }

    const image: PageImage = {
      imageId: `page_${pageNumber}_u${i}_img_0`,
      imagePath: cropUrls.large,
      imageUrls: cropUrls,
      pageNumber: cropPage,
      category: ImageCategory.FLOOR_PLAN,
      confidence: 0.9,
      shouldUse: true,
      features: { isFullPage: false, hasDimensions: true, hasScale: false },
    };

    const metadata: PageMetadata = {
      pageNumber: cropPage,
      pdfSource,
      chunkIndex,
      pageType: PageType.UNIT_ANCHOR,
      subTypes: [],
      confidence: 0.9,
      content: { textDensity: 'sparse', hasTable: false, hasDiagram: true, hasMarketingText: false, marketingTexts: [] },
      images: [image],
      unitInfo,
      boundaryMarkers: { isSectionStart: false, isSectionEnd: false, isUnitStart: true, isUnitEnd: false, startMarkerText: u.unitTypeName },
      multiUnitSource: {
        originalPageNumber: pageNumber,
        originalImageUrl: src,
        cropIndex: i,
        totalCrops: regions.length,
        bbox: {
          xPercent: (r.x / W) * 100,
          yPercent: (r.y / H) * 100,
          widthPercent: (r.width / W) * 100,
          heightPercent: (r.height / H) * 100,
        },
      },
    };
    return metadata;
  }));
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Extract building/tower context from classification result
 *
 * Looks for building indicators in:
 * 1. boundaryMarkers.startMarkerText (e.g., "TOWER A", "Crestlane 4")
 * 2. Section-style markers that indicate building context
 */
function extractBuildingFromClassification(classification: any): string | undefined {
  // Check boundaryMarkers.startMarkerText
  const markerText = classification.boundaryMarkers?.startMarkerText;
  if (markerText) {
    // Look for tower/building patterns
    const upperText = markerText.toUpperCase();

    // Pattern: "TOWER A", "TOWER B", "TOWER C"
    const towerMatch = upperText.match(/TOWER\s*([A-Z]|\d+)/i);
    if (towerMatch) {
      return `Tower ${towerMatch[1]}`;
    }

    // Pattern: "BUILDING 1", "BUILDING A"
    const buildingMatch = upperText.match(/BUILDING\s*([A-Z]|\d+)/i);
    if (buildingMatch) {
      return `Building ${buildingMatch[1]}`;
    }

    // Pattern: "CRESTLANE 4", "CRESTLANE 5" (specific project names)
    const crestlaneMatch = upperText.match(/CRESTLANE\s*(\d+)/i);
    if (crestlaneMatch) {
      return `Crestlane ${crestlaneMatch[1]}`;
    }

    // Pattern: "PHASE 1", "PHASE 2"
    const phaseMatch = upperText.match(/PHASE\s*(\d+)/i);
    if (phaseMatch) {
      return `Phase ${phaseMatch[1]}`;
    }

    // If the marker text itself looks like a building name (short, uppercase)
    if (markerText.length < 20 && /^[A-Z0-9\s-]+$/.test(markerText.trim())) {
      return markerText.trim();
    }
  }

  return undefined;
}

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
  shouldUse: boolean = true,
  pageType?: PageType
): PageImage[] {

  // Use pre-generated R2 URLs
  const imagePath = imageUrl;

  if (aiImages.length === 0) {
    return [{
      imageId: `page_${pageNumber}_img_0`,
      imagePath,
      imageUrls,
      pageNumber,
      category: fallbackCategoryFromPageType(pageType) ?? ImageCategory.UNKNOWN,
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
  return aiImages.map((img, idx) => {
    let category = mapImageCategory(img.category);
    // ⭐ 类别映射失败时按页面类型兜底，避免户型效果图掉成 UNKNOWN 被项目图库收走
    if (category === ImageCategory.UNKNOWN) {
      category = fallbackCategoryFromPageType(pageType) ?? ImageCategory.UNKNOWN;
    }
    return {
      imageId: `page_${pageNumber}_img_${idx}`,
      imagePath,
      imageUrls,
      pageNumber,
      category,
      confidence: img.confidence || 0.8,
      shouldUse,
      features: {
        isFullPage: img.isFullPage || false,
        hasDimensions: img.hasDimensions || false,
        hasScale: img.hasScale || false,
      },
      aiDescription: img.aiDescription,
      marketingText: img.marketingText,
    };
  });
}

/**
 * 页面类型 → 图片类别兜底
 */
function fallbackCategoryFromPageType(pageType?: PageType): ImageCategory | undefined {
  switch (pageType) {
    case PageType.UNIT_RENDERING: return ImageCategory.UNIT_EXTERIOR;
    case PageType.UNIT_INTERIOR: return ImageCategory.UNIT_INTERIOR_LIVING;
    case PageType.UNIT_ANCHOR:
    case PageType.UNIT_FLOORPLAN_ONLY: return ImageCategory.FLOOR_PLAN;
    case PageType.PROJECT_RENDERING: return ImageCategory.BUILDING_EXTERIOR;
    case PageType.PROJECT_AERIAL: return ImageCategory.BUILDING_AERIAL;
    case PageType.PROJECT_LOCATION_MAP: return ImageCategory.LOCATION_MAP;
    case PageType.PROJECT_MASTER_PLAN: return ImageCategory.MASTER_PLAN;
    case PageType.AMENITIES_IMAGES: return ImageCategory.AMENITY_OTHER;
    default: return undefined;
  }
}

/**
 * 映射图片类别
 */
function mapImageCategory(category: string): ImageCategory {
  const map: Record<string, ImageCategory> = {
    'floor_plan': ImageCategory.FLOOR_PLAN,
    'unit_exterior': ImageCategory.UNIT_EXTERIOR,
    'unit_rendering': ImageCategory.UNIT_EXTERIOR,           // ⭐ 分类器旧词表兼容
    'unit_interior': ImageCategory.UNIT_INTERIOR_LIVING,     // ⭐ 未细分的室内图兜底
    'unit_interior_living': ImageCategory.UNIT_INTERIOR_LIVING,
    'unit_interior_bedroom': ImageCategory.UNIT_INTERIOR_BEDROOM,
    'unit_interior_kitchen': ImageCategory.UNIT_INTERIOR_KITCHEN,
    'unit_interior_bathroom': ImageCategory.UNIT_INTERIOR_BATHROOM,  // ⭐ 之前漏了
    'unit_balcony': ImageCategory.UNIT_BALCONY,
    'building_exterior': ImageCategory.BUILDING_EXTERIOR,
    'project_rendering': ImageCategory.BUILDING_EXTERIOR,
    'project_exterior': ImageCategory.BUILDING_EXTERIOR,
    'building_aerial': ImageCategory.BUILDING_AERIAL,
    'project_aerial': ImageCategory.BUILDING_AERIAL,
    'building_entrance': ImageCategory.BUILDING_ENTRANCE,
    'location_map': ImageCategory.LOCATION_MAP,
    'master_plan': ImageCategory.MASTER_PLAN,
    'amenity_pool': ImageCategory.AMENITY_POOL,
    'amenity_gym': ImageCategory.AMENITY_GYM,
    'amenity_garden': ImageCategory.AMENITY_GARDEN,
    'amenity_lounge': ImageCategory.AMENITY_LOUNGE,
    'amenity': ImageCategory.AMENITY_OTHER,
    'amenity_other': ImageCategory.AMENITY_OTHER,
    'diagram': ImageCategory.DIAGRAM,
    'logo': ImageCategory.LOGO,
    'icon': ImageCategory.ICON,
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
