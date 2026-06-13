/**
 * 临时验证:scan-boundaries 回溯 + assign-images 标签/范围归属
 * 运行: cd backend && npx ts-node scripts/tmp-test-boundaries.ts
 */
import { scanUnitBoundaries, absorbOrphanAnchors } from '../src/langgraph/algorithms/scan-boundaries';
import { assignImagesByBoundaries } from '../src/langgraph/algorithms/assign-images';
import { PageMetadata, PageType, ImageCategory } from '../src/langgraph/types/page-metadata';
import { UnitBoundary } from '../src/langgraph/types/assignment-result';

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ✅ ${name}`);
  } else {
    failures++;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function page(opts: {
  n: number; pdf: string; type: PageType;
  imgCat?: ImageCategory;
  unitName?: string; role?: 'main' | 'supplementary';
  sectionStart?: string; unitStart?: boolean;
}): PageMetadata {
  return {
    pageNumber: opts.n,
    pdfSource: opts.pdf,
    chunkIndex: 0,
    pageType: opts.type,
    subTypes: [],
    confidence: 0.9,
    content: { textDensity: 'sparse', hasTable: false, hasDiagram: false, hasMarketingText: false },
    images: [{
      imageId: `page_${opts.n}_img_0`,
      imagePath: `r2://${opts.pdf}/p${opts.n}.jpg`,
      pageNumber: opts.n,
      category: opts.imgCat ?? ImageCategory.UNKNOWN,
      confidence: 0.9,
      shouldUse: true,
      features: { isFullPage: true, hasDimensions: false, hasScale: false },
    }],
    unitInfo: opts.unitName ? {
      unitTypeName: opts.unitName,
      hasDetailedSpecs: opts.role === 'main',
      hasFloorPlan: opts.role === 'main',
      roleInUnit: opts.role || 'main',
    } : undefined,
    boundaryMarkers: {
      isSectionStart: !!opts.sectionStart,
      isSectionEnd: false,
      isUnitStart: !!opts.unitStart,
      isUnitEnd: false,
      startMarkerText: opts.sectionStart,
    },
  };
}

// ============ 场景1: PJA"锚点在尾部"模式 ============
console.log('\n=== 场景1: Palm Jebel Ali — 分隔页 → 效果图×N → 平面图(锚点) ===');
{
  const pages: PageMetadata[] = [
    page({ n: 1, pdf: 'pja.pdf', type: PageType.PROJECT_COVER, imgCat: ImageCategory.LOGO }),
    page({ n: 2, pdf: 'pja.pdf', type: PageType.SECTION_DIVIDER, sectionStart: 'BLUE HORIZON' }),
    page({ n: 3, pdf: 'pja.pdf', type: PageType.UNIT_RENDERING, imgCat: ImageCategory.UNIT_EXTERIOR }),
    page({ n: 4, pdf: 'pja.pdf', type: PageType.UNIT_RENDERING, imgCat: ImageCategory.UNIT_EXTERIOR }),
    page({ n: 5, pdf: 'pja.pdf', type: PageType.UNIT_INTERIOR, imgCat: ImageCategory.UNIT_INTERIOR_LIVING }),
    page({ n: 6, pdf: 'pja.pdf', type: PageType.UNIT_INTERIOR, imgCat: ImageCategory.UNIT_INTERIOR_BATHROOM }),
    page({ n: 7, pdf: 'pja.pdf', type: PageType.UNIT_ANCHOR, imgCat: ImageCategory.FLOOR_PLAN, unitName: 'BEACH VILLA 6 BEDROOM', unitStart: true }),
    page({ n: 8, pdf: 'pja.pdf', type: PageType.SECTION_DIVIDER, sectionStart: 'CYAN SKY' }),
    page({ n: 9, pdf: 'pja.pdf', type: PageType.UNIT_RENDERING, imgCat: ImageCategory.UNIT_EXTERIOR }),
    page({ n: 10, pdf: 'pja.pdf', type: PageType.UNIT_ANCHOR, imgCat: ImageCategory.FLOOR_PLAN, unitName: 'BEACH VILLA 6 BEDROOM', unitStart: true }),
  ];

  const boundaries = scanUnitBoundaries(pages);
  check('识别出 2 个户型', boundaries.length === 2, `got ${boundaries.length}`);
  const b1 = boundaries[0], b2 = boundaries[1];
  check('户型1名称组合了系列名', b1?.unitTypeName.includes('BLUE HORIZON') === true, b1?.unitTypeName);
  check('户型1范围回溯到首张效果图 (p3)', b1?.startPage === 3, `start=${b1?.startPage}`);
  check('户型1结束于锚点页 (p7)', b1?.endPage === 7, `end=${b1?.endPage}`);
  check('户型2名称组合了系列名', b2?.unitTypeName.includes('CYAN SKY') === true, b2?.unitTypeName);
  check('户型2范围 p9-p10', b2?.startPage === 9 && b2?.endPage === 10, `${b2?.startPage}-${b2?.endPage}`);

  const assignments = assignImagesByBoundaries(pages, boundaries);
  const a1 = assignments[0];
  check('户型1: 2 张外观效果图', a1?.renderingImages.length === 2, `got ${a1?.renderingImages.length}`);
  check('户型1: 2 张室内图', a1?.interiorImages.length === 2, `got ${a1?.interiorImages.length}`);
  check('户型1: 1 张平面图', a1?.floorPlanImages.length === 1, `got ${a1?.floorPlanImages.length}`);
}

