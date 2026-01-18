/**
 * 同名户型合并算法
 * 
 * 处理多PDF场景：
 * - PDF A: Type A的外观渲染
 * - PDF B: Type A的平面图详情
 * → 合并为一个Type A，包含所有图片
 */

import { UnitImageAssignment } from '../types/assignment-result';

/**
 * 合并同名户型（跨PDF场景）
 * 
 * 策略：
 * 1. 按unitTypeName分组
 * 2. 合并同组的所有图片
 * 3. 记录pdfSources来源
 * 
 * 优雅之处：
 * - 不影响现有邻近逻辑
 * - 自动处理多PDF
 * - 10行代码解决问题
 */
export function mergeSameNameUnits(
  assignments: UnitImageAssignment[]
): UnitImageAssignment[] {
  
  if (assignments.length === 0) {
    return [];
  }
  
  console.log('\n🔀 Merging same-name units (multi-PDF support)...');
  
  // 按unitTypeName分组
  const grouped = new Map<string, UnitImageAssignment[]>();
  
  assignments.forEach(assignment => {
    const key = assignment.unitTypeName;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(assignment);
  });
  
  // 合并同名户型
  const merged: UnitImageAssignment[] = [];
  
  grouped.forEach((group, unitTypeName) => {
    if (group.length === 1) {
      // 只有一个，直接使用
      merged.push(group[0]);
      console.log(`   ✓ "${unitTypeName}": single instance, no merge needed`);
    } else {
      // 多个同名，合并图片
      const combined: UnitImageAssignment = {
        unitTypeName,
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
      
      console.log(`   ✅ Merged ${group.length} instances of "${unitTypeName}" from ${combined.pdfSources.join(', ')}`);
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
