/**
 * 图片分配算法
 * 
 * 策略：
 * - 基于边界范围分配图片
 * - 纯代码逻辑，无需AI
 */

import { PageMetadata, ImageCategory } from '../types/page-metadata';
import { UnitBoundary, UnitImageAssignment } from '../types/assignment-result';

/**
 * 基于边界分配图片
 * 
 * 策略：
 * - 遍历每个户型边界
 * - 收集范围内所有页面的图片
 * - 按图片类别分组
 */
export function assignImagesByBoundaries(
  pages: PageMetadata[],
  boundaries: UnitBoundary[]
): UnitImageAssignment[] {

  console.log('\n🖼️  Assigning images to units...');

  return boundaries.map(boundary => {
    // ⭐ 从锚点页提取unitCategory（用于防止同名不同规格的户型被错误合并）
    const anchorPage = pages.find(p =>
      p.pageNumber === boundary.startPage &&
      p.unitInfo?.unitTypeName
    );

    // 提取unitCategory：优先使用AI识别的category，否则从bedrooms推导
    let unitCategory = anchorPage?.unitInfo?.unitCategory;
    if (!unitCategory && anchorPage?.unitInfo?.specs?.bedrooms !== undefined) {
      unitCategory = `${anchorPage.unitInfo.specs.bedrooms}BR`;
    }

    const assignment: UnitImageAssignment = {
      unitTypeName: boundary.unitTypeName,
      unitCategory,  // ⭐ 传递category用于merge检查
      floorPlanImages: [],
      renderingImages: [],
      interiorImages: [],
      balconyImages: [],
      allImages: [],
      pdfSources: boundary.pdfSources,
      pageRange: {
        start: boundary.startPage,
        end: boundary.endPage,
      },
      sourcePages: [],  // ⭐ 追踪来源页码
    };

    let totalImagesAssigned = 0;

    // 收集范围内所有图片
    let filteredOutCount = 0;
    const sourcePagesSet = new Set<number>();  // ⭐ 用于去重

    pages.forEach(page => {
      // 检查页面是否在边界范围内
      if (page.pageNumber >= boundary.startPage &&
          page.pageNumber <= boundary.endPage) {

        // 分配图片（基于AI标记的类别）
        page.images.forEach(img => {
          // ⭐ NEW: Filter out images marked as shouldUse: false
          if (img.shouldUse === false) {
            filteredOutCount++;
            return;  // Skip this image
          }

          totalImagesAssigned++;
          assignment.allImages.push(img);
          sourcePagesSet.add(page.pageNumber);  // ⭐ 记录来源页码

          // 根据类别分配到不同组
          switch (img.category) {
            case ImageCategory.FLOOR_PLAN:
              assignment.floorPlanImages.push(img);
              break;

            case ImageCategory.UNIT_EXTERIOR:
              assignment.renderingImages.push(img);
              break;

            case ImageCategory.UNIT_INTERIOR_LIVING:
            case ImageCategory.UNIT_INTERIOR_BEDROOM:
            case ImageCategory.UNIT_INTERIOR_KITCHEN:
            case ImageCategory.UNIT_INTERIOR_BATHROOM:
              assignment.interiorImages.push(img);
              break;

            case ImageCategory.UNIT_BALCONY:
              assignment.balconyImages.push(img);
              break;

            // 其他类别暂不处理（可能是项目图片误入）
            default:
              console.warn(`   ⚠️  Unexpected image category in unit: ${img.category}`);
          }
        });
      }
    });

    // ⭐ 转换Set为排序后的数组
    assignment.sourcePages = Array.from(sourcePagesSet).sort((a, b) => a - b);

    if (filteredOutCount > 0) {
      console.log(`   🗑️  Filtered out ${filteredOutCount} images marked as not useful`);
    }

    console.log(`   ✓ ${boundary.unitTypeName}: ${totalImagesAssigned} images (${assignment.floorPlanImages.length} floor plans, ${assignment.renderingImages.length} renderings, ${assignment.interiorImages.length} interiors) from pages [${assignment.sourcePages.join(', ')}]`);

    return assignment;
  });
}