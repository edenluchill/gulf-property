/**
 * 全局户型 Section 重建 Agent ⭐
 *
 * 背景：页面分类是按 5 页/chunk 独立并行做的，单页视角无法可靠判断
 * "这 8 页效果图属于哪个户型"。高端楼书（如 Palm Jebel Ali）的典型结构：
 *
 *   [分隔页 "BLUE HORIZON"] → 外观效果图×N → 室内效果图×N → 平面图(锚点)
 *
 * 本 agent 在所有页面分类完成后，把整本楼书的页面序列（纯文本，无图片）
 * 一次性交给模型，像人翻楼书一样从全局视角重建每个户型的页面范围。
 *
 * 成本：一次 gemini-3-flash 文本调用（140 页 ≈ 几千 token），约 5-15 秒。
 * 失败语义：返回 null，调用方回退本地边界扫描结果，不阻塞 job。
 */

import { meteredGenAI } from '../utils/metered-genai';
import { FLASH } from '../../services/ai/models'
import { PageMetadata, PageType } from '../types/page-metadata';
import { UnitBoundary } from '../types/assignment-result';
import { parseJsonResponse } from '../utils/json-parser';
import { withRetry } from '../utils/ai-retry';
import { TextLayerRegistry } from '../utils/text-layer';

const genAI = meteredGenAI('section-reconstructor');

const AI_TIMEOUT = 60000;

interface RawSection {
  unitTypeName: string;
  unitCategory?: string;
  pdfSource: string;
  startPage: number;
  endPage: number;
  confidence?: number;
}

/**
 * 全局重建户型 sections
 *
 * @returns UnitBoundary[]（已验证），失败或无可用结果时返回 null
 */
export async function reconstructUnitSections(
  jobId: string,
  pages: PageMetadata[]
): Promise<UnitBoundary[] | null> {
  if (pages.length === 0) return null;

  // 没有任何锚点页 → 没有户型可重建
  const anchorCount = pages.filter(p => p.pageType === PageType.UNIT_ANCHOR).length;
  if (anchorCount === 0) {
    console.log(`   [${jobId}] ℹ️  No anchor pages, skipping section reconstruction`);
    return null;
  }

  try {
    const prompt = buildPrompt(jobId, pages);

    const model = genAI.getGenerativeModel({
      model: FLASH,
      generationConfig: { responseMimeType: 'application/json' },
    });

    const parsed = await withRetry<any>(
      async () => {
        const result = await Promise.race([
          model.generateContent([prompt]),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`AI timeout after ${AI_TIMEOUT}ms`)), AI_TIMEOUT)
          ),
        ]);
        const response = await result.response;
        const p = parseJsonResponse(response.text());
        if (!p || !Array.isArray(p.sections)) {
          throw new Error('Section reconstruction returned no sections array');
        }
        return p.sections;
      },
      { label: `section-reconstructor:${jobId}`, attempts: 2 }
    );

    const boundaries = validateSections(parsed as RawSection[], pages, jobId);
    if (boundaries.length === 0) {
      console.log(`   [${jobId}] ⚠️  Section reconstruction yielded no valid sections, falling back`);
      return null;
    }

    console.log(`   [${jobId}] 🧭 Section reconstruction: ${boundaries.length} unit sections`);
    boundaries.forEach(b => {
      console.log(`      • "${b.unitTypeName}"${b.unitCategory ? ` (${b.unitCategory})` : ''}: pages ${b.startPage}-${b.endPage} (${b.pdfSource})`);
    });
    return boundaries;

  } catch (error) {
    console.warn(`   [${jobId}] ⚠️  Section reconstruction failed (falling back to local scan): ${(error as Error).message}`);
    return null;
  }
}

/**
 * 计算一组边界覆盖了多少个锚点页（用于与本地扫描结果比较择优）
 */
export function countAnchorsCovered(
  boundaries: UnitBoundary[] | undefined,
  pages: PageMetadata[]
): number {
  if (!boundaries || boundaries.length === 0) return 0;
  return pages.filter(p =>
    p.pageType === PageType.UNIT_ANCHOR &&
    boundaries.some(b =>
      b.pdfSource === p.pdfSource &&
      p.pageNumber >= b.startPage && p.pageNumber <= b.endPage
    )
  ).length;
}

// ============================================================
// Helpers
// ============================================================

