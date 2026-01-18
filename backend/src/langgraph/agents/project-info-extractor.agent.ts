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

import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { readFileSync } from 'fs';

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
  constructionProgress?: string;
}

/**
 * 从页面提取项目基本信息
 */
export async function extractProjectInfo(
  imagePath: string,
  pageNumber: number
): Promise<ProjectBasicInfo> {
  
  try {
    // 使用Structured Output模式
    const model = genAI.getGenerativeModel({
      model: 'gemini-3-flash-preview',
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            projectName: { type: SchemaType.STRING },
            developer: { type: SchemaType.STRING },
            address: { type: SchemaType.STRING },
            area: { type: SchemaType.STRING },
            launchDate: { type: SchemaType.STRING },
            completionDate: { type: SchemaType.STRING },
            handoverDate: { type: SchemaType.STRING },
            constructionProgress: { type: SchemaType.STRING },
            description: { type: SchemaType.STRING },
          },
        },
      },
    });

    const imageBuffer = readFileSync(imagePath);
    const imageBase64 = imageBuffer.toString('base64');

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
  "constructionProgress": "75% Complete",    // 建设进度
  "description": "A luxury residential development..."  // 项目描述
}

### 提取规则

1. **项目名称**：通常在封面大标题
2. **开发商**：通常有logo或 "by XXX"
3. **地址**：完整地址，包括区域
4. **日期格式**：
   - 可以是 "Q4 2026", "2026-12-31", "June 2028"
   - 保持原格式，不要转换
5. **描述**：项目简介、定位、特色等

### 注意事项

- 如果某个字段在页面上没有，返回null
- 不要猜测或编造信息
- 保持原始格式和语言（英文）

## 返回JSON格式

{
  "projectName": "The Edit at d3",
  "developer": "MERAAS",
  "address": "Dubai Design District (d3), Dubai, UAE",
  "area": "Dubai Design District",
  "launchDate": "2025-01-01",
  "completionDate": "Q4 2026",
  "handoverDate": "June 2028",
  "constructionProgress": "75% Complete",
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

    // ⭐ 直接解析JSON（structured output）
    const parsed = JSON.parse(text);

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
