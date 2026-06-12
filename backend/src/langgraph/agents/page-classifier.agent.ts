/**
 * 轻量级页面分类器（简化版）
 *
 * 目标：快速识别页面类型，不做深度分析
 * - 简短 prompt（~60行）
 * - 每页一个图片，不做多户型裁剪
 * - 快速分类，减少 timeout
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { PageType } from '../types/page-metadata';
import { parseJsonResponse } from '../utils/json-parser';
import { withRetry } from '../utils/ai-retry';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

export interface ClassificationResult {
  pageType: PageType;
  shouldUse: boolean;
  confidence: number;
  unitTypeName?: string;      // 户型名称（如果是 unit_anchor）
  unitCategory?: string;      // 分类：Studio, 1BR, 2BR, 3BR, 4BR, Penthouse
  boundaryMarkers?: {
    isSectionStart: boolean;  // 章节开始（用于分割户型范围）
    isUnitStart: boolean;     // 户型开始（unit_anchor 必须为 true）
    startMarkerText?: string; // 章节/户型标题
  };
  imageInfo?: {
    category: string;         // floor_plan, building_exterior, etc.
    isFullPage: boolean;
    hasDimensions: boolean;
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
  pageNumber: number
): Promise<ClassificationResult> {

  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-3-flash-preview',
      generationConfig: {
        responseMimeType: 'application/json',
      },
    });

    const prompt = createClassificationPrompt(pageNumber);

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

    return {
      pageType: mapPageType(parsed.pageType),
      shouldUse: parsed.shouldUse !== false,
      confidence: parsed.confidence || 0.8,
      unitTypeName: parsed.unitTypeName,
      unitCategory: parsed.unitCategory,
      boundaryMarkers: parsed.boundaryMarkers || {
        isSectionStart: false,
        isUnitStart: false,
      },
      imageInfo: parsed.imageInfo,
    };

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
 * 分类 prompt
 */
function createClassificationPrompt(pageNumber: number): string {
  return `你是PDF页面分类专家。快速识别第${pageNumber}页的类型。

## 页面类型

### ⭐ unit_anchor（最重要！户型平面图）
**必须同时满足：**
- 有建筑平面图布局（墙壁、房间分隔）
- 有房间标签如：Bedroom, Bathroom, Kitchen, Living, Balcony, Master, Dining
- 通常有面积标注（sqft, sqm）
- 显示住宅单元内部布局

**示例：** 1-Bedroom Floor Plan, Type A, B-1B-B.2

### unit_rendering（户型效果图）
- 室内或室外的3D渲染图
- 艺术效果图，不是平面图
- 没有房间标签

### project_rendering（项目效果图）
- 整栋建筑外观渲染
- 小区鸟瞰图
- 不是单个户型

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

### section_divider（分隔页）
- 只有标题，没有实质内容
- shouldUse: false

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

**如果页面有房间标签如 "Master Bedroom", "Bathroom", "Kitchen"，必须分类为 unit_anchor！**

## 返回 JSON

{
  "pageType": "unit_anchor",
  "shouldUse": true,
  "confidence": 0.95,
  "unitTypeName": "Type A",
  "unitCategory": "1BR",
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

只返回JSON。`;
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
