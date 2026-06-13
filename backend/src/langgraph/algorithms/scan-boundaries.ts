/**
 * 边界扫描算法
 *
 * 策略：
 * - 遇到isUnitStart → 开始新户型（并向前回溯未归属的效果图页）
 * - 遇到下一个isUnitStart → 结束当前户型
 * - 遇到isSectionStart → 结束当前户型
 * - PDF切换 → 结束当前户型（页码按PDF各自从1开始，边界不能跨PDF）
 *
 * ⭐ "锚点在尾部"支持（Palm Jebel Ali 等高端楼书）：
 *   [分隔页"BLUE HORIZON"] → 效果图×N → 平面图(锚点)
 *   锚点触发时把 startPage 回溯到分隔页之后的第一张效果图页
 */

import { PageMetadata, PageType, ImageCategory } from '../types/page-metadata';
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

  console.log('\n🔍 Scanning unit boundaries (section-based)...');

  const sorted = [...pages].sort((a, b) =>
    a.pdfSource !== b.pdfSource ? a.pdfSource.localeCompare(b.pdfSource) : a.pageNumber - b.pageNumber
  );

  const isAnchor = (p: PageMetadata): boolean =>
    p.pageType === PageType.UNIT_ANCHOR || p.pageType === PageType.UNIT_FLOORPLAN_ONLY;

  const isDivider = (p: PageMetadata): boolean =>
    p.boundaryMarkers.isSectionStart ||
    p.pageType === PageType.SECTION_DIVIDER ||
    p.pageType === PageType.SECTION_TITLE;

  // ============ 步骤1: 按分隔页/PDF切换切成 section ============
  type Section = { pages: PageMetadata[]; pdfSource: string; context: string | null };
  const sections: Section[] = [];
  let cur: Section | null = null;
  let runningContext: string | null = null;

  for (const page of sorted) {
    if (!cur || page.pdfSource !== cur.pdfSource) {
      cur = { pages: [], pdfSource: page.pdfSource, context: null };
      sections.push(cur);
      runningContext = null;
    }
    if (isDivider(page)) {
      // 分隔页关闭当前 section，开启新 section（分隔页本身不入任何 section）
      runningContext = page.boundaryMarkers.startMarkerText || null;
      cur = { pages: [], pdfSource: page.pdfSource, context: runningContext };
      sections.push(cur);
      continue;
    }
    cur.pages.push(page);
  }

  // ============ 步骤2: 每节内按锚点数生成户型 ============
  const boundaries: UnitBoundary[] = [];

  for (const section of sections) {
    if (section.pages.length === 0) continue;
    const anchors = section.pages.filter(isAnchor);

    if (anchors.length === 0) {
      // 无锚点 section：暂不成户型（图片归项目图库），孤儿吸收阶段可能补救
      continue;
    }

    if (anchors.length === 1) {
      // ⭐ 1 个锚点 → 整节合成 1 个户型（PJA：分隔页→照片×N→户型图）
      const anchor = anchors[0];
      const name = resolveUnitName(anchor, section.context, anchor);
      if (!name) continue;
      const first = section.pages[0];
      const last = section.pages[section.pages.length - 1];
      boundaries.push({
        unitTypeName: name,
        startPage: first.pageNumber,
        endPage: last.pageNumber,
        pageCount: last.pageNumber - first.pageNumber + 1,
        pdfSource: section.pdfSource,
        pdfSources: [section.pdfSource],
      });
      console.log(`   ✓ [1-anchor section] "${name}": pages ${first.pageNumber}-${last.pageNumber} (${section.pdfSource})`);
    } else {
      // ⭐ N 个锚点 → 按锚点拆 N 个户型（Palm Central：一页一户型）
      // 每个锚点的范围 = [上一锚点之后的第一页 .. 本锚点]，最后一个锚点吃到节尾
      const anchorIdxs = section.pages
        .map((p, i) => (isAnchor(p) ? i : -1))
        .filter(i => i >= 0);

      for (let k = 0; k < anchorIdxs.length; k++) {
        const anchor = section.pages[anchorIdxs[k]];
        const name = resolveUnitName(anchor, section.context, anchor);
        if (!name) continue;

        // 范围起点：第一个锚点从节首开始(吃掉前面的照片)，其余从锚点本页开始
        const rangeStartIdx = k === 0 ? 0 : anchorIdxs[k];
        // 范围终点：最后一个锚点吃到节尾，否则到下一个锚点的前一页(认领后面跟随的照片)
        const rangeEndIdx = k === anchorIdxs.length - 1
          ? section.pages.length - 1
          : anchorIdxs[k + 1] - 1;

        const first = section.pages[rangeStartIdx];
        const last = section.pages[rangeEndIdx];
        boundaries.push({
          unitTypeName: name,
          startPage: first.pageNumber,
          endPage: last.pageNumber,
          pageCount: last.pageNumber - first.pageNumber + 1,
          pdfSource: section.pdfSource,
          pdfSources: [section.pdfSource],
        });
        console.log(`   ✓ [multi-anchor section] "${name}": pages ${first.pageNumber}-${last.pageNumber} (${section.pdfSource})`);
      }
    }
  }

  console.log(`\n📊 Boundary scan complete: ${boundaries.length} units identified\n`);

  return boundaries;
}

