/**
 * 页面分析Agent
 * 
 * 基于Visual Classifier扩展
 * 返回完整的PageMetadata（包含边界标记、户型信息等）
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { readFileSync } from 'fs';
import { 
  PageMetadata, 
  PageType, 
  PageSubType,
  ImageCategory,
  PageImage,
  BoundaryMarkers,
  UnitPageInfo,
} from '../types/page-metadata';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

/**
 * 分析单页，返回完整的PageMetadata
 * 
 * @param localImagePath - 本地图片路径（用于AI分析）
 * @param pageNumber - 全局页码
 * @param pdfSource - PDF文件名
 * @param chunkIndex - Chunk索引
 * @param jobId - Job ID（用于R2上传）
 */
export async function analyzePageWithAI(
  localImagePath: string,
  pageNumber: number,
  pdfSource: string,
  chunkIndex: number,
  jobId?: string
): Promise<PageMetadata> {
  
  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-3-flash-preview',
    });

    // 读取本地图片文件
    const imageBuffer = readFileSync(localImagePath);
    const imageBase64 = imageBuffer.toString('base64');

    const prompt = createPrompt(pageNumber);

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          mimeType: 'image/png',
          data: imageBase64,
        },
      },
    ]);

    const response = await result.response;
    const text = response.text();

    // 解析JSON
    const parsed = parseJSON(text);
    
    // 构建PageMetadata
    const metadata: PageMetadata = {
      pageNumber,
      pdfSource,
      chunkIndex,
      pageType: mapPageType(parsed.pageType),
      subTypes: parsed.subTypes?.map((st: string) => st as PageSubType) || [],
      confidence: parsed.confidence || 0.8,
      content: {
        textDensity: parsed.content?.textDensity || 'medium',
        hasTable: parsed.content?.hasTable || false,
        hasDiagram: parsed.content?.hasDiagram || false,
        hasMarketingText: parsed.content?.hasMarketingText || false,
        marketingTexts: parsed.content?.marketingTexts || [],
      },
      images: await buildImages(parsed.images || [], pageNumber, localImagePath, jobId),
      unitInfo: parsed.unitInfo ? buildUnitInfo(parsed.unitInfo) : undefined,
      boundaryMarkers: buildBoundaryMarkers(parsed.boundaryMarkers || {}),
    };

    console.log(`   ✓ Page ${pageNumber} analyzed: ${metadata.pageType} (${metadata.images.length} images)`);
    
    return metadata;

  } catch (error) {
    console.error(`   ✗ Error analyzing page ${pageNumber}:`, error);
    return await createFallback(pageNumber, pdfSource, chunkIndex, localImagePath, jobId);
  }
}

/**
 * 创建AI prompt
 */
