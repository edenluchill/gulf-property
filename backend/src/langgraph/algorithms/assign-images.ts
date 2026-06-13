/**
 * 图片分配算法
 *
 * 策略：
 * - ⭐ 标签优先：效果图页角标带户型名（roleInUnit='supplementary'）且唯一匹配某边界 → 按标签归属
 * - 范围兜底：无标签的页按边界范围分配（必须同一PDF——页码按PDF各自从1开始）
 * - 纯代码逻辑，无需AI
 */

import { PageMetadata, ImageCategory, PageType, PageImage } from '../types/page-metadata';
import { UnitBoundary, UnitImageAssignment } from '../types/assignment-result';

/**
 * 基于边界分配图片
 *
 * 策略：
 * - 先建立"标签 → 边界"的唯一归属表
 * - 遍历每个户型边界，收集标签归属页 + 范围内无标签页的图片
 * - 按图片类别分组（UNKNOWN 类别按页面类型兜底）
 */
export function assignImagesByBoundaries(
  pages: PageMetadata[],
  boundaries: UnitBoundary[]
): UnitImageAssignment[] {

  console.log('\n🖼️  Assigning images to units...');

  // ============ 标签 → 边界 唯一归属 ============
  const normalize = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const boundaryKeys = boundaries.map(b => normalize(b.unitTypeName));

  // page数组下标 → boundary下标（仅唯一匹配时生效，多义回退范围归属）
  const labelClaims = new Map<number, number>();
  pages.forEach((page, pIdx) => {
    if (page.unitInfo?.roleInUnit !== 'supplementary' || !page.unitInfo.unitTypeName) return;
    const label = normalize(page.unitInfo.unitTypeName);
    if (!label || label.length < 3) return;

    const matches: number[] = [];
    boundaryKeys.forEach((key, bIdx) => {
      if (!key) return;
      if (key === label || key.includes(label) || label.includes(key)) {
        matches.push(bIdx);
      }
    });
    if (matches.length === 1) {
      labelClaims.set(pIdx, matches[0]);
      console.log(`   🏷️  Page ${page.pageNumber} (${page.pdfSource}) claimed by label "${page.unitInfo.unitTypeName}" → unit "${boundaries[matches[0]].unitTypeName}"`);
    } else if (matches.length > 1) {
      console.log(`   ⚠️  Page ${page.pageNumber} label "${page.unitInfo.unitTypeName}" matches ${matches.length} units, falling back to range`);
    }
  });

  return boundaries.map((boundary, bIdx) => {
    // ⭐ 锚点页在范围内查找（回溯/全局重建后锚点不一定是首页）
    const anchorPage = pages.find(p =>
      p.pdfSource === boundary.pdfSource &&
      p.pageNumber >= boundary.startPage &&
      p.pageNumber <= boundary.endPage &&
      p.pageType === PageType.UNIT_ANCHOR &&
      p.unitInfo?.unitTypeName
    );

    // 提取unitCategory：边界自带（全局重建） > AI识别 > 从bedrooms推导
    let unitCategory = boundary.unitCategory || anchorPage?.unitInfo?.unitCategory;
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
    let filteredOutCount = 0;
    const sourcePagesSet = new Set<number>();  // ⭐ 用于去重

    pages.forEach((page, pIdx) => {
      // ⭐ 归属判定：标签唯一归属 > 范围归属（同PDF且本页未被其他标签认领）
      const claimed = labelClaims.get(pIdx);
      const inRange =
        page.pdfSource === boundary.pdfSource &&
        page.pageNumber >= boundary.startPage &&
        page.pageNumber <= boundary.endPage;
      const belongs = claimed === bIdx || (claimed === undefined && inRange);
      if (!belongs) return;

      // 分配图片（基于AI标记的类别）
      page.images.forEach(img => {
        // ⭐ Filter out images marked as shouldUse: false
        if (img.shouldUse === false) {
          filteredOutCount++;
          return;  // Skip this image
        }

        totalImagesAssigned++;
        assignment.allImages.push(img);
        sourcePagesSet.add(page.pageNumber);  // ⭐ 记录来源页码

        // 根据类别分配到不同组（UNKNOWN 按页面类型兜底，避免效果图被丢弃）
        const category = resolveCategory(img, page);
        switch (category) {
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
            console.warn(`   ⚠️  Unexpected image category in unit: ${img.category} (page ${page.pageNumber})`);
        }
      });
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

/**
 * 解析图片有效类别：明确类别直接用，UNKNOWN 按页面类型兜底
 */
function resolveCategory(img: PageImage, page: PageMetadata): ImageCategory {
  if (img.category !== ImageCategory.UNKNOWN) {
    return img.category;
  }
  switch (page.pageType) {
    case PageType.UNIT_RENDERING: return ImageCategory.UNIT_EXTERIOR;
    case PageType.UNIT_INTERIOR: return ImageCategory.UNIT_INTERIOR_LIVING;
    case PageType.UNIT_ANCHOR:
    case PageType.UNIT_FLOORPLAN_ONLY: return ImageCategory.FLOOR_PLAN;
    default: return ImageCategory.UNKNOWN;
  }
}