/**
 * 决定户型名：锚点名优先；通用名/纯描述名则与 section 上下文组合。
 * 会同步更新锚点页的 unitInfo.unitTypeName，供 batch-processor 匹配。
 */
function resolveUnitName(
  namePage: PageMetadata,
  sectionContext: string | null,
  anchorToUpdate: PageMetadata
): string | null {
  let unitName = namePage.unitInfo?.unitTypeName?.trim();

  // 锚点无名 → 尝试从 section 上下文取（命名系列分隔页）
  if (!unitName) {
    unitName = sectionContext?.trim() || undefined;
    if (!unitName) {
      console.log(`   ⚠️  Anchor page ${namePage.pageNumber} has no name and no section context, skipping`);
      return null;
    }
  }

  const generic = isGenericUnitName(unitName);
  const descriptive = !generic && isDescriptiveUnitName(unitName);

  if ((generic || descriptive) && sectionContext) {
    const combined = combineWithSectionContext(unitName, sectionContext);
    if (combined) {
      console.log(`   🔄 Combined "${unitName}" with section "${sectionContext}" → "${combined}"`);
      unitName = combined;
    } else if (generic) {
      console.log(`   ⚠️  Skipping generic unit name: "${unitName}" (no usable section context)`);
      return null;
    }
  } else if (generic) {
    console.log(`   ⚠️  Skipping generic unit name: "${unitName}" (no section context)`);
    return null;
  }

  // 同步回锚点页，供后续 specs/价格按名称匹配
  if (anchorToUpdate.unitInfo) {
    anchorToUpdate.unitInfo.unitTypeName = unitName;
  }
  return unitName;
}

/**
 * ⭐ 孤儿户型图吸收（确定性后处理,解决"户型图掉了+面积=0")
 *
 * 高端楼书每节结构固定：分隔页 → 带户型名角标的照片页 ×N → 户型图页(有面积,
 * 但文本层没户型名)。当 section 重建按"标签名"圈范围时,会圈到照片页、把末尾
 * 那页户型图漏在外面 → 该户型既没户型图、面积也=0(面积只在户型图页上)。
 *
 * 本函数把任何"带户型图/面积、却不在任何户型区间内"的孤儿锚点页,确定性地并入
 * 它前面相邻的户型(同一 PDF、中间无分隔页、无其他户型)。不依赖 AI 圈准范围。
 */
