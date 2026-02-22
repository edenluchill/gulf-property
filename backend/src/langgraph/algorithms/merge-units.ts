/**
 * 同名户型合并算法
 *
 * 处理多PDF场景：
 * - PDF A: Type A的外观渲染
 * - PDF B: Type A的平面图详情
 * → 合并为一个Type A，包含所有图片
 *
 * ⚠️ 但是：同名但不同规格的户型不应该合并
 * - Type A (1BR) 和 Type A (2BR) 是不同的户型
 */

import { UnitImageAssignment } from '../types/assignment-result';

/**
 * 合并同名户型（跨PDF场景）
 *
 * 策略：
 * 1. 按unitTypeName + unitCategory分组（防止同名不同规格被合并）
 * 2. 合并同组的所有图片
 * 3. 记录pdfSources来源
 */
export function mergeSameNameUnits(
  assignments: UnitImageAssignment[]
): UnitImageAssignment[] {

  if (assignments.length === 0) {
    return [];
  }

  console.log('\n🔀 Merging same-name units (multi-PDF support)...');

  // ⭐ 按 unitTypeName + unitCategory 分组（防止同名不同规格被错误合并）
  const grouped = new Map<string, UnitImageAssignment[]>();

  assignments.forEach(assignment => {
    // 组合key：名称 + 类别（如果有）
    // 这样"Type A (1BR)" 和 "Type A (2BR)" 会被分到不同组
    const key = assignment.unitCategory
      ? `${assignment.unitTypeName}__${assignment.unitCategory}`
      : assignment.unitTypeName;

    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(assignment);
  });
  
  // 合并同名户型
  const merged: UnitImageAssignment[] = [];

  grouped.forEach((group, groupKey) => {
    // 从第一个assignment获取原始名称和category
    const firstUnit = group[0];
    const originalName = firstUnit.unitTypeName;
    const category = firstUnit.unitCategory;

    if (group.length === 1) {
      // 只有一个，直接使用
      merged.push(group[0]);
      console.log(`   ✓ "${originalName}"${category ? ` (${category})` : ''}: single instance, no merge needed`);
    } else {
      // 多个同名同规格，合并图片
      const combined: UnitImageAssignment = {
        unitTypeName: originalName,
        unitCategory: category,
        floorPlanImages: [],
        renderingImages: [],
        interiorImages: [],
        balconyImages: [],
        allImages: [],
        pdfSources: [],
      };
      
      // 合并所有同名户型的图片
      group.forEach(unit => {
        combined.floorPlanImages.push(...unit.floorPlanImages);
        combined.renderingImages.push(...unit.renderingImages);
        combined.interiorImages.push(...unit.interiorImages);
        combined.balconyImages.push(...unit.balconyImages);
        combined.allImages.push(...unit.allImages);
        combined.pdfSources.push(...unit.pdfSources);
      });
      
      // 去重pdfSources
      combined.pdfSources = [...new Set(combined.pdfSources)];
      
      // 计算页面范围（合并后的总范围）
      const allPageRanges = group.filter(g => g.pageRange).map(g => g.pageRange!);
      if (allPageRanges.length > 0) {
        combined.pageRange = {
          start: Math.min(...allPageRanges.map(r => r.start)),
          end: Math.max(...allPageRanges.map(r => r.end)),
        };
      }
      
      console.log(`   ✅ Merged ${group.length} instances of "${originalName}"${category ? ` (${category})` : ''} from ${combined.pdfSources.join(', ')}`);
      console.log(`      → Total images: ${combined.allImages.length} (${combined.floorPlanImages.length} floor plans, ${combined.renderingImages.length} renderings, ${combined.interiorImages.length} interiors)`);
      
      merged.push(combined);
    }
  });
  
  const mergedCount = assignments.length - merged.length;
  if (mergedCount > 0) {
    console.log(`\n✅ Merged ${mergedCount} duplicate unit types (multi-PDF scenario)\n`);
  }
  
  return merged;
}

/**
 * 去重图片（可选，避免同一图片多次添加）
 */
export function deduplicateImages(assignments: UnitImageAssignment[]): UnitImageAssignment[] {
  return assignments.map(assignment => ({
    ...assignment,
    floorPlanImages: dedupeByImageId(assignment.floorPlanImages),
    renderingImages: dedupeByImageId(assignment.renderingImages),
    interiorImages: dedupeByImageId(assignment.interiorImages),
    balconyImages: dedupeByImageId(assignment.balconyImages),
    allImages: dedupeByImageId(assignment.allImages),
  }));
}

function dedupeByImageId<T extends { imageId: string }>(images: T[]): T[] {
  const seen = new Set<string>();
  return images.filter(img => {
    if (seen.has(img.imageId)) {
      return false;
    }
    seen.add(img.imageId);
    return true;
  });
}
