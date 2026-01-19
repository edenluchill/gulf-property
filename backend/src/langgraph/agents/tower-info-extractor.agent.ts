/**
 * Tower/Building信息提取Agent
 * 
 * 从Tower特性页面提取：
 * - Tower高度、楼层数
 * - 住宅单元数、类型
 * - 室内外配套设施
 * - 相关图片
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { readFileSync } from 'fs';
import { parseJsonResponse } from '../utils/json-parser';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

export interface TowerInfo {
  towerName: string;                // Tower名称（A, B, C）
  height?: string;                  // 高度
  floors?: number;                  // 楼层数
  totalUnits?: number;              // 总单元数
  unitTypes?: string[];             // 单元类型
  indoorAmenities?: string[];       // 室内配套
  outdoorAmenities?: string[];      // 室外配套
  specialFeatures?: string[];       // 特色设施
  images?: string[];                // 相关图片
}

/**
 * 从Tower特性页面提取信息
 */
export async function extractTowerInfo(
  imagePath: string,
  pageNumber: number
): Promise<TowerInfo | null> {
  
  try {
    // ⭐ 简化：只使用 JSON mode（避免 schema 卡住）
    const model = genAI.getGenerativeModel({
      model: 'gemini-3-flash-preview',
      generationConfig: {
        responseMimeType: 'application/json',
      },
    });

    // ⭐ Support both local paths and R2 URLs
    let imageBase64: string;
    
    if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
      // Fetch from R2
      const imageResponse = await fetch(imagePath);
      if (!imageResponse.ok) {
        throw new Error(`Failed to fetch image from R2: ${imageResponse.statusText}`);
      }
      const imageBuffer = await imageResponse.arrayBuffer();
      imageBase64 = Buffer.from(imageBuffer).toString('base64');
    } else {
      // Read from local file
      const imageBuffer = readFileSync(imagePath);
      imageBase64 = imageBuffer.toString('base64');
    }

    const prompt = `你是房地产Tower/Building信息提取专家。从这一页提取Tower信息。

## 需要提取的信息

### 识别Tower名称
- Tower A, Tower B, Tower C 等
- 或 Building 1, Building 2 等

### 提取Tower特性
{
  "towerName": "Tower A",
  "height": "3 Basements + Ground + 30 Floors",
  "floors": 30,
  "totalUnits": 182,
  "unitTypes": ["1-Bedroom", "2-Bedroom", "2-Bedroom + Maid", "3-Bedroom + Maid", "4-Bedroom + Maid", "Penthouses"],
  
  "indoorAmenities": [
    "Grand Double-height Entrance Lobby",
    "Co-working & Gallery Space",
    "Social Club, Arcade, Lounge & Library",
    "Cinema Room",
    "Gym (Indoor & Outdoor)",
    "Yoga Studio"
  ],
  
  "outdoorAmenities": [
    "Padel Court",
    "Resort-style Family Pool & Lap Pool",
    "Kids' Pool",
    "BBQ Area / California Rooms",
    "Sky Garden Gathering Spaces",
    "Sky Garden Wellness Terrace"
  ],
  
  "specialFeatures": [
    "Sky Lounge (15th Floor)",
    "Reading / Quiet Rooms (8th Floor)",
    "Wellness Studio (24th Floor)"
  ]
}

### 提取规则

1. **配套设施分类**：
   - Indoor Amenities: 室内设施（健身房、影院、休息室等）
   - Outdoor Amenities: 室外设施（泳池、花园、运动场等）
   - Special Features: 特色设施（Sky Garden, Rooftop等）

2. **从页面文字提取**：
   - 准确提取设施名称（保持英文）
   - 提取楼层信息（如 "15th Floor"）

3. **如果页面有多个Tower**：
   - 只提取当前页的Tower
   - 根据标题判断（如 "Tower A Characteristics"）

## 返回JSON格式

{
  "towerName": "Tower A",
  "height": "3 Basements + Ground + 30 Floors",
  "floors": 30,
  "totalUnits": 182,
  "unitTypes": ["1-Bedroom", "2-Bedroom", ...],
  "indoorAmenities": ["Grand Double-height Entrance Lobby", ...],
  "outdoorAmenities": ["Padel Court", ...],
  "specialFeatures": ["Sky Lounge (15th Floor)", ...]
}

如果不是Tower信息页，返回null。只返回JSON。`;

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

    // ⭐ 解析JSON（自动处理markdown code fences）
    const parsed = parseJsonResponse(text);
    
    if (!parsed || !parsed.towerName) {
      return null;
    }

    console.log(`   ✓ Tower info extracted: ${parsed.towerName}, ${parsed.indoorAmenities?.length || 0} indoor, ${parsed.outdoorAmenities?.length || 0} outdoor amenities`);

    return parsed;

  } catch (error) {
    console.error(`   ✗ Error extracting tower info from page ${pageNumber}:`, error);
    return null;
  }
}

/**
 * 批量提取Tower信息
 */
export async function extractTowerInfos(
  towerPages: Array<{ imagePath: string; pageNumber: number }>
): Promise<TowerInfo[]> {
  
  console.log(`\n🏢 Extracting tower information from ${towerPages.length} pages...`);
  
  const infos = await Promise.all(
    towerPages.map(page => 
      extractTowerInfo(page.imagePath, page.pageNumber)
    )
  );
  
  // 过滤掉null
  const validInfos = infos.filter(info => info !== null) as TowerInfo[];
  
  console.log(`   ✓ Extracted ${validInfos.length} tower infos`);
  
  return validInfos;
}
