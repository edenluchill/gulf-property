/**
 * 提取项目整体图片
 * 
 * 策略：
 * - 不在任何户型边界内的图片
 * - 包括所有非户型相关的图片（建筑、风景、配套等）
 * - 宽松收集，用于marketing gallery
 */

import { PageMetadata, PageImage, ImageCategory } from '../types/page-metadata';
import { UnitBoundary, ProjectImages } from '../types/assignment-result';

/**
 * 提取项目整体图片（非户型图片）
 * 
 * 改进：更宽松的收集策略
 * - 不在户型边界内的图片
 * - 户型相关类别也可能是项目图片（如building_exterior）
 * - 所有marketing有用的图片
 */
export function extractProjectImages(
  pages: PageMetadata[],
  boundaries: UnitBoundary[]
): ProjectImages {
  
  console.log('\n🏢 Extracting project images (marketing gallery)...');

  // ⭐ 页码按PDF各自从1开始，范围判断必须带pdfSource
  const isInsideBoundary = (page: PageMetadata) => boundaries.some(b =>
    page.pdfSource === b.pdfSource &&
    page.pageNumber >= b.startPage && page.pageNumber <= b.endPage
  );

  // ⭐ 角标带户型名的效果图页是户型内容，不进项目图库
  const hasUnitLabel = (page: PageMetadata) => page.unitInfo?.roleInUnit === 'supplementary';

  // 策略1: 不在任何户型边界内的页面（排除已被户型标签认领的页）
  const outsideBoundaryPages = pages.filter(page => !isInsideBoundary(page) && !hasUnitLabel(page));

  // 策略2: 即使在边界内，但明确是项目级别的图片
  // ⚠️ 边界内的页只收严格项目类别（UNKNOWN/UNIT_EXTERIOR 不算——那些是户型效果图）
  const projectTypeImages = pages.flatMap(p => {
    const inside = isInsideBoundary(p) || hasUnitLabel(p);
    return p.images.filter(img =>
      inside ? isStrictProjectLevelImage(img.category) : isProjectLevelImage(img.category)
    );
  });
  
  console.log(`   Pages outside unit boundaries: ${outsideBoundaryPages.length}`);
  console.log(`   Project-level images (all pages): ${projectTypeImages.length}`);
  
  // 收集所有项目图片（去重）
  const allProjectImages = [
    ...outsideBoundaryPages.flatMap(p => p.images),
    ...projectTypeImages,
  ];
  
  // ⭐ NEW: Filter out images marked as shouldUse: false
  const usefulImages = allProjectImages.filter(img => img.shouldUse !== false);
  const filteredCount = allProjectImages.length - usefulImages.length;
  
  if (filteredCount > 0) {
    console.log(`   🗑️  Filtered out ${filteredCount} images marked as not useful`);
  }
  
  // 去重（按imageId）
  const uniqueImages = deduplicateByImageId(usefulImages);
  
  console.log(`   Total unique project images: ${uniqueImages.length}`);
  
  // 按类别分组（更宽松）
  const result: ProjectImages = {
    coverImages: extractByCategory(uniqueImages, [ImageCategory.LOGO]),
    aerialImages: extractByCategory(uniqueImages, [ImageCategory.BUILDING_AERIAL]),
    locationMaps: extractByCategory(uniqueImages, [ImageCategory.LOCATION_MAP]),
    masterPlanImages: extractByCategory(uniqueImages, [ImageCategory.MASTER_PLAN]),
    amenityImages: extractByCategory(uniqueImages, [
      ImageCategory.AMENITY_POOL,
      ImageCategory.AMENITY_GYM,
      ImageCategory.AMENITY_GARDEN,
      ImageCategory.AMENITY_LOUNGE,
      ImageCategory.AMENITY_OTHER,
    ]),
    renderingImages: extractByCategory(uniqueImages, [
      ImageCategory.BUILDING_EXTERIOR,
      ImageCategory.BUILDING_ENTRANCE,
      ImageCategory.DIAGRAM,  // ⭐ 添加图表
      ImageCategory.UNKNOWN,  // ⭐ 未分类的也收集（可能是有用的marketing图片）
    ]),
  };
  
  const total = 
    result.coverImages.length +
    result.aerialImages.length +
    result.locationMaps.length +
    result.masterPlanImages.length +
    result.amenityImages.length +
    result.renderingImages.length;
  
  console.log(`   ✅ Categorized ${total}/${uniqueImages.length} project images for marketing gallery`);
  console.log(`      - Cover/Logo: ${result.coverImages.length}`);
  console.log(`      - Aerial/Views: ${result.aerialImages.length}`);
  console.log(`      - Location Maps: ${result.locationMaps.length}`);
  console.log(`      - Master Plans: ${result.masterPlanImages.length}`);
  console.log(`      - Amenities: ${result.amenityImages.length}`);
  console.log(`      - Renderings/Other: ${result.renderingImages.length}`);
  
  return result;
}