export function absorbOrphanAnchors(
  boundaries: UnitBoundary[],
  pages: PageMetadata[]
): UnitBoundary[] {
  if (boundaries.length === 0) return boundaries;

  const sorted = [...pages].sort((a, b) =>
    a.pdfSource !== b.pdfSource ? a.pdfSource.localeCompare(b.pdfSource) : a.pageNumber - b.pageNumber
  );

  const isAnchorLike = (p: PageMetadata): boolean =>
    p.pageType === PageType.UNIT_ANCHOR ||
    p.pageType === PageType.UNIT_FLOORPLAN_ONLY ||
    p.images.some(img => img.category === ImageCategory.FLOOR_PLAN) ||
    (p.unitInfo?.specs?.area ?? 0) > 0;

  const isDivider = (p: PageMetadata): boolean =>
    p.boundaryMarkers.isSectionStart ||
    p.pageType === PageType.SECTION_DIVIDER ||
    p.pageType === PageType.SECTION_TITLE;

  const result = boundaries.map(b => ({ ...b }));

  const inAnyBoundary = (p: PageMetadata): boolean =>
    result.some(b => b.pdfSource === p.pdfSource &&
      p.pageNumber >= b.startPage && p.pageNumber <= b.endPage);

  let absorbed = 0;
  for (const page of sorted) {
    if (!isAnchorLike(page) || inAnyBoundary(page)) continue;

    // 找前面最近、同 PDF、中间无分隔页、无其他户型起点的户型
    let best: UnitBoundary | null = null;
    for (const b of result) {
      if (b.pdfSource !== page.pdfSource || b.endPage >= page.pageNumber) continue;

      const dividerBetween = sorted.some(p2 =>
        p2.pdfSource === page.pdfSource &&
        p2.pageNumber > b.endPage && p2.pageNumber < page.pageNumber &&
        isDivider(p2)
      );
      if (dividerBetween) continue;

      const otherUnitBetween = result.some(b2 =>
        b2 !== b && b2.pdfSource === page.pdfSource &&
        b2.startPage > b.endPage && b2.startPage < page.pageNumber
      );
      if (otherUnitBetween) continue;

      if (!best || b.endPage > best.endPage) best = b;
    }

    // 没有前置户型 → 尝试并入后面紧邻的户型（户型图在照片前的版式）
    if (!best) {
      for (const b of result) {
        if (b.pdfSource !== page.pdfSource || b.startPage <= page.pageNumber) continue;
        const dividerBetween = sorted.some(p2 =>
          p2.pdfSource === page.pdfSource &&
          p2.pageNumber > page.pageNumber && p2.pageNumber < b.startPage &&
          isDivider(p2)
        );
        if (dividerBetween) continue;
        if (!best || b.startPage < best.startPage) best = b;
      }
      if (best) {
        best.startPage = page.pageNumber;
        absorbed++;
        console.log(`   🧲 Absorbed orphan floor-plan page ${page.pageNumber} into "${best.unitTypeName}" (prepend)`);
        continue;
      }
    }

    if (best) {
      best.endPage = page.pageNumber;
      best.pageCount = best.endPage - best.startPage + 1;
      absorbed++;
      console.log(`   🧲 Absorbed orphan floor-plan page ${page.pageNumber} into "${best.unitTypeName}" (pages now ${best.startPage}-${best.endPage})`);
    }
  }

  if (absorbed > 0) {
    console.log(`   ✅ Absorbed ${absorbed} orphan floor-plan/anchor page(s) into adjacent units`);
  }
  return result;
}

/**
 * 判断是否为纯描述性户型名（无独特标识，需要与系列名组合）
 *
 * 例如 "BEACH VILLA — 6 BEDROOM"：去掉常见描述词和数字后没有剩余
 * → 与 section "BLUE HORIZON" 组合成 "BLUE HORIZON BEACH VILLA — 6 BEDROOM"
 *
 * 反例 "Type A"（剩 "A"）、"B-1B-B.2"（剩字母代码）→ 有独特标识，保持原名
 */
