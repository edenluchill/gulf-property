/**
 * 轻量级页面分类器（简化版）
 *
 * 目标：快速识别页面类型，不做深度分析
 * - 简短 prompt（~60行）
 * - 每页一个图片，不做多户型裁剪
 * - 快速分类，减少 timeout
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { FLASH } from '../../services/ai/models'
import { PageType } from '../types/page-metadata';
import { parseJsonResponse } from '../utils/json-parser';
import { withRetry } from '../utils/ai-retry';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

export interface ClassificationResult {
  pageType: PageType;
  shouldUse: boolean;
  confidence: number;
  unitTypeName?: string;      // 户型名称（unit_anchor 必填；unit_rendering/unit_interior 页有角标时也填）
  unitCategory?: string;      // 分类：Studio, 1BR, 2BR, 3BR, 4BR, Penthouse
  hasPricingTable?: boolean;  // ⭐ 页面含价格表（与 pageType 解耦：一页可同时有价格+付款计划）
  hasPaymentPlan?: boolean;   // ⭐ 页面含付款计划（同上）
  boundaryMarkers?: {
    isSectionStart: boolean;  // 章节开始（用于分割户型范围）
    isUnitStart: boolean;     // 户型开始（unit_anchor 必须为 true）
    startMarkerText?: string; // 章节/户型标题
  };
  imageInfo?: {
    category: string;         // floor_plan, unit_exterior, unit_interior_*, building_exterior, etc.
    isFullPage: boolean;
    hasDimensions: boolean;
  };
  // ⭐ 2026-07-09 一页多户型(仅 2/4/8 均衡等分):同一 unit_anchor 页并排等大画了
  // 多个户型平面图 → page-analyzer 会几何等分裁成多张,每张成独立户型。
  // units 必须按阅读顺序(左→右、上→下),数量=count;不满足则不返回(退回单户型)。
  multiUnit?: {
    count: number;                        // 2 | 4 | 8
    layout: 'horizontal' | 'vertical' | 'grid';  // 横排/纵排/网格(4=2×2,8=4×2)
    units: { unitTypeName: string; unitCategory?: string }[];
  };
}

// 兼容旧代码的导出（已废弃）
export interface DetectedUnitRegion {
  unitName: string;
  unitCategory?: string;
  bbox: { xPercent: number; yPercent: number; widthPercent: number; heightPercent: number };
}

/**
 * 快速分类页面
 */
export async function classifyPage(
  imageUrl: string,
  pageNumber: number,
  pageText?: string
): Promise<ClassificationResult> {

  try {
    const model = genAI.getGenerativeModel({
      model: FLASH,
      generationConfig: {
        responseMimeType: 'application/json',
      },
    });

    const prompt = createClassificationPrompt(pageNumber, pageText);

    // Fetch image from R2
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      throw new Error(`Failed to fetch image: ${imageResponse.statusText}`);
    }
    const imageBuffer = await imageResponse.arrayBuffer();
    const base64Image = Buffer.from(imageBuffer).toString('base64');

    // 20秒 timeout（简化后应该更快）
    const AI_TIMEOUT = 20000;
    const generateWithTimeout = async () => {
      return Promise.race([
        model.generateContent([
          prompt,
          {
            inlineData: {
              mimeType: 'image/jpeg',
              data: base64Image,
            },
          },
        ]),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`AI timeout after ${AI_TIMEOUT}ms`)), AI_TIMEOUT)
        ),
      ]);
    };

    // 🔁 Retry: a failed classification turns the page into UNKNOWN, which
    // silently drops unit_anchor pages (= whole unit types lost downstream)
    const parsed = await withRetry<any>(
      async () => {
        const result = await generateWithTimeout();
        const response = await result.response;
        const text = response.text();
        return parseJsonResponse(text);
      },
      { label: `page-classifier:p${pageNumber}`, attempts: 3 }
    );

    console.log(`   📋 Page ${pageNumber} classified: ${parsed.pageType} (confidence: ${parsed.confidence})`);

    return toClassificationResult(parsed);

  } catch (error) {
    console.error(`   ✗ Error classifying page ${pageNumber}:`, error);
    return {
      pageType: PageType.UNKNOWN,
      shouldUse: true,
      confidence: 0.1,
    };
  }
}

/**
 * 共享的页面类型判定标准（单页与批量分类共用）
 */
