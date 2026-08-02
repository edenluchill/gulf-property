/**
 * 户型详细信息提取器
 * 
 * 目标：从确认的户型页面提取详细信息
 * - 只在 pageType === 'unit_anchor' 时调用
 * - 专注于：specs (bedrooms, bathrooms, area...), features, description
 * - 使用详细的提取 prompt
 */

import { meteredGenAI } from '../utils/metered-genai';
import { FLASH } from '../../services/ai/models'
import { parseJsonResponse } from '../utils/json-parser';
import { withRetry } from '../utils/ai-retry';

const genAI = meteredGenAI('unit-detail-extractor');

export interface UnitDetailResult {
  specs: {
    bedrooms?: number;
    bathrooms?: number;
    area?: number;
    suiteArea?: number;
    balconyArea?: number;
    price?: number;
    pricePerSqft?: number;
  };
  features: string[];
  description: string;
}

/**
 * 提取户型详细信息
 * 
 * @param imageUrl - R2 image URL
 * @param unitTypeName - Unit type name (from classification)
 * @param pageNumber - Page number
 * @returns Detailed unit information
 */
export async function extractUnitDetails(
  imageUrl: string,
  unitTypeName: string,
  pageNumber: number,
  pageText?: string  // ⭐ PDF 文本层内容（数字提取的可靠依据）
): Promise<UnitDetailResult> {
  
  console.log(`   🔎 [UNIT-EXTRACTOR] Starting extraction for ${unitTypeName} (page ${pageNumber})`);
  console.log(`   🔎 [UNIT-EXTRACTOR] Image URL: ${imageUrl.substring(0, 100)}...`);
  
  try {
    const model = genAI.getGenerativeModel({
      model: FLASH,
      generationConfig: {
        responseMimeType: 'application/json',  // ✅ 简单模式：快速！
        // ❌ 移除 responseSchema - 太慢了！
      },
    });

    let prompt = createExtractionPrompt(unitTypeName, pageNumber);
    if (pageText) {
      prompt += `\n\n## 页面文字内容（PDF文本层，数字以此为准）\n${pageText}`;
    }
    console.log(`   🔎 [UNIT-EXTRACTOR] Prompt created, fetching image from R2...`);

    // Fetch image from R2
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      throw new Error(`Failed to fetch image from R2: ${imageResponse.statusText}`);
    }
    const imageBuffer = await imageResponse.arrayBuffer();
    const base64Image = Buffer.from(imageBuffer).toString('base64');
    console.log(`   🔎 [UNIT-EXTRACTOR] Image fetched (${imageBuffer.byteLength} bytes), calling AI...`);

    // ⏱️ Add timeout to prevent hanging
    const AI_TIMEOUT = 60000; // 60 seconds
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

    // 🔁 Retry the AI call + parse. A transient parse error or timeout must not
    // silently drop the unit's specs (area=0 → unit filtered out at submission).
    const extracted = await withRetry<UnitDetailResult>(
      async () => {
        const result = await generateWithTimeout();
        const response = await result.response;
        const text = response.text();

        // ✅ Use parseJsonResponse for fault tolerance
        const parsed = parseJsonResponse(text);

        return {
          specs: parsed.specs || {},
          features: parsed.features || [],
          description: parsed.description || '',
        };
      },
      {
        label: `unit-extractor:${unitTypeName} p${pageNumber}`,
        attempts: 3,
        // Specs are only valid when the required fields actually came back
        validate: (r) => (r.specs?.area ?? 0) > 0 && r.specs?.bedrooms != null,
      }
    );

    console.log(`   📐 Unit details extracted for ${unitTypeName}: ${extracted.specs?.bedrooms ?? 'N/A'}BR, ${extracted.specs?.area ?? 'N/A'}sqft, ${extracted.features?.length || 0} features`);

    return extracted;

  } catch (error) {
    console.error(`   ❌ [UNIT-EXTRACTOR] Error extracting unit details for ${unitTypeName}:`, error);
    console.error(`   ❌ [UNIT-EXTRACTOR] Error message:`, (error as Error).message);
    console.error(`   ❌ [UNIT-EXTRACTOR] Error stack:`, (error as Error).stack);
    console.error(`   ❌ [UNIT-EXTRACTOR] Page number: ${pageNumber}`);
    console.error(`   ❌ [UNIT-EXTRACTOR] Image URL: ${imageUrl.substring(0, 100)}...`);
    console.error(`   💡 [UNIT-EXTRACTOR] This unit will have empty specs and will be filtered during submission`);
    
    // Return empty details (will be filtered out later)
    return {
      specs: {},
      features: [],
      description: '',
    };
  }
}