// ============ 场景2: Palm Central"锚点开头"模式(回归不被破坏) ============
console.log('\n=== 场景2: Palm Central — 一页一户型，连续锚点 ===');
{
  const pages: PageMetadata[] = [
    page({ n: 1, pdf: 'pc.pdf', type: PageType.SECTION_DIVIDER, sectionStart: '1 BEDROOM' }),
    page({ n: 2, pdf: 'pc.pdf', type: PageType.UNIT_ANCHOR, imgCat: ImageCategory.FLOOR_PLAN, unitName: 'Type A', unitStart: true }),
    page({ n: 3, pdf: 'pc.pdf', type: PageType.UNIT_ANCHOR, imgCat: ImageCategory.FLOOR_PLAN, unitName: 'Type B', unitStart: true }),
    page({ n: 4, pdf: 'pc.pdf', type: PageType.UNIT_RENDERING, imgCat: ImageCategory.UNIT_EXTERIOR }),
    page({ n: 5, pdf: 'pc.pdf', type: PageType.UNIT_ANCHOR, imgCat: ImageCategory.FLOOR_PLAN, unitName: 'Type C', unitStart: true }),
  ];

  const boundaries = scanUnitBoundaries(pages);
  check('识别出 3 个户型', boundaries.length === 3, `got ${boundaries.length}`);
  check('Type A 范围只有 p2(不偷分隔页)', boundaries[0]?.startPage === 2 && boundaries[0]?.endPage === 2,
    `${boundaries[0]?.startPage}-${boundaries[0]?.endPage}`);
  check('Type B 范围 p3-p4(锚点后页跟随,Type C 不回溯偷页)',
    boundaries[1]?.startPage === 3 && boundaries[1]?.endPage === 4,
    `${boundaries[1]?.startPage}-${boundaries[1]?.endPage}`);
  check('Type C 范围 p5', boundaries[2]?.startPage === 5, `start=${boundaries[2]?.startPage}`);
}

// ============ 场景3: 多PDF页码冲突 ============
console.log('\n=== 场景3: 多PDF — 页码各自从1开始，范围不得跨PDF串图 ===');
{
  const pages: PageMetadata[] = [
    // PDF A: 户型册
    page({ n: 1, pdf: 'a-floorplans.pdf', type: PageType.UNIT_ANCHOR, imgCat: ImageCategory.FLOOR_PLAN, unitName: 'Type A', unitStart: true }),
    page({ n: 2, pdf: 'a-floorplans.pdf', type: PageType.UNIT_RENDERING, imgCat: ImageCategory.UNIT_EXTERIOR }),
    // PDF B: 价格单页(页码1,数字上落在Type A的范围内)
    page({ n: 1, pdf: 'b-prices.pdf', type: PageType.PRICING_TABLE, imgCat: ImageCategory.DIAGRAM }),
  ];

  const boundaries = scanUnitBoundaries(pages);
  check('识别出 1 个户型', boundaries.length === 1, `got ${boundaries.length}`);
  check('边界不跨PDF (endPage=2, pdfSource=a-floorplans.pdf)',
    boundaries[0]?.endPage === 2 && boundaries[0]?.pdfSource === 'a-floorplans.pdf',
    `end=${boundaries[0]?.endPage}, pdf=${boundaries[0]?.pdfSource}`);

  const assignments = assignImagesByBoundaries(pages, boundaries);
  const allPaths = assignments[0]?.allImages.map(i => i.imagePath) || [];
  check('价格页图片没被串进户型', !allPaths.some(p => p.includes('b-prices')), allPaths.join(','));
}