const PAGE_TYPE_CRITERIA = `## 页面类型

### ⭐ unit_anchor（最重要！户型平面图）
**必须同时满足：**
- 有建筑平面图布局（墙壁、房间分隔）
- 有房间标签如：Bedroom, Bathroom, Kitchen, Living, Balcony, Master, Dining
- 通常有面积标注（sqft, sqm）
- 显示住宅单元内部布局

**示例：** 1-Bedroom Floor Plan, Type A, B-1B-B.2

**⭐ 一页多户型(仅规整等分)：** 若同一页**并排等大**画了 **2 / 4 / 8** 个户型平面图
(如左右两个 "STUDIO TYPE 01" 和 "STUDIO TYPE 02",或 2×2 网格),返回 multiUnit：
- count = 户型个数(只能是 2/4/8)
- layout = horizontal(左右一排)/ vertical(上下一列)/ grid(2×2 或 4×2 网格)
- units = 每个户型的名字,**严格按阅读顺序**(左→右,再上→下),数量必须等于 count；
  units[i] 必须对应几何上第 i 块(横排=第 i 列、竖排=第 i 行),名字要读**那一块自己**印的户型标签,别按序号臆测
- ⚠️ 只在户型**等大规整排列**时返回;若数量不是 2/4/8、大小不一、或读不全名字 → **不要返回 multiUnit**(当普通单户型处理,只填一个 unitTypeName)

**⭐ 组合页(装饰系列名 + 单个户型图)：** 有些营销楼书一页里一半是深色"系列名"色块
(如 "STUDIOS"、"ONE BEDROOM APARTMENTS"),另一半是**一个真实户型平面图**。
只要页面里有**真实平面图**(墙线+房间标签+面积表),就必须分类为 **unit_anchor**,
unitTypeName 读**那张平面图自己**印的户型标签(如 "STUDIO TYPE 01"),
**禁止**用旁边的深色系列名当户型名,**禁止**设 isSectionStart(这不是分隔页,是户型页)。

### unit_rendering（户型外观效果图）
- 单个户型/别墅/联排的**外观**3D渲染图
- 艺术效果图，不是平面图，没有房间标签
- ⭐ 高端楼书常为一个户型连续放多页效果图（外观+室内），最后才是平面图——这些效果图页都属于该户型
- ⭐ 如果页面角标/标题写了户型名（如 "BEACH VILLA — 6 BEDROOM"、"3-BEDROOM TOWNHOUSE"、"Type A"），填入 unitTypeName 和 unitCategory；**读不到就留空，禁止猜测**

### unit_interior（户型室内效果图）
- 单个户型**内部**的渲染图：客厅、卧室、厨房、浴室、阳台
- 与 unit_rendering 同理：角标有户型名就填 unitTypeName，没有留空

### project_rendering（项目效果图）
- 整栋建筑/整个小区外观渲染、鸟瞰图
- 不是单个户型（区分：单栋别墅/单个单元的渲染 = unit_rendering）

### amenities_images（配套设施）
- 泳池、健身房、大堂等公共区域
- Ground Floor Plan（有lobby, gym, pool标签）
- 不是住宅户型

### pricing_table（价格表）
- 价格列表
- 有价格数字（AED, Million）

### payment_plan（付款计划）
- 付款时间表
- 有百分比和日期

⭐ **价格与付款计划可能在同一页**（如 "STARTING PRICES" + "PAYMENT PLAN" 两块）。
每一页都独立判断 hasPricingTable 和 hasPaymentPlan 两个布尔值（与 pageType 无关，两者可同时为 true）。

### section_divider（分隔页）
- 只有标题，没有实质内容（**没有平面图、没有房间标签、没有面积表**）
- shouldUse: false
- ⭐ 常见形态：整页深色/满版底色，只居中放一个大系列名（如 "STUDIOS"、"ONE BEDROOM
  APARTMENTS"、"APARTMENTS"、"PENTHOUSES"、"THE BEACH COLLECTION"、"BLUE HORIZON"）。
  这类**纯系列名封面页**一律 section_divider（**绝不是 unit_anchor**，别因为写了 "STUDIO"/"BEDROOM" 就当户型图）
- ⭐ 必须设 isSectionStart: true 并把标题原文填进 startMarkerText，后续页面靠它归属户型
- ⚠️ 但若这一页**同时含有真实平面图**（半版色块+半版户型图），那是**组合页 → unit_anchor**（见上），不是分隔页

### 其他类型
- project_cover: 封面
- project_overview: 项目介绍
- amenities_list: 配套列表
- section_title: 章节标题
- general_text: 文字页
- unknown: 无法识别

## ⚠️ 关键区分

**unit_anchor vs unit_rendering：**
- unit_anchor = 平面图（有墙壁线条、房间标签）
- unit_rendering = 效果图（3D渲染、艺术风格）

**unit_anchor vs amenities_images：**
- unit_anchor = 住宅户型（Bedroom, Bathroom）
- amenities_images = 公共区域（Lobby, Gym, Pool）

**如果页面有房间标签如 "Master Bedroom", "Bathroom", "Kitchen"，必须分类为 unit_anchor！**`;