/**
 * 创建提取 prompt（详细版）
 */
function createExtractionPrompt(unitTypeName: string, pageNumber: number): string {
  return `你是户型信息提取专家。从第${pageNumber}页提取户型"${unitTypeName}"的详细信息。

## 提取内容

### 1. 规格信息 (specs)

从平面图或表格提取：

**⭐ 必填字段（必须提取，不能为 null）：**
- bedrooms: 卧室数量（必填！如果是 Studio 则为 0）
- bathrooms: 浴室数量（必填！至少为 1）
- area: 总面积 (Total Area / BUA)（必填！必须 > 0）

**可选字段：**
- suiteArea: 室内面积 (Suite Area / Internal Area)
- balconyArea: 阳台面积 (Balcony / Terrace)
- price: 价格 (AED, 如果有)
- pricePerSqft: 单价 (AED/sqft, 如果有)

**面积单位：**
- sqft / sq.ft. → 平方英尺（直接使用）
- sqm / sq.m. → 平方米（转换: × 10.764）
- 迪拜通常使用 sqft

### 2. 户型特征 (features)

从平面图房间标签提取，返回字符串数组：

**阳台/户外：**
- "Balcony", "Private terrace", "Multiple balconies", "Wraparound balcony"

**卧室相关：**
- "Master bedroom", "En-suite bathroom", "Walk-in closet", "Built-in wardrobes", "Dressing room"

**浴室相关：**
- "Powder room", "Guest bathroom", "Multiple bathrooms"

**厨房相关：**
- "Open kitchen", "Closed kitchen", "Breakfast bar", "Pantry"

**附加房间：**
- "Maid's room", "Maid's bathroom", "Study room", "Storage room", "Laundry room", "Utility room"

**空间设计：**
- "Open-plan living", "Separate dining area", "Entrance foyer", "Living-dining combo"

**建筑特征：**
- "Corner unit", "High ceiling", "Floor-to-ceiling windows", "Dual-aspect", "Split-level"

**提取规则：**
- 只提取平面图上明确可见的特征
- 使用标准术语
- 至少3-5个特征

### 3. 户型描述 (description)

生成3-5句专业推销文案，包含：

1. **尺寸数据** - 引用具体面积
2. **空间布局** - 描述房间分布
3. **设计亮点** - open-plan layout, en-suite bathroom等
4. **适合人群** - 推断目标客户
5. **价值主张** - 价格/性价比（如果有）

**示例：**
"This well-designed 1-bedroom unit offers 650.5 sqft of living space with a spacious 70.2 sqft balcony, ideal for young professionals or couples. The open-plan layout seamlessly integrates the kitchen with the living area, maximizing the functional 580.3 sqft interior space. The thoughtful design places the bathroom away from the entrance, ensuring privacy, while the generous balcony provides excellent outdoor living potential."

**原则：**
- 客观、专业、数据支撑
- 不要夸张或编造
- 只描述平面图上看到的特征

## 返回 JSON

⚠️ 重要规则：
1. bedrooms, bathrooms, area 是必填字段，不能为 null
2. 如果看不清楚，尽量估算，不要返回 null
3. Studio = 0 bedrooms
4. 至少 1 个 bathroom

示例：

{
  "specs": {
    "bedrooms": 1,      // 必填！
    "bathrooms": 1,     // 必填！
    "area": 650.5,      // 必填！必须 > 0
    "suiteArea": 580.3,
    "balconyArea": 70.2,
    "price": 850000,
    "pricePerSqft": 1307
  },
  "features": [
    "Balcony",
    "Open kitchen",
    "En-suite bathroom",
    "Built-in wardrobes",
    "Open-plan living"
  ],
  "description": "This well-designed 1-bedroom unit offers 650.5 sqft..."
}

只返回 JSON，专注于详细提取。确保 bedrooms、bathrooms、area 字段有有效数值。`;
}