function isDescriptiveUnitName(name: string): boolean {
  if (!name) return false;
  const residue = name
    .toUpperCase()
    .replace(/\d+/g, ' ')
    .replace(/\b(BEACH|GARDEN|WATER|WATERFRONT|FAMILY|LUXURY|PREMIUM|GRAND|SIGNATURE|VILLA|VILLAS|TOWNHOUSE|TOWNHOUSES|APARTMENT|APARTMENTS|PENTHOUSE|DUPLEX|SIMPLEX|MAID|STUDY|LARGE|BED|BEDS|BEDROOM|BEDROOMS|BR|ROOM|ROOMS|CONTEMPORARY|MODERN|CLASSIC|COLLECTION|EDITION|RESIDENCE|RESIDENCES)\b/g, ' ')
    .replace(/[^A-Z]/g, '');
  return residue.length === 0;
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
 * - "Type A", "Type B", "Type 1A"  ← 这些是有效的户型名称，不应该过滤
 */
function isGenericUnitName(unitName: string): boolean {
  if (!unitName) return true;

  const normalized = unitName.toLowerCase().trim();

  // ⭐ 首先检查有效的户型命名格式（不应该过滤）
  const validUnitPatterns = [
    /^type\s*[a-z0-9]+$/i,            // "Type A", "Type B", "Type 1A", "Type 2B"
    /^unit\s*type\s*[a-z0-9]+$/i,     // "Unit Type A", "Unit Type 1"
    /^[A-Z]-\d+[A-Z]+-[A-Z]\.\d+$/i,  // B-1B-B.2, C-3B-A.1
    /^[A-Z]-\d+[A-Z]+M-[A-Z]\.\d+$/i, // A-2BM-A.1, B-3BM-A.1
    /^[A-Z]-PH-[A-Z]\.\d+$/i,         // A-PH-A.1
    /^[A-Z]\d+$/i,                    // "A1", "B2", "C3" - common unit type codes
    /^[A-Z]-[A-Z]$/i,                 // "A-A", "B-C" - simple unit codes
  ];

  // 如果匹配有效户型格式，保留（不过滤）
  if (validUnitPatterns.some(pattern => pattern.test(unitName))) {
    return false;
  }

  // 通用名称模式（应该被过滤）
  const genericPatterns = [
    /^studio$/i,                    // "Studio"
    /^\d+-bedroom$/i,               // "1-Bedroom", "2-Bedroom", "3-Bedroom"
    /^\d+\s*br$/i,                  // "1BR", "2BR", "3BR", "1 BR"
    /^penthouse$/i,                 // "Penthouse"
    /^duplex$/i,                    // "Duplex"
    /^townhouse$/i,                 // "Townhouse"
    /^villa$/i,                     // "Villa"
    /^apartment$/i,                 // "Apartment"
    /^one\s*bedroom$/i,             // "One Bedroom"
    /^two\s*bedroom$/i,             // "Two Bedroom"
    /^three\s*bedroom$/i,           // "Three Bedroom"
  ];

  // 如果匹配任何通用模式，返回true（应该被过滤）
  if (genericPatterns.some(pattern => pattern.test(normalized))) {
    return true;
  }

  return false;  // 默认保留
}

/**
 * 将通用户型名称与section上下文组合
 *
 * 例如：
 * - section: "1-BEDROOM APARTMENTS", unit: "Type A" → "1-BEDROOM TYPE A"
 * - section: "2-BEDROOM APARTMENTS", unit: "Type B" → "2-BEDROOM TYPE B"
 * - section: "3-BEDROOM + MAID", unit: "Type C" → "3-BEDROOM + MAID TYPE C"
 */
function combineWithSectionContext(unitName: string, sectionContext: string): string | null {
  if (!unitName || !sectionContext) return null;

  // 提取section中的卧室信息
  const sectionNormalized = sectionContext.toUpperCase();

  // 匹配 "1-BEDROOM", "2-BEDROOM", "3-BEDROOM + MAID", "4-BEDROOM DUPLEXES" 等
  const bedroomMatch = sectionNormalized.match(/(\d+-BEDROOM(?:\s*\+\s*MAID)?(?:\s+DUPLEXES?)?(?:\s+APARTMENTS?)?)/i);

  if (bedroomMatch) {
    // 提取核心卧室描述（去掉APARTMENTS等后缀）
    let bedroomPart = bedroomMatch[1]
      .replace(/\s+APARTMENTS?$/i, '')
      .replace(/\s+DUPLEXES?$/i, '')
      .trim();

    // 组合: "1-BEDROOM" + "Type A" = "1-BEDROOM TYPE A"
    const combinedName = `${bedroomPart} ${unitName.toUpperCase()}`;
    return combinedName;
  }

  // 匹配 STUDIO, PENTHOUSE 等
  if (sectionNormalized.includes('STUDIO')) {
    return `STUDIO ${unitName.toUpperCase()}`;
  }
  if (sectionNormalized.includes('PENTHOUSE')) {
    return `PENTHOUSE ${unitName.toUpperCase()}`;
  }

  // ⭐ 命名系列分隔页（如 "BLUE HORIZON"、"CRYSTAL SPRINGS"）：
  // 非通用标题、非楼栋标识、且未包含在户型名中 → 前置作为系列名
  const cleaned = sectionContext.trim().replace(/\s+/g, ' ');
  const upperCleaned = cleaned.toUpperCase();

  // 楼栋/期数标识交给 buildingContext 处理，不并入户型名
  if (/^(TOWER|BUILDING|BLOCK|PHASE)\b/i.test(upperCleaned)) {
    return null;
  }

  // 通用章节标题不能作为系列名
  const genericTitles = [
    'floor plans', 'floorplans', 'unit types', 'amenities', 'facilities',
    'payment plan', 'location', 'features', 'overview', 'specifications',
    'pricing', 'price', 'prices', 'price list', 'unit mix', 'availability',
    'interior', 'exterior', 'master plan', 'masterplan', 'gallery',
    'introduction', 'contents', 'about',
  ];
  if (genericTitles.some(t => upperCleaned.toLowerCase().includes(t))) {
    return null;
  }

  // 名称合理性：较短的标题才像系列名
  if (cleaned.length === 0 || cleaned.length > 30) {
    return null;
  }

  if (unitName.toUpperCase().includes(upperCleaned)) {
    return null;  // 户型名已含系列名，无需组合
  }

  return `${upperCleaned} ${unitName.toUpperCase()}`;
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
