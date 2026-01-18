/**
 * 边界扫描算法
 * 
 * 策略：
 * - 遇到isUnitStart → 开始新户型
 * - 遇到下一个isUnitStart → 结束当前户型
 * - 遇到isSectionStart → 结束当前户型
 */

import { PageMetadata, PageType } from '../types/page-metadata';
import { UnitBoundary } from '../types/assignment-result';

/**
 * 扫描页面，识别每个户型的边界范围
 * 
 * 每次插入新pages后都会重新调用
 * 即使锚点页还未出现，也能正常运行（返回空数组）
 */
export function scanUnitBoundaries(pages: PageMetadata[]): UnitBoundary[] {
  if (pages.length === 0) {
    return [];
  }
  
  const boundaries: UnitBoundary[] = [];
  let currentStart: number | null = null;
  let currentUnitName: string | null = null;
  let currentPdfSources: Set<string> = new Set();
  
  console.log('\n🔍 Scanning unit boundaries...');
  
  pages.forEach((page, index) => {
    // ============ 场景1: 遇到新户型起始 ============
    if (page.boundaryMarkers.isUnitStart && page.unitInfo?.unitTypeName) {
      const unitName = page.unitInfo.unitTypeName;
      
      // ⭐ 过滤通用名称（不是具体户型）
      if (isGenericUnitName(unitName)) {
        console.log(`   ⚠️  Skipping generic unit name: "${unitName}" (not a specific unit type)`);
        return;  // 跳过这个"户型"
      }
      
      // 保存上一个户型的边界
      if (currentStart !== null && currentUnitName !== null) {
        const prevPage = pages[index - 1];
        const endPage = prevPage ? prevPage.pageNumber : page.pageNumber - 1;
        
        boundaries.push({
          unitTypeName: currentUnitName,
          startPage: currentStart,
          endPage,
          pageCount: endPage - currentStart + 1,
          pdfSources: Array.from(currentPdfSources),
        });
        
        console.log(`   ✓ Found unit "${currentUnitName}": pages ${currentStart}-${endPage} (${currentPdfSources.size} PDFs)`);
      }
      
      // 开始新户型
      currentStart = page.pageNumber;
      currentUnitName = unitName;
      currentPdfSources = new Set([page.pdfSource]);
      
      console.log(`   ⚓ Unit start: "${currentUnitName}" at page ${page.pageNumber}`);
    }
    
    // ============ 场景2: 遇到章节分隔 ============
    else if (page.boundaryMarkers.isSectionStart) {
      // 结束当前户型
      if (currentStart !== null && currentUnitName !== null) {
        boundaries.push({
          unitTypeName: currentUnitName,
          startPage: currentStart,
          endPage: page.pageNumber - 1,
          pageCount: page.pageNumber - currentStart,
          pdfSources: Array.from(currentPdfSources),
        });
        
        console.log(`   ✓ Found unit "${currentUnitName}": pages ${currentStart}-${page.pageNumber - 1} (ended by section)`);
      }
      
      currentStart = null;
      currentUnitName = null;
      currentPdfSources = new Set();
      
      console.log(`   📑 Section start: "${page.boundaryMarkers.startMarkerText || 'Unknown'}" at page ${page.pageNumber}`);
    }
    
    // ============ 场景3: 遇到户型结束标记 ============
    else if (page.boundaryMarkers.isUnitEnd) {
      if (currentStart !== null && currentUnitName !== null) {
        currentPdfSources.add(page.pdfSource);
        
        boundaries.push({
          unitTypeName: currentUnitName,
          startPage: currentStart,
          endPage: page.pageNumber,
          pageCount: page.pageNumber - currentStart + 1,
          pdfSources: Array.from(currentPdfSources),
        });
        
        console.log(`   ✓ Found unit "${currentUnitName}": pages ${currentStart}-${page.pageNumber} (ended by marker)`);
      }
      
      currentStart = null;
      currentUnitName = null;
      currentPdfSources = new Set();
    }
    
    // ============ 场景4: 在户型范围内的普通页 ============
    else if (currentStart !== null) {
      // 记录PDF来源
      currentPdfSources.add(page.pdfSource);
    }
  });
  
  // ============ 保存最后一个户型 ============
  if (currentStart !== null && currentUnitName !== null) {
    const lastPage = pages[pages.length - 1];
    
    boundaries.push({
      unitTypeName: currentUnitName,
      startPage: currentStart,
      endPage: lastPage.pageNumber,
      pageCount: lastPage.pageNumber - currentStart + 1,
      pdfSources: Array.from(currentPdfSources),
    });
    
    console.log(`   ✓ Found unit "${currentUnitName}": pages ${currentStart}-${lastPage.pageNumber} (last unit)`);
  }
  
  console.log(`\n📊 Boundary scan complete: ${boundaries.length} units identified\n`);
  
  return boundaries;
}

