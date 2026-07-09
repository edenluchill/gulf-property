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
  _boundaries: UnitBoundary[]  // 保留签名兼容;新策略不再按边界过滤
): ProjectImages {

  console.log('\n🏢 Extracting project images (marketing gallery)...');

  // ⭐ 2026-07-09 改:概览 = 所有页的所有图片,只排除户型平面图(FLOOR_PLAN),按
  //    imagePath 去重。用户诉求:抽图别删非户型照片;户型效果图/内景同时保留在
  //    户型和概览,概览显示"除户型平面图外的所有图",admin 在审核页自己决定删不删。
  //    不再因 shouldUse===false 硬丢(交给 admin 隐藏);平面图仍只进户型不进概览。
  const allImages = pages.flatMap(p => p.images);
  const nonFloorPlan = allImages.filter(img => img.category !== ImageCategory.FLOOR_PLAN);
  const uniqueImages = deduplicateByImagePath(nonFloorPlan);

  console.log(`   All images: ${allImages.length}, non-floorplan: ${nonFloorPlan.length}, unique: ${uniqueImages.length}`);

  // 按类别分组;户型效果图/内景/阳台归入 gallery(renderingImages)与项目外观同展示。
  // ⭐ 任何非平面图都必须落进某个桶,否则会被静默丢弃(用户明确要"别删")。
  const bucketed = new Set<ImageCategory>([
    ImageCategory.LOGO,
    ImageCategory.BUILDING_AERIAL,
    ImageCategory.LOCATION_MAP,
    ImageCategory.MASTER_PLAN,
    ImageCategory.AMENITY_POOL, ImageCategory.AMENITY_GYM, ImageCategory.AMENITY_GARDEN,
    ImageCategory.AMENITY_LOUNGE, ImageCategory.AMENITY_OTHER,
    ImageCategory.BUILDING_EXTERIOR, ImageCategory.BUILDING_ENTRANCE, ImageCategory.DIAGRAM,
    ImageCategory.UNIT_EXTERIOR, ImageCategory.UNIT_INTERIOR_LIVING, ImageCategory.UNIT_INTERIOR_BEDROOM,
    ImageCategory.UNIT_INTERIOR_KITCHEN, ImageCategory.UNIT_INTERIOR_BATHROOM, ImageCategory.UNIT_BALCONY,
  ]);
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
    // 项目外观 + 户型效果图/内景/阳台 + 图表 + 未匹配到具名桶的一切(兜底,防丢弃)
    renderingImages: uniqueImages.filter(img =>
      img.category === ImageCategory.BUILDING_EXTERIOR ||
      img.category === ImageCategory.BUILDING_ENTRANCE ||
      img.category === ImageCategory.DIAGRAM ||
      img.category === ImageCategory.UNIT_EXTERIOR ||
      img.category === ImageCategory.UNIT_INTERIOR_LIVING ||
      img.category === ImageCategory.UNIT_INTERIOR_BEDROOM ||
      img.category === ImageCategory.UNIT_INTERIOR_KITCHEN ||
      img.category === ImageCategory.UNIT_INTERIOR_BATHROOM ||
      img.category === ImageCategory.UNIT_BALCONY ||
      !bucketed.has(img.category)  // 兜底:UNKNOWN/ICON 等未具名分类也收进 gallery
    ),
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
function deduplicateByImagePath(images: PageImage[]): PageImage[] {
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
