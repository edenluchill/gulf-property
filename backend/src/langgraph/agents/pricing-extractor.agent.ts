/**
 * 价格表提取器
 *
 * 从价格表页面提取户型-价格映射
 * 支持两种格式：
 * 1. 具体户型: "B-1B-B.2" → 1,850,000 AED
 * 2. 分类定价: "1 Bedroom" → 1,850,000 AED
 *
 * 同时提取 Building/Tower 上下文
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { parseJsonResponse } from '../utils/json-parser';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

/**
 * 单条价格记录
 */
export interface PricingEntry {
  // 具体户型名 (优先级高)
  unitTypeName?: string;       // "B-1B-B.2", "Type A"

  // 卧室分类 (fallback)
  unitCategory?: string;       // "Studio", "1BR", "2BR", "3BR", "4BR", "Penthouse"

  // Building/Tower 上下文
  building?: string;           // "Crestlane 4", "Tower A", "Building B"

  // 价格信息
  price: number;               // 总价 (AED)
  pricePerSqft?: number;       // 单价 (AED/sqft)

  // 面积信息 (如果价格表包含)
  area?: number;               // sqft

  // 起始价标记
  isStartingFrom?: boolean;    // "Starting from 1.85M" → true
}

/**
 * 价格表提取结果
 */
export interface PricingExtractionResult {
  // 提取的价格条目
  entries: PricingEntry[];

  // 页面级 Building 上下文 (如果整页属于某个building)
  pageBuilding?: string;

  // 置信度
  confidence: number;

  // 原始来源
  sourcePageNumber: number;
}

/**
 * 从价格表页面提取价格数据
 *
 * ⚡ OPTIMIZED: Added 20s timeout to prevent blocking
 */
export async function extractPricing(
  imageUrl: string,
  pageNumber: number,
  currentBuilding?: string  // 从上下文传入的当前building
): Promise<PricingExtractionResult> {
  const TIMEOUT_MS = 20000; // 20 seconds

  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-3-flash-preview',
      generationConfig: {
        responseMimeType: 'application/json',
      },
    });

    const prompt = createPricingPrompt(currentBuilding);

    // ⚡ Fetch image with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const imageResponse = await fetch(imageUrl, { signal: controller.signal });
    if (!imageResponse.ok) {
      clearTimeout(timeoutId);
      throw new Error(`Failed to fetch image: ${imageResponse.statusText}`);
    }
    const imageBuffer = await imageResponse.arrayBuffer();
    const base64Image = Buffer.from(imageBuffer).toString('base64');

    // ⚡ AI call with timeout
    const aiPromise = model.generateContent([
      prompt,
      {
        inlineData: {
          mimeType: 'image/jpeg',
          data: base64Image,
        },
      },
    ]);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('AI timeout')), TIMEOUT_MS);
    });

    const result = await Promise.race([aiPromise, timeoutPromise]);
    clearTimeout(timeoutId);

    const response = await result.response;
    const text = response.text();
    const parsed = parseJsonResponse(text);

    // 处理提取的数据
    const entries: PricingEntry[] = (parsed.entries || []).map((entry: any) => ({
      unitTypeName: entry.unitTypeName || undefined,
      unitCategory: normalizeCategory(entry.unitCategory),
      building: entry.building || parsed.pageBuilding || currentBuilding,
      price: parsePrice(entry.price),
      pricePerSqft: entry.pricePerSqft ? parsePrice(entry.pricePerSqft) : undefined,
      area: entry.area ? parseFloat(entry.area) : undefined,
      isStartingFrom: entry.isStartingFrom || false,
    })).filter((e: PricingEntry) => e.price > 0);  // 过滤无效价格

    console.log(`   💰 [PRICING] Extracted ${entries.length} pricing entries from page ${pageNumber}`);
    if (parsed.pageBuilding) {
      console.log(`   🏢 [PRICING] Page building context: ${parsed.pageBuilding}`);
    }

    return {
      entries,
      pageBuilding: parsed.pageBuilding || currentBuilding,
      confidence: parsed.confidence || 0.8,
      sourcePageNumber: pageNumber,
    };

  } catch (error: any) {
    if (error.name === 'AbortError' || error.message === 'AI timeout') {
      console.warn(`   ⚠️  [PRICING] Timeout on page ${pageNumber} (skipped)`);
    } else {
      console.error(`   ❌ [PRICING] Failed to extract pricing from page ${pageNumber}:`, error);
    }
    return {
      entries: [],
      confidence: 0,
      sourcePageNumber: pageNumber,
    };
  }
}

/**
 * 创建价格提取 prompt
 */
