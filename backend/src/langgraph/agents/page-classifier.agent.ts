/**
 * 轻量级页面分类器
 * 
 * 目标：快速识别页面类型，不做深度分析
 * - Prompt 简短（~80 行 vs page-analyzer 的 ~350 行）
 * - 只返回基本信息：pageType, shouldUse, confidence, unitTypeName
 * - 为后续详细提取做准备
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { PageType } from '../types/page-metadata';
import { parseJsonResponse } from '../utils/json-parser';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

export interface ClassificationResult {
  pageType: PageType;
  shouldUse: boolean;
  confidence: number;
  unitTypeName?: string;  // 如果是户型页且可见
  unitCategory?: string;  // 快速判断的分类（Studio, 1BR, 2BR...）
  boundaryMarkers?: {
    isSectionStart: boolean;
    isUnitStart: boolean;
    startMarkerText?: string;
  };
  imageInfo?: {
    category: string;  // floor_plan, master_plan, building_exterior, etc.
    isFullPage: boolean;
    hasDimensions: boolean;
  };
}

/**
 * 快速分类页面
 * 
 * @param imageUrl - R2 image URL
 * @param pageNumber - Page number
 * @returns Classification result
 */
export async function classifyPage(
  imageUrl: string,
  pageNumber: number
): Promise<ClassificationResult> {
  
  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-3-flash-preview',  // 使用最快的模型
      generationConfig: {
        responseMimeType: 'application/json',  // ✅ 简单模式 - 快速！
      },
    });

    const prompt = createClassificationPrompt(pageNumber);

    // Fetch image from R2
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      throw new Error(`Failed to fetch image from R2: ${imageResponse.statusText}`);
    }
    const imageBuffer = await imageResponse.arrayBuffer();
    const base64Image = Buffer.from(imageBuffer).toString('base64');

    // ⏱️ Add timeout to prevent hanging
    const AI_TIMEOUT = 30000; // 30 seconds (classification is faster)
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
          setTimeout(() => reject(new Error(`AI call timeout after ${AI_TIMEOUT}ms`)), AI_TIMEOUT)
        ),
      ]);
    };

    const result = await generateWithTimeout();
    const response = await result.response;
    const text = response.text();
    const parsed = parseJsonResponse(text);

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
      imageInfo: parsed.imageInfo,  // ⭐ 用于图片分配
    };

  } catch (error) {
    console.error(`   ✗ Error classifying page ${pageNumber}:`, error);
    // Fallback: assume unknown page
    return {
      pageType: PageType.UNKNOWN,
      shouldUse: true,  // Conservative: show by default
      confidence: 0.1,
    };
  }
}

/**
 * 创建分类 prompt（简短版）
 */
function createClassificationPrompt(pageNumber: number): string {
  return `你是PDF页面分类专家。快速识别第${pageNumber}页的类型。

## 页面类型分类

**户型相关：**
- unit_anchor: 住宅户型平面图（有bedroom, bathroom, kitchen, living room标签）
- unit_rendering: 户型效果图
- unit_interior: 户型室内图
- unit_detail: 户型详情表格

**项目相关：**
- project_cover: 项目封面/Logo页
- project_overview: 项目概览
- project_summary: 项目总结表格（Overall Characteristics）
- project_rendering: 项目外观效果图
- project_location_map: 位置地图
- tower_characteristics: Tower特性页（Tower A/B/C信息）

**配套设施：**
- amenities_list: 配套设施列表
- amenities_images: 配套设施图片（Ground Floor Plan属于这里，不是unit_anchor！）

**商业信息：**
- payment_plan: 付款计划表
- pricing_table: 价格表

**其他：**
- section_title: 章节标题页（有标题+内容预览）
- section_divider: 纯分隔页（只有标题+背景，无实质内容）
- general_text: 普通文字页
- unknown: 无法识别

## 关键区分

**Ground Floor Plan vs Unit Floor Plan：**
- Ground Floor = 公共区域（lobby, gym, pool, co-working）→ amenities_images
- Unit Floor Plan = 住宅单元（bedroom, bathroom, kitchen）→ unit_anchor

**Section Title vs Section Divider：**
- Section Title = 有标题+内容/列表 → shouldUse: true
- Section Divider = 只有标题+背景 → shouldUse: false

**⚠️ 重要：户型平面图 vs 分隔页：**
如果页面包含以下任何特征，**必须分类为 unit_anchor，不能分类为 section_divider**：
- 平面图布局（即使简单）
- 房间标签（bedroom, bathroom, living, kitchen, balcony）
- 面积标注（sqft, sqm）
- 户型代码（如 A-3B-C.2, Type A, S1）
- **即使页面简单或看起来像分隔页，只要有平面图就是 unit_anchor！**

## 户型名称识别

如果是 unit_anchor，提取户型名称：
- 格式：B-1B-B.2, C-2B-A.1, Type A, S1 等
- **不要添加"Type"前缀**，保持原格式
- 同时快速判断 unitCategory: Studio, 1BR, 2BR, 3BR, 4BR, 5BR, Penthouse

## boundaryMarkers 设置（重要！用于图片分配）

**什么时候设置 isUnitStart = true：**
- 页面是 unit_anchor（户型平面图）
- 页面上显示了户型名称（如 "B-1B-B.2", "Type A"）
- 这是该户型的**第一页/主页**
- **必须设置！** 否则图片无法分配到户型

**什么时候设置 isSectionStart = true：**
- 章节标题页（如 "FLOOR PLANS", "AMENITIES", "TOWER A"）
- 新章节的开始
- 用于结束上一个户型的范围

**startMarkerText：**
- 如果 isUnitStart = true，设置为户型名称
- 如果 isSectionStart = true，设置为章节标题

**示例：**
- 户型平面图页面（显示 "B-1B-B.2"）→ isUnitStart: true, startMarkerText: "B-1B-B.2"
- 章节标题页（显示 "TOWER A"）→ isSectionStart: true, startMarkerText: "TOWER A"
- 普通页面 → isUnitStart: false, isSectionStart: false

## shouldUse 判断

**默认 true（显示），只有以下情况为 false：**
- 完全空白页
- 纯分隔页（只有"Tower A"或"AMENITIES"等单个词）
- 重复的版权页

**原则：宁可多显示，不要漏掉有用内容。**

## 图片分类（重要！用于图片分配）

**必须判断图片类别，才能正确分配到户型或项目：**

- floor_plan: 住宅户型平面图（有bedroom, bathroom标签）
- master_plan: 公共区域平面图（lobby, gym, pool）
- building_exterior: 建筑外观图
- unit_rendering: 户型效果图
- unit_interior_*: 户型室内图（living, bedroom, kitchen）
- amenity_*: 配套设施图（pool, gym）
- location_map: 位置地图
- logo: Logo/封面
- unknown: 无法识别

**判断规则：**
- unit_anchor 页面 → 通常是 floor_plan
- amenities_images 页面 → 通常是 master_plan 或 amenity_*
- project_rendering 页面 → 通常是 building_exterior
- 快速判断即可

## 返回 JSON

{
  "pageType": "unit_anchor",
  "shouldUse": true,
  "confidence": 0.95,
  "unitTypeName": "B-1B-B.2",  // 如果是户型且可见
  "unitCategory": "1BR",       // 快速分类
  "boundaryMarkers": {
    "isSectionStart": false,
    "isUnitStart": true,
    "startMarkerText": "B-1B-B.2"
  },
  "imageInfo": {
    "category": "floor_plan",
    "isFullPage": true,
    "hasDimensions": true
  }
}

只返回 JSON，快速判断即可，不要深度分析。`;
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