/**
 * 判断页面是否与户型相关
 * （辅助函数，可用于未来优化）
 */
export function isUnitRelatedPage(page: PageMetadata): boolean {
  const unitRelatedTypes: PageType[] = [
    PageType.UNIT_ANCHOR,
    PageType.UNIT_FLOORPLAN_ONLY,
    PageType.UNIT_RENDERING,
    PageType.UNIT_INTERIOR,
    PageType.UNIT_DETAIL,
  ];
  
  return unitRelatedTypes.includes(page.pageType);
}

/**
 * 判断是否为通用户型名称（应该被过滤）
 * 
 * 通用名称示例：
 * - "3-Bedroom", "4-Bedroom", "Penthouse"
 * - "Studio", "1BR", "2BR"
 * 
 * 具体户型示例（保留）：
 * - "B-1B-B.2", "C-3B-A.1", "A-2BM-A.1"
 */
function isGenericUnitName(unitName: string): boolean {
  if (!unitName) return true;
  
  const normalized = unitName.toLowerCase().trim();
  
  // 通用名称模式（应该被过滤）
  const genericPatterns = [
    /^studio$/i,                    // "Studio"
    /^\d+-bedroom$/i,               // "1-Bedroom", "2-Bedroom", "3-Bedroom"
    /^\d+br$/i,                     // "1BR", "2BR", "3BR"
    /^penthouse$/i,                 // "Penthouse"
    /^duplex$/i,                    // "Duplex"
    /^townhouse$/i,                 // "Townhouse"
    /^villa$/i,                     // "Villa"
    /^apartment$/i,                 // "Apartment"
  ];
  
  // 如果匹配任何通用模式，返回true（应该被过滤）
  if (genericPatterns.some(pattern => pattern.test(normalized))) {
    return true;
  }
  
  // 具体户型模式（应该保留）
  // 包含连字符和字母数字组合：B-1B-B.2, C-3B-A.1, A-2BM-A.1
  const specificPatterns = [
    /^[A-Z]-\d+[A-Z]+-[A-Z]\.\d+$/i,  // B-1B-B.2, C-3B-A.1
    /^[A-Z]-\d+[A-Z]+M-[A-Z]\.\d+$/i, // A-2BM-A.1, B-3BM-A.1
    /^[A-Z]-PH-[A-Z]\.\d+$/i,          // A-PH-A.1
  ];
  
  // 如果匹配具体户型模式，返回false（不过滤）
  if (specificPatterns.some(pattern => pattern.test(unitName))) {
    return false;
  }
  
  // 如果都不匹配，但名称很短（<8字符），可能是通用名称
  if (unitName.length < 8 && !unitName.includes('-')) {
    return true;  // 过滤
  }
  
  return false;  // 默认保留
}

/**
 * 获取两页之间的所有页面
 * （辅助函数，用于检测分隔符）
 */
export function getPagesBetween(
  page1: number,
  page2: number,
  allPages: PageMetadata[]
): PageMetadata[] {
  const start = Math.min(page1, page2);
  const end = Math.max(page1, page2);
  
  return allPages.filter(p => p.pageNumber > start && p.pageNumber < end);
}