function createPricingPrompt(currentBuilding?: string): string {
  return `你是房地产价格表分析专家。从这个价格表页面提取所有价格信息。

## 任务

提取每个户型/分类的价格信息。

## 价格格式识别

价格可能以多种格式出现：
- "1,850,000 AED" → 1850000
- "1.85M" or "1.85 Million" → 1850000
- "AED 2,640,000" → 2640000
- "Starting from 1.85M" → 1850000 (标记 isStartingFrom: true)
- "2.7 million" → 2700000

## 户型识别

**具体户型名 (优先提取)：**
- "B-1B-B.2", "C-2B-A.1", "A-3BM-A.1"
- "Type A", "Type B-1", "Unit 101"

**分类定价 (如果没有具体户型名)：**
- "1 Bedroom", "1BR", "One Bedroom" → unitCategory: "1BR"
- "2 Bedroom", "2BR", "Two Bedroom" → unitCategory: "2BR"
- "Studio" → unitCategory: "Studio"
- "Penthouse", "PH" → unitCategory: "Penthouse"

## Building/Tower 识别

查找页面上的 Building/Tower 标识：
- "Crestlane 4", "Crestlane 5"
- "Tower A", "Tower B", "Tower C"
- "Building 1", "Phase 2"
- "Marina Vista", "Garden View" (如果是独立建筑名)

${currentBuilding ? `当前上下文 Building: "${currentBuilding}"（如果页面没有明确标识，使用这个）` : ''}

## 返回 JSON 格式

{
  "pageBuilding": "Crestlane 4",  // 整页属于哪个building (可选)
  "entries": [
    {
      "unitTypeName": "B-1B-B.2",     // 具体户型名 (如果有)
      "unitCategory": "1BR",           // 分类 (如果没有具体户型名)
      "building": "Crestlane 4",       // 该条目的building
      "price": 1850000,                // 总价 (数字)
      "pricePerSqft": 2100,            // 单价 (可选)
      "area": 880,                     // 面积 sqft (可选)
      "isStartingFrom": false          // 是否为起始价
    },
    {
      "unitCategory": "2BR",
      "building": "Crestlane 4",
      "price": 2640000,
      "isStartingFrom": true
    }
  ],
  "confidence": 0.9
}

## 注意事项

1. **优先提取具体户型名**，如果只有分类（1BR, 2BR）则使用分类
2. **价格必须转换为数字**，不要包含逗号或货币符号
3. **如果同一分类有多个价格**（如不同面积），都要提取
4. **识别 "Starting from" 标记**
5. **如果页面明确标注了 Building/Tower**，一定要提取

只返回 JSON。`;
}

/**
 * 规范化户型分类
 */
function normalizeCategory(category: string | undefined): string | undefined {
  if (!category) return undefined;

  const normalized = category.toLowerCase().trim();

  // Studio
  if (normalized.includes('studio')) return 'Studio';

  // 1BR
  if (normalized.includes('1 bed') || normalized.includes('1br') ||
      normalized.includes('one bed') || normalized === '1') return '1BR';

  // 2BR
  if (normalized.includes('2 bed') || normalized.includes('2br') ||
      normalized.includes('two bed') || normalized === '2') return '2BR';

  // 3BR
  if (normalized.includes('3 bed') || normalized.includes('3br') ||
      normalized.includes('three bed') || normalized === '3') return '3BR';

  // 4BR
  if (normalized.includes('4 bed') || normalized.includes('4br') ||
      normalized.includes('four bed') || normalized === '4') return '4BR';

  // 5BR+
  if (normalized.includes('5 bed') || normalized.includes('5br') ||
      normalized.includes('five bed') || normalized === '5') return '5BR';

  // Penthouse
  if (normalized.includes('penthouse') || normalized.includes('ph')) return 'Penthouse';

  // Duplex
  if (normalized.includes('duplex')) return 'Duplex';

  // Townhouse
  if (normalized.includes('townhouse') || normalized.includes('town house')) return 'Townhouse';

  return category;  // 返回原始值
}

/**
 * 解析价格字符串为数字
 */
function parsePrice(priceStr: string | number | undefined): number {
  if (typeof priceStr === 'number') return priceStr;
  if (!priceStr) return 0;

  const str = String(priceStr).toLowerCase().trim();

  // 移除货币符号和逗号
  let cleaned = str.replace(/[aed,\s]/gi, '');

  // 处理 "million" / "M" 格式
  if (cleaned.includes('million') || cleaned.endsWith('m')) {
    cleaned = cleaned.replace(/million|m/gi, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num * 1000000;
  }

  // 处理 "k" 格式 (千)
  if (cleaned.endsWith('k')) {
    cleaned = cleaned.replace(/k/gi, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num * 1000;
  }

  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}
