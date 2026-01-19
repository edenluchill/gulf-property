/**
 * 项目基本信息提取Agent
 * 
 * 从封面、概览页等提取：
 * - 项目名称
 * - 开发商
 * - 地址、区域
 * - 发布日期、交付日期
 * - 项目描述
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { readFileSync } from 'fs';
import { parseJsonResponse } from '../utils/json-parser';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

export interface ProjectBasicInfo {
  projectName?: string;
  developer?: string;
  address?: string;
  area?: string;
  launchDate?: string;
  completionDate?: string;
  handoverDate?: string;
  description?: string;
  constructionProgress?: number;  // Percentage: 0-100
}

/**
 * 从页面提取项目基本信息
 */
export async function extractProjectInfo(
  imagePath: string,
  pageNumber: number
): Promise<ProjectBasicInfo> {
  
  try {
    // ⭐ 简化：只使用 JSON mode（和其他 agents 一致，避免 schema 卡住）
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

    const prompt = `你是房地产项目信息提取专家。从这一页提取项目基本信息。

## 需要提取的信息

### 1. 项目基本信息
{
  "projectName": "The Edit at d3",           // 项目名称
  "developer": "MERAAS",                     // 开发商
  "address": "Dubai Design District (d3)",   // 详细地址
  "area": "Dubai Design District",           // 区域/地段
  "launchDate": "2025-01-01",                // 发布日期
  "completionDate": "Q4 2026",               // 竣工日期
  "handoverDate": "June 2028",               // 交付日期
  "constructionProgress": 75,                // 建设进度（0-100的数字）
  "description": "A luxury residential development..."  // 项目描述
}

### 提取规则

1. **项目名称**：通常在封面大标题
2. **开发商**：通常有logo或 "by XXX"
3. **地址**：完整地址，包括区域
4. **日期格式**：
   - 可以是 "Q4 2026", "2026-12-31", "June 2028"
   - 保持原格式，不要转换
5. **项目描述（非常重要！必须提取）**：
   - 提取页面上**所有**关于项目的文字内容
   - 包括：
     * 大标题下方的副标题或标语
     * 任何介绍性段落
     * 营销口号和宣传语
     * 项目特点列表（合并成段落）
     * 位置优势、生活方式、周边环境描述
     * 建筑风格、设计理念等
   - **即使只有一两句话也必须提取**
   - **优先提取任何描述性文字，不要返回空值**
   - 合并所有相关文字，用句号或空格分隔
   - 目标：至少50字以上的描述
   - **示例**："The Edit at d3 is a landmark residential development in the heart of Dubai Design District, offering contemporary living spaces with world-class amenities and stunning views of the city skyline. Experience urban luxury living with cutting-edge design and premium facilities."

### 注意事项

- **优先提取描述性文字段落**，不是标题或标语
- 如果某个字段在页面上没有，不要包含该字段
- 不要猜测或编造信息
- 保持原始格式和语言（英文）
- Description 应该是完整的段落，不是简单的一句话

## 返回JSON格式

{
  "projectName": "The Edit at d3",
  "developer": "MERAAS",
  "address": "Dubai Design District (d3), Dubai, UAE",
  "area": "Dubai Design District",
  "launchDate": "2025-01-01",
  "completionDate": "Q4 2026",
  "handoverDate": "June 2028",
  "constructionProgress": 75,
  "description": "A landmark residential development in the heart of Dubai Design District..."
}

只返回JSON，如果某字段没有就不要包含该字段。`;

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

    console.log(`   ✓ Project info extracted from page ${pageNumber}:`, Object.keys(parsed).join(', '));

    return parsed;

  } catch (error) {
    console.error(`   ✗ Error extracting project info from page ${pageNumber}:`, error);
    return {};
  }
}

/**
 * 从多个页面合并项目信息
 * 
 * 策略：
 * - 如果多页都有同一字段，选择最长/最详细的
 * - 合并所有非空字段
 * - ⭐ 如果没有description，生成一个基本的
 */
export function mergeProjectInfo(infos: ProjectBasicInfo[]): ProjectBasicInfo {
  const merged: ProjectBasicInfo = {};
  
  infos.forEach(info => {
    Object.entries(info).forEach(([key, value]) => {
      if (value) {
        const currentValue = merged[key as keyof ProjectBasicInfo];
        
        // 策略：选择更详细的（字符串更长的）
        if (!currentValue || 
            (typeof value === 'string' && typeof currentValue === 'string' && value.length > currentValue.length)) {
          (merged as any)[key] = value;
        }
      }
    });
  });
  
  console.log('\n🏗️  Merged project info:', Object.keys(merged).join(', '));
  
  return merged;
}