function createPrompt(pageNumber: number): string {
  const prompt = `你是房地产PDF文档分析专家。分析第${pageNumber}页。

## ⚠️ 关键区分

### 1. Ground Floor Plan vs Unit Floor Plan

**Ground Floor Plan** (building公共区域):
- 显示大堂、Co-working、Cinema、Gym等公共设施
- 是整栋building的layout，不是住宅单元
- 页面类型应为: amenities_images 或 project_master_plan
- ❌ 不是unit_anchor！

**Unit Floor Plan** (住宅户型):
- 显示bedroom、bathroom、kitchen、living room等
- 是单个住宅单元的layout
- 有户型名称（如 "B-1B-B.2", "C-2B-A.1"）
- 页面类型: unit_anchor

### 2. 户型名称提取规则

❌ 错误：添加"Type"前缀
- "B-1B-B.2" → "Type B-1B-B.2" ❌

✅ 正确：保持原样
- "B-1B-B.2" → "B-1B-B.2" ✅
- "C-1B-A.1" → "C-1B-A.1" ✅
- "Ground Floor Plan" → 不是户型！

## 返回JSON格式

{
  "pageType": "unit_anchor",  // 或 "amenities_images" (Ground Floor Plan)
  "confidence": 0.95,
  "boundaryMarkers": {
    "isSectionStart": false,
    "isUnitStart": true,
    "startMarkerText": "B-1B-B.2"  // ⭐ 不要加"Type"
  },
  "unitInfo": {
    "unitTypeName": "B-1B-B.2",  // ⭐ 准确提取，不要加前缀
    "unitCategory": "1BR",
    "tower": "Tower A",  // 如果有标注Tower/Building
    "hasFloorPlan": true,
    "hasDetailedSpecs": true,
    "roleInUnit": "main",
    "specs": {  // ⭐ 详细规格信息
      "bedrooms": 1,  // 卧室数量
      "bathrooms": 1,  // 浴室数量
      "area": 650.5,  // 总面积 (sqft)
      "suiteArea": 580.3,  // 室内面积 (sqft)
      "balconyArea": 70.2,  // 阳台面积 (sqft)
      "price": 850000,  // 价格 (如果有)
      "pricePerSqft": 1307  // 单价 (如果有)
    }
  },
  "images": [
    {
      "category": "floor_plan",  // 住宅户型平面图
      "isFullPage": false,
      "hasDimensions": true
    }
  ]
}

## 页面类型

unit_anchor: 住宅户型详情（有bedroom, bathroom, living room）
amenities_images: 公共区域/Ground Floor（有lobby, gym, cinema, co-working）
tower_characteristics: Tower特性页（高度、单元数、配套列表）
project_summary: 项目总结（Overall Characteristics表格）
project_cover, payment_plan, section_title, unknown

## 图片类别

floor_plan: 住宅户型平面图（bedroom, bathroom）
master_plan: 公共区域平面图（lobby, gym, cinema）
building_exterior, amenity_pool, location_map, unknown

## 规格提取指南

### 从平面图或表格提取以下信息:

1. **bedrooms**: 卧室数量 (从平面图数Bedroom或表格)
2. **bathrooms**: 浴室数量 (从平面图数Bathroom或表格)
3. **area**: 总面积 (Total Area / BUA - Built Up Area)
4. **suiteArea**: 室内面积 (Suite Area / Internal Area)
5. **balconyArea**: 阳台/露台面积 (Balcony / Terrace)
6. **price**: 价格 (如果页面有标注，单位AED)
7. **pricePerSqft**: 单价 (如果有)

### 面积单位识别:
- sqft / sq.ft. / sq ft → 平方英尺
- sqm / sq.m. / sq m → 平方米 (需要转换: × 10.764)
- 如果没有明确标注，迪拜通常使用sqft

### 提取规则:
- 如果平面图上有标注 "Total: 650 sqft"，提取为area: 650
- 如果表格中有 "1BR | 1BA | 650 sqft"，提取对应数字
- 如果有多个面积标注，Total/BUA是总面积，Suite/Internal是室内面积
- 如果只有一个面积值，作为总面积(area)

## 关键提醒

1. ❌ Ground Floor Plan不是户型！→ amenities_images
2. ❌ 不要在户型名称前加"Type"
3. ✅ 户型名称保持原格式（B-1B-B.2, C-2B-A.1）
4. ⭐ 如果是unit_anchor，必须尽力提取specs信息

只返回JSON。`;

  return prompt;
}

/**
 * 解析JSON响应
 */
function parseJSON(text: string): any {
  const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || 
                   text.match(/```\s*([\s\S]*?)\s*```/) ||
                   [null, text];
  
  const jsonText = jsonMatch[1] || text;
  return JSON.parse(jsonText.trim());
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
    'section_title': PageType.SECTION_TITLE,
    'section_divider': PageType.SECTION_DIVIDER,
    'general_text': PageType.GENERAL_TEXT,
  };
  
  return map[type] || PageType.UNKNOWN;
}

/**
 * 构建图片数组（延迟R2上传）
 * ⚡ PERFORMANCE: R2上传将在chunk-processor中批量进行
 */