function buildPrompt(jobId: string, pages: PageMetadata[]): string {
  const lines: string[] = [];
  let currentPdf = '';

  for (const page of pages) {
    if (page.pdfSource !== currentPdf) {
      currentPdf = page.pdfSource;
      lines.push(`\n=== PDF: ${currentPdf} ===`);
    }

    const parts: string[] = [`p${page.pageNumber}`, page.pageType];

    if (page.boundaryMarkers.startMarkerText) {
      parts.push(`标题:"${clip(page.boundaryMarkers.startMarkerText, 50)}"`);
    }
    if (page.unitInfo?.unitTypeName) {
      const role = page.unitInfo.roleInUnit === 'main' ? '锚点' : '角标';
      parts.push(`${role}户型:"${clip(page.unitInfo.unitTypeName, 50)}"`);
      if (page.unitInfo.unitCategory) parts.push(`类别:${page.unitInfo.unitCategory}`);
    }

    const text = TextLayerRegistry.getPageTextByName(jobId, page.pdfSource, page.pageNumber);
    if (text) {
      parts.push(`文字:"${clip(text.replace(/\s+/g, ' '), 80)}"`);
    }

    lines.push(parts.join(' | '));
  }

  return `你是楼书结构分析专家。下面是一套房地产楼书 PDF 逐页分类后的页面序列。
高端楼书常见结构：每个户型一个 section——先是只有户型/系列名的分隔页（section_divider），
然后是该户型的多页外观效果图（unit_rendering）和室内效果图（unit_interior），
最后是户型平面图页（unit_anchor，含面积规格）。也有楼书是平面图开头、附属页在后。

你的任务：从全局视角划分出每个户型的连续页面范围（section）。

规则：
1. 每个 section 必须包含至少一个 unit_anchor 页
2. section 范围内的 unit_rendering / unit_interior 页都属于该户型
3. ⭐ **户型平面图页(unit_anchor,含 FIRST/GROUND FLOOR + 面积数字)必须包含进 section,即使它的文字里没有户型名！**
   常见版式：照片页角标写"BEACH VILLA A",紧跟其后的平面图页文字只有"GROUND FLOOR…面积",没户型名——
   但它就是这个户型的平面图,endPage 必须延伸到它(到下一个分隔页之前的最后一页)。漏掉它会导致该户型没户型图、面积为空。
4. 户型名命名：优先组合"系列分隔页名 + 规格"（如 "BLUE HORIZON 6-BEDROOM BEACH VILLA"），
   保证不同户型名字互不相同；锚点页已有具体名称（如 "Type A"）则沿用
5. unitCategory 用 "Studio"/"1BR"/"2BR"/"2BR+Maid"/"3BR"/"4BR"/"5BR"/"6BR"/"7BR"/"Penthouse"/"Townhouse" 格式
6. section 不能跨 PDF；同一 PDF 内的 section 不能重叠
7. 项目介绍、位置、配套设施、价格表、付款计划等页面不属于任何 section
8. 不确定的页宁可不划入 section（但平面图页一定要划入相邻户型,见规则3）

## 页面序列
${lines.join('\n')}

## 返回 JSON

{"sections": [{"unitTypeName": "...", "unitCategory": "...", "pdfSource": "文件名", "startPage": 29, "endPage": 38, "confidence": 0.9}]}

只返回JSON。`;
}

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

/**
 * 验证AI返回的sections，转换为UnitBoundary
 *
 * 验证项：
 * - pdfSource 存在、页码范围合法
 * - 范围内至少含一个 unit_anchor 页
 * - 同一 PDF 内不重叠（重叠时保留 confidence 高的）
 */
function validateSections(
  sections: RawSection[],
  pages: PageMetadata[],
  jobId: string
): UnitBoundary[] {
  const pdfPages = new Map<string, Set<number>>();
  const anchorPages = new Map<string, Set<number>>();
  for (const p of pages) {
    if (!pdfPages.has(p.pdfSource)) pdfPages.set(p.pdfSource, new Set());
    pdfPages.get(p.pdfSource)!.add(p.pageNumber);
    if (p.pageType === PageType.UNIT_ANCHOR) {
      if (!anchorPages.has(p.pdfSource)) anchorPages.set(p.pdfSource, new Set());
      anchorPages.get(p.pdfSource)!.add(p.pageNumber);
    }
  }

  const candidates = (sections || [])
    .filter(s => {
      if (!s || typeof s.unitTypeName !== 'string' || !s.unitTypeName.trim()) return false;
      if (typeof s.startPage !== 'number' || typeof s.endPage !== 'number') return false;
      if (s.startPage > s.endPage) return false;

      const knownPages = pdfPages.get(s.pdfSource);
      if (!knownPages) {
        console.warn(`   [${jobId}] ⚠️  Section "${s.unitTypeName}" references unknown PDF "${s.pdfSource}"`);
        return false;
      }

      // 范围内必须有锚点页（防幻觉）
      const anchors = anchorPages.get(s.pdfSource);
      const hasAnchor = anchors && Array.from(anchors).some(a => a >= s.startPage && a <= s.endPage);
      if (!hasAnchor) {
        console.warn(`   [${jobId}] ⚠️  Section "${s.unitTypeName}" (p${s.startPage}-${s.endPage}) has no anchor page, dropped`);
        return false;
      }
      return true;
    })
    .sort((a, b) => (b.confidence ?? 0.5) - (a.confidence ?? 0.5));

  // 去重叠：confidence 高者优先占用页码
  const occupied = new Map<string, Set<number>>();
  const accepted: RawSection[] = [];
  for (const s of candidates) {
    if (!occupied.has(s.pdfSource)) occupied.set(s.pdfSource, new Set());
    const occ = occupied.get(s.pdfSource)!;
    let overlaps = false;
    for (let p = s.startPage; p <= s.endPage; p++) {
      if (occ.has(p)) { overlaps = true; break; }
    }
    if (overlaps) {
      console.warn(`   [${jobId}] ⚠️  Section "${s.unitTypeName}" overlaps a higher-confidence section, dropped`);
      continue;
    }
    for (let p = s.startPage; p <= s.endPage; p++) occ.add(p);
    accepted.push(s);
  }

  // 按 PDF + 页码排序，转 UnitBoundary
  accepted.sort((a, b) =>
    a.pdfSource !== b.pdfSource ? a.pdfSource.localeCompare(b.pdfSource) : a.startPage - b.startPage
  );

  return accepted.map(s => ({
    unitTypeName: s.unitTypeName.trim(),
    unitCategory: s.unitCategory?.trim() || undefined,
    startPage: s.startPage,
    endPage: s.endPage,
    pageCount: s.endPage - s.startPage + 1,
    pdfSource: s.pdfSource,
    pdfSources: [s.pdfSource],
  }));
}