/**
 * 判断是否为项目级别图片
 * 
 * ⭐ 策略：宽松收集，避免遗漏项目图片
 * - 明确的项目级别category
 * - UNKNOWN也收集（可能是有价值的项目图片）
 * - UNIT_EXTERIOR也收集（AI可能混淆项目外观和户型外观）
 */
function isProjectLevelImage(category: ImageCategory): boolean {
  const projectCategories = [
    // 项目图片
    ImageCategory.BUILDING_EXTERIOR,
    ImageCategory.BUILDING_AERIAL,
    ImageCategory.BUILDING_ENTRANCE,
    ImageCategory.LOCATION_MAP,
    ImageCategory.MASTER_PLAN,
    ImageCategory.LOGO,
    ImageCategory.DIAGRAM,
    ImageCategory.ICON,  // ⭐ 添加：可能是项目图标
    // 配套设施也算项目级别
    ImageCategory.AMENITY_POOL,
    ImageCategory.AMENITY_GYM,
    ImageCategory.AMENITY_GARDEN,
    ImageCategory.AMENITY_LOUNGE,
    ImageCategory.AMENITY_OTHER,
    // ⭐ 宽松策略：包含可能被误分类的category
    ImageCategory.UNKNOWN,  // ⭐ 关键：很多项目图片可能被分类为UNKNOWN
    ImageCategory.UNIT_EXTERIOR,  // ⭐ AI可能混淆项目外观和户型外观
  ];
  
  return projectCategories.includes(category);
}

/**
 * 严格项目级别类别（用于户型边界内的页面——不含UNKNOWN/UNIT_EXTERIOR）
 */
function isStrictProjectLevelImage(category: ImageCategory): boolean {
  const strictCategories = [
    ImageCategory.BUILDING_EXTERIOR,
    ImageCategory.BUILDING_AERIAL,
    ImageCategory.BUILDING_ENTRANCE,
    ImageCategory.LOCATION_MAP,
    ImageCategory.MASTER_PLAN,
    ImageCategory.AMENITY_POOL,
    ImageCategory.AMENITY_GYM,
    ImageCategory.AMENITY_GARDEN,
    ImageCategory.AMENITY_LOUNGE,
    ImageCategory.AMENITY_OTHER,
  ];
  return strictCategories.includes(category);
}

/**
 * 按类别提取图片
 */
function extractByCategory(
  images: PageImage[],
  categories: ImageCategory[]
): PageImage[] {
  return images.filter(img => categories.includes(img.category));
}

/**
 * 去重图片（按imagePath - 避免同一页面的重复图片）
 * 
 * ⚡ FIX: 同一页可能被AI识别为多个类别(rendering, aerial, exterior)
 * 但它们的imagePath都是同一个文件,应该去重
 */
function deduplicateByImageId(images: PageImage[]): PageImage[] {
  const seen = new Set<string>();
  return images.filter(img => {
    // ⚡ 按imagePath去重,而不是imageId
    // 因为同一页的不同类别有不同imageId但相同imagePath
    if (seen.has(img.imagePath)) {
      console.log(`   🔄 Skipping duplicate image: ${img.imageId} (same imagePath)`);
      return false;
    }
    seen.add(img.imagePath);
    return true;
  });
}