const CLASSIFICATION_JSON_SHAPE = `{
  "pageType": "unit_anchor",
  "shouldUse": true,
  "confidence": 0.95,
  "unitTypeName": "Type A",
  "unitCategory": "1BR",
  "hasPricingTable": false,
  "hasPaymentPlan": false,
  "boundaryMarkers": {
    "isSectionStart": false,
    "isUnitStart": true,
    "startMarkerText": "Type A"
  },
  "imageInfo": {
    "category": "floor_plan",
    "isFullPage": true,
    "hasDimensions": true
  }
}

一页多户型时额外加(否则整个省略 multiUnit 字段)。units 顺序 = 物理阅读顺序(左→右),
读每块自己印的标签,别按序号猜。若左边那块印的是 TYPE 02、右边印 TYPE 01,就照实填 [TYPE 02, TYPE 01]：
"multiUnit": { "count": 2, "layout": "horizontal", "units": [ {"unitTypeName":"STUDIO TYPE 01","unitCategory":"Studio"}, {"unitTypeName":"STUDIO TYPE 02","unitCategory":"Studio"} ] }

imageInfo.category 只能从以下枚举中选（禁止其他值）：
floor_plan | unit_exterior | unit_interior_living | unit_interior_bedroom | unit_interior_kitchen | unit_interior_bathroom | unit_balcony | building_exterior | building_aerial | building_entrance | location_map | master_plan | amenity_pool | amenity_gym | amenity_garden | amenity_lounge | amenity_other | logo | diagram | unknown

对应规则：unit_rendering 页 → unit_exterior；unit_interior 页 → unit_interior_*（按房间）；project_rendering 页 → building_exterior 或 building_aerial`;

/**
 * 分类 prompt（单页）
 */
function createClassificationPrompt(pageNumber: number, pageText?: string): string {
  const textSection = pageText
    ? `\n## 页面文字内容（PDF文本层，辅助判断，可信度高）\n${pageText}\n`
    : '';
  return `你是PDF页面分类专家。快速识别第${pageNumber}页的类型。

${PAGE_TYPE_CRITERIA}
${textSection}
## 返回 JSON

${CLASSIFICATION_JSON_SHAPE}

只返回JSON。`;
}

/**
 * 把解析后的 JSON 转成 ClassificationResult
 */
function toClassificationResult(parsed: any): ClassificationResult {
  return {
    pageType: mapPageType(parsed.pageType),
    shouldUse: parsed.shouldUse !== false,
    confidence: parsed.confidence || 0.8,
    unitTypeName: parsed.unitTypeName || undefined,
    unitCategory: parsed.unitCategory || undefined,
    hasPricingTable: parsed.hasPricingTable === true,
    hasPaymentPlan: parsed.hasPaymentPlan === true,
    boundaryMarkers: parsed.boundaryMarkers || {
      isSectionStart: false,
      isUnitStart: false,
    },
    imageInfo: parsed.imageInfo,
    multiUnit: parseMultiUnit(parsed.multiUnit),
  };
}

/**
 * 校验多户型切分:只接受 2/4/8 均衡等分、且每个户型名字齐全的情况;
 * 任何不满足(数量非 2/4/8、layout 非法、名字不全)一律返回 undefined → 退回单户型,
 * 避免把不规则版式切坏(用户要求先只做规整等分)。
 */
function parseMultiUnit(raw: any): ClassificationResult['multiUnit'] {
  if (!raw || typeof raw !== 'object') return undefined;
  const count = Number(raw.count);
  const layout = raw.layout;
  if (![2, 4, 8].includes(count)) return undefined;
  if (!['horizontal', 'vertical', 'grid'].includes(layout)) return undefined;
  const units = Array.isArray(raw.units) ? raw.units : [];
  const named = units.filter((u: any) => u && typeof u.unitTypeName === 'string' && u.unitTypeName.trim());
  if (named.length !== count) return undefined; // 名字必须齐全,否则退回单户型
  return {
    count,
    layout,
    units: named.map((u: any) => ({
      unitTypeName: String(u.unitTypeName).trim(),
      unitCategory: u.unitCategory ? String(u.unitCategory) : undefined,
    })),
  };
}

export interface BatchClassifyInput {
  pageNumber: number;
  imageUrl: string;     // R2 URL ('large' variant)
  pageText?: string;    // clipped text-layer content
}

/**
 * ⚡ 批量分类：一次调用分类整个 chunk 的页面（默认 5 页/chunk）。
 *
 * 实验验证（2026-06-12，125页）：关键页（unit_anchor/pricing/payment）
 * 在 batch=4~12 下 100% 命中；batch≤6 总体一致率最高。
 *
 * 失败语义：整体失败时抛错，调用方降级为逐页 classifyPage；
 * 返回的 Map 可能缺个别页（模型漏返回），调用方同样逐页补。
 */