// ============ 场景4: 标签归属(角标户型名跨范围认领) ============
console.log('\n=== 场景4: 效果图角标标签优先归属 ===');
{
  const pages: PageMetadata[] = [
    page({ n: 1, pdf: 'x.pdf', type: PageType.UNIT_ANCHOR, imgCat: ImageCategory.FLOOR_PLAN, unitName: 'BLUE HORIZON VILLA', unitStart: true }),
    page({ n: 2, pdf: 'x.pdf', type: PageType.UNIT_ANCHOR, imgCat: ImageCategory.FLOOR_PLAN, unitName: 'CORAL VILLA', unitStart: true }),
    // p3 落在 CORAL 范围内,但角标写着 BLUE HORIZON → 应归 BLUE HORIZON
    page({ n: 3, pdf: 'x.pdf', type: PageType.UNIT_RENDERING, imgCat: ImageCategory.UNIT_EXTERIOR, unitName: 'BLUE HORIZON', role: 'supplementary' }),
  ];

  const boundaries = scanUnitBoundaries(pages);
  const assignments = assignImagesByBoundaries(pages, boundaries);
  const blue = assignments.find(a => a.unitTypeName.includes('BLUE'));
  const coral = assignments.find(a => a.unitTypeName.includes('CORAL'));
  check('标签页归属 BLUE HORIZON', blue?.renderingImages.length === 1, `got ${blue?.renderingImages.length}`);
  check('CORAL 不含该页', (coral?.renderingImages.length || 0) === 0, `got ${coral?.renderingImages.length}`);
}

// ============ 场景5: 孤儿户型图吸收(PJA 真实失败场景) ============
console.log('\n=== 场景5: 孤儿户型图页吸收(范围只圈了照片,户型图被漏在外面) ===');
{
  // 模拟 PJA: 分隔页 → 8 张带 "BEACH VILLA A" 角标的照片 → 1 页户型图(文本无户型名)→ 下一节分隔页
  const pages: PageMetadata[] = [
    page({ n: 37, pdf: 'pja.pdf', type: PageType.SECTION_DIVIDER, sectionStart: 'INSPIRED BY' }),
    ...Array.from({ length: 8 }, (_, i) =>
      page({ n: 38 + i, pdf: 'pja.pdf', type: i < 2 ? PageType.UNIT_RENDERING : PageType.UNIT_INTERIOR,
        imgCat: i < 2 ? ImageCategory.UNIT_EXTERIOR : ImageCategory.UNIT_INTERIOR_LIVING,
        unitName: 'BEACH VILLA A', role: 'supplementary' })
    ),
    // p46 = 户型图锚点,文本里没户型名(模拟真实情况:unitName 是图里看到的 BLUE HORIZON)
    { ...page({ n: 46, pdf: 'pja.pdf', type: PageType.UNIT_ANCHOR, imgCat: ImageCategory.FLOOR_PLAN, unitName: 'BLUE HORIZON', unitStart: true }),
      unitInfo: { unitTypeName: 'BLUE HORIZON', hasDetailedSpecs: true, hasFloorPlan: true, roleInUnit: 'main', specs: { area: 7307, bedrooms: 6, bathrooms: 8 } } },
    page({ n: 47, pdf: 'pja.pdf', type: PageType.SECTION_DIVIDER, sectionStart: 'INSPIRED BY' }),
  ];

  // 模拟 section 重建只圈了照片页(漏掉 p46 户型图)—— 这正是生产失败的样子
  const reconstructed: UnitBoundary[] = [
    { unitTypeName: 'BEACH VILLA A', unitCategory: '6BR', startPage: 38, endPage: 45,
      pageCount: 8, pdfSource: 'pja.pdf', pdfSources: ['pja.pdf'] },
  ];

  const absorbed = absorbOrphanAnchors(reconstructed, pages);
  check('户型图页 p46 被吸收进 BEACH VILLA A', absorbed[0]?.endPage === 46, `end=${absorbed[0]?.endPage}`);

  const assignments = assignImagesByBoundaries(pages, absorbed);
  const a = assignments[0];
  check('吸收后户型有 1 张户型图', a?.floorPlanImages.length === 1, `got ${a?.floorPlanImages.length}`);
  check('吸收后户型有 8 张效果图', (a?.renderingImages.length || 0) + (a?.interiorImages.length || 0) === 8,
    `got rendering=${a?.renderingImages.length} interior=${a?.interiorImages.length}`);

  // 验证:不会跨分隔页吸收(p46 不能被并进下一节)
  const reconstructed2: UnitBoundary[] = [
    { unitTypeName: 'NEXT VILLA', unitCategory: '5BR', startPage: 48, endPage: 55,
      pageCount: 8, pdfSource: 'pja.pdf', pdfSources: ['pja.pdf'] },
  ];
  const absorbed2 = absorbOrphanAnchors(reconstructed2, pages);
  check('不跨分隔页:p46 不会被并进下一节(start 仍=48)', absorbed2[0]?.startPage === 48, `start=${absorbed2[0]?.startPage}`);
}

console.log(failures === 0 ? '\n🎉 全部通过' : `\n💥 ${failures} 个断言失败`);
process.exit(failures === 0 ? 0 : 1);