async function buildImages(
  aiImages: any[],
  pageNumber: number,
  localImagePath: string,
  _jobId?: string  // Unused for now, batch upload happens in chunk-processor
): Promise<PageImage[]> {
  
  // ⚡ PERFORMANCE FIX: Use local path first, batch upload later in chunk-processor
  // This avoids blocking AI analysis with individual uploads
  const imagePath = localImagePath;
  
  if (aiImages.length === 0) {
    return [{
      imageId: `page_${pageNumber}_img_0`,
      imagePath,  // Local path for now
      pageNumber,
      category: ImageCategory.UNKNOWN,
      confidence: 0.5,
      features: {
        isFullPage: true,
        hasDimensions: false,
        hasScale: false,
      },
    }];
  }
  
  // 所有图片使用同一个本地路径
  return aiImages.map((img, idx) => ({
    imageId: `page_${pageNumber}_img_${idx}`,
    imagePath,  // Local path for now
    pageNumber,
    category: mapImageCategory(img.category),
    confidence: img.confidence || 0.8,
    features: {
      isFullPage: img.isFullPage || false,
      hasDimensions: img.hasDimensions || false,
      hasScale: img.hasScale || false,
    },
    aiDescription: img.aiDescription,
    marketingText: img.marketingText,
  }));
}

/**
 * 映射图片类别
 */
function mapImageCategory(category: string): ImageCategory {
  const map: Record<string, ImageCategory> = {
    'floor_plan': ImageCategory.FLOOR_PLAN,
    'unit_exterior': ImageCategory.UNIT_EXTERIOR,
    'unit_interior_living': ImageCategory.UNIT_INTERIOR_LIVING,
    'unit_interior_bedroom': ImageCategory.UNIT_INTERIOR_BEDROOM,
    'unit_interior_kitchen': ImageCategory.UNIT_INTERIOR_KITCHEN,
    'unit_balcony': ImageCategory.UNIT_BALCONY,
    'building_exterior': ImageCategory.BUILDING_EXTERIOR,
    'building_aerial': ImageCategory.BUILDING_AERIAL,
    'location_map': ImageCategory.LOCATION_MAP,
    'amenity_pool': ImageCategory.AMENITY_POOL,
    'amenity_gym': ImageCategory.AMENITY_GYM,
    'logo': ImageCategory.LOGO,
  };
  
  return map[category] || ImageCategory.UNKNOWN;
}

/**
 * 构建户型信息
 */
function buildUnitInfo(unitInfo: any): UnitPageInfo {
  return {
    unitTypeName: unitInfo.unitTypeName,
    unitCategory: unitInfo.unitCategory,
    tower: unitInfo.tower,
    hasDetailedSpecs: unitInfo.hasDetailedSpecs || false,
    specs: unitInfo.specs,
    hasFloorPlan: unitInfo.hasFloorPlan || false,
    floorPlanImageId: unitInfo.floorPlanImageId,
    roleInUnit: unitInfo.roleInUnit || 'supplementary',
  };
}

/**
 * 构建边界标记
 */
function buildBoundaryMarkers(markers: any): BoundaryMarkers {
  return {
    isSectionStart: markers.isSectionStart || false,
    isSectionEnd: markers.isSectionEnd || false,
    isUnitStart: markers.isUnitStart || false,
    isUnitEnd: markers.isUnitEnd || false,
    startMarkerText: markers.startMarkerText,
    endMarkerText: markers.endMarkerText,
  };
}

/**
 * 创建fallback metadata（AI失败时）
 * ⚡ PERFORMANCE: Use local path, will be uploaded in batch later
 */
async function createFallback(
  pageNumber: number,
  pdfSource: string,
  chunkIndex: number,
  localImagePath: string,
  _jobId?: string  // Unused for now, batch upload happens in chunk-processor
): Promise<PageMetadata> {
  // ⚡ Use local path, batch upload will happen in chunk-processor
  const imagePath = localImagePath;
  
  return {
    pageNumber,
    pdfSource,
    chunkIndex,
    pageType: PageType.UNKNOWN,
    subTypes: [],
    confidence: 0.1,
    content: {
      textDensity: 'medium',
      hasTable: false,
      hasDiagram: false,
      hasMarketingText: false,
    },
    images: [{
      imageId: `page_${pageNumber}_img_0`,
      imagePath,
      pageNumber,
      category: ImageCategory.UNKNOWN,
      confidence: 0.1,
      features: {
        isFullPage: true,
        hasDimensions: false,
        hasScale: false,
      },
    }],
    boundaryMarkers: {
      isSectionStart: false,
      isSectionEnd: false,
      isUnitStart: false,
      isUnitEnd: false,
    },
  };
}