export async function classifyPagesBatch(
  pages: BatchClassifyInput[]
): Promise<Map<number, ClassificationResult>> {
  if (pages.length === 0) return new Map();

  const model = genAI.getGenerativeModel({
    model: FLASH,
    generationConfig: { responseMimeType: 'application/json' },
  });

  // 并行拉取图片
  const images = await Promise.all(
    pages.map(async p => {
      const res = await fetch(p.imageUrl);
      if (!res.ok) throw new Error(`Failed to fetch image for page ${p.pageNumber}: ${res.statusText}`);
      return Buffer.from(await res.arrayBuffer()).toString('base64');
    })
  );

  const pageNums = pages.map(p => p.pageNumber);
  const textSections = pages
    .filter(p => p.pageText)
    .map(p => `--- 第${p.pageNumber}页文字 ---\n${p.pageText}`)
    .join('\n');

  const prompt = `你是PDF页面分类专家。你将收到 ${pages.length} 张楼书页面图片，按顺序对应页码: ${pageNums.join(', ')}。对每一页独立分类。

${PAGE_TYPE_CRITERIA}
${textSections ? `\n## 部分页面的文字内容（PDF文本层，辅助判断，可信度高）\n${textSections}\n` : ''}
## 返回 JSON

返回 {"pages": [...]}，数组长度必须等于 ${pages.length}，顺序与图片一致。每个元素的结构（必须包含 pageNumber）：

${CLASSIFICATION_JSON_SHAPE.replace('{\n', `{\n  "pageNumber": ${pageNums[0]},\n`)}

只返回JSON。`;

  const AI_TIMEOUT = 40000;
  const parsed = await withRetry<any>(
    async () => {
      const result = await Promise.race([
        model.generateContent([
          prompt,
          ...images.map(data => ({ inlineData: { mimeType: 'image/jpeg', data } })),
        ]),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`AI timeout after ${AI_TIMEOUT}ms`)), AI_TIMEOUT)
        ),
      ]);
      const response = await result.response;
      const p = parseJsonResponse(response.text());
      const arr = p.pages || p;
      if (!Array.isArray(arr) || arr.length === 0) {
        throw new Error(`Batch classify returned no array (got ${typeof arr})`);
      }
      return arr;
    },
    {
      label: `page-classifier-batch:p${pageNums[0]}-${pageNums[pageNums.length - 1]}`,
      attempts: 2,
      // 软校验：返回数量应当齐全；不全也接受（缺的页由调用方逐页补）
      validate: (arr: any) => Array.isArray(arr) && arr.length >= pages.length,
    }
  );

  const results = new Map<number, ClassificationResult>();
  (parsed as any[]).forEach((entry, idx) => {
    // pageNumber 缺失时按顺序对位
    const pageNum = Number(entry.pageNumber) || pageNums[idx];
    if (pageNums.includes(pageNum) && !results.has(pageNum)) {
      results.set(pageNum, toClassificationResult(entry));
      console.log(`   📋 Page ${pageNum} classified (batch): ${entry.pageType} (confidence: ${entry.confidence})`);
    }
  });

  return results;
}

/**
 * 映射页面类型
 */
function mapPageType(type: string): PageType {
  const map: Record<string, PageType> = {
    'unit_anchor': PageType.UNIT_ANCHOR,
    'unit_floorplan_only': PageType.UNIT_FLOORPLAN_ONLY,
    'unit_rendering': PageType.UNIT_RENDERING,
    'unit_interior': PageType.UNIT_INTERIOR,
    'unit_detail': PageType.UNIT_DETAIL,
    'project_cover': PageType.PROJECT_COVER,
    'project_overview': PageType.PROJECT_OVERVIEW,
    'project_summary': PageType.PROJECT_SUMMARY,
    'tower_characteristics': PageType.TOWER_CHARACTERISTICS,
    'project_rendering': PageType.PROJECT_RENDERING,
    'project_aerial': PageType.PROJECT_AERIAL,
    'project_location_map': PageType.PROJECT_LOCATION_MAP,
    'amenities_list': PageType.AMENITIES_LIST,
    'amenities_images': PageType.AMENITIES_IMAGES,
    'payment_plan': PageType.PAYMENT_PLAN,
    'pricing_table': PageType.PRICING_TABLE,
    'section_title': PageType.SECTION_TITLE,
    'section_divider': PageType.SECTION_DIVIDER,
    'general_text': PageType.GENERAL_TEXT,
    'back_cover': PageType.BACK_COVER,
  };

  return map[type] || PageType.UNKNOWN;
}
