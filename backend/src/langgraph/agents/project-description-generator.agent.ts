/**
 * 项目描述生成器
 * 
 * 在收集完所有信息后，用AI生成综合的项目描述
 * - 基于项目信息（名称、开发商、区域、日期等）
 * - 基于单元统计（户型数量、面积范围、价格范围）
 * - 基于配套设施（健身房、泳池等）
 * - 生成3-5句话的专业描述
 */

import { meteredGenAI } from '../utils/metered-genai';
import { FLASH } from '../../services/ai/models'

const genAI = meteredGenAI('project-description-generator');

export interface ProjectSummary {
  projectName?: string;
  developer?: string;
  area?: string;
  address?: string;
  launchDate?: string;
  completionDate?: string;
  handoverDate?: string;
  constructionProgress?: number;
  
  // 单元统计
  totalUnits: number;
  unitCategories: string[];  // ['Studio', '1BR', '2BR', '3BR', 'Penthouse']
  areaRange?: { min: number; max: number };  // sqft
  priceRange?: { min: number; max: number };  // AED
  
  // 配套设施
  amenities: string[];
  
  // 付款计划
  hasPaymentPlan: boolean;
  paymentPlanHighlight?: string;  // e.g., "60/40 payment plan"
}

/**
 * 生成项目描述
 */
export async function generateProjectDescription(
  summary: ProjectSummary
): Promise<string> {
  
  try {
    const model = genAI.getGenerativeModel({
      model: FLASH,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 500,
        candidateCount: 1,
        responseMimeType: 'application/json',  // ⭐ Force JSON output
      },
    });

    const prompt = createDescriptionPrompt(summary);
    
    // 🔍 DEBUG: 输出完整prompt和数据
    console.log('\n🔍 DEBUG - Input data:');
    console.log(`   Project: ${summary.projectName}`);
    console.log(`   Area: ${summary.area}`);
    console.log(`   Developer: ${summary.developer}`);
    console.log(`   Units: ${summary.unitCategories.join(', ')}`);
    console.log(`   Amenities (${summary.amenities.length}): ${summary.amenities.slice(0, 5).join(', ')}...`);

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const description = response.text().trim();

    console.log(`\n✨ Generated project description (${description.length} chars)`);
    console.log(`   Preview: ${description.substring(0, 100)}...`);
    console.log(`   FULL OUTPUT: "${description}"`);

    return description;

  } catch (error) {
    console.error(`   ✗ Error generating project description:`, error);
    
    // Fallback: 返回基本信息组合
    return generateBasicDescription(summary);
  }
}

/**
 * 推断项目独特卖点和风格
 */
function analyzeProjectCharacter(summary: ProjectSummary): {
  style: string;
  uniqueSellingPoints: string[];
  targetAudience: string;
} {
  const { area, amenities, unitCategories } = summary;
  
  // 判断项目定位
  const hasLuxuryAmenities = amenities.some(a => /spa|wellness|concierge|valet|cigar/i.test(a));
  const hasFamilyAmenities = amenities.some(a => /kids|children|play|family/i.test(a));
  const hasBeachfront = area?.toLowerCase().includes('palm') || area?.toLowerCase().includes('beach');
  const isDowntown = area?.toLowerCase().includes('downtown') || area?.toLowerCase().includes('business bay');
  const hasLargeSizes = unitCategories.some(c => /4BR|5BR|Penthouse/i.test(c));
  
  let style = 'contemporary';
  let uniqueSellingPoints: string[] = [];
  let targetAudience = 'discerning buyers';
  
  if (hasLuxuryAmenities && hasLargeSizes) {
    style = 'ultra-luxury';
    uniqueSellingPoints.push('exclusive amenities', 'spacious layouts');
    targetAudience = 'elite clientele and investors';
  } else if (hasFamilyAmenities) {
    style = 'family-oriented';
    uniqueSellingPoints.push('family-friendly facilities', 'safe community');
    targetAudience = 'growing families';
  } else if (isDowntown) {
    style = 'urban-chic';
    uniqueSellingPoints.push('prime business district location', 'city connectivity');
    targetAudience = 'urban professionals';
  } else if (hasBeachfront) {
    style = 'resort-lifestyle';
    uniqueSellingPoints.push('waterfront living', 'beachside luxury');
    targetAudience = 'lifestyle seekers';
  }
  
  return { style, uniqueSellingPoints, targetAudience };
}

/**
 * 创建描述生成prompt - 确保每个项目独特
 */
function createDescriptionPrompt(summary: ProjectSummary): string {
  const {
    projectName,
    developer,
    area,
    unitCategories,
    amenities,
  } = summary;

  // 分析项目特点
  const character = analyzeProjectCharacter(summary);
  
  // 智能选择设施（根据项目风格）
  const lifestyleAmenities = amenities.filter(a => 
    /pool|gym|spa|garden|park|lounge|cinema|club|beach|terrace|wellness|play|kids/i.test(a)
  ).slice(0, 4);

  // 简化户型描述
  const unitTypesSummary = unitCategories.length > 0 
    ? `${unitCategories[0]} to ${unitCategories[unitCategories.length - 1]}`
    : '';

  return `Write a unique 4-5 sentence real estate description. Each project must have a DISTINCT voice based on its character.

## PROJECT ANALYSIS:
Name: ${projectName || 'this development'}
Location: ${area || 'Dubai'}
Developer: ${developer || 'a renowned developer'}
Style: ${character.style}
Target: ${character.targetAudience}
Homes: ${unitTypesSummary || 'various'}
Amenities: ${lifestyleAmenities.join(', ') || 'premium amenities'}

## WRITING RULES:

1. TRANSFORM DATA TO EXPERIENCE (don't just list):
   ❌ "pool, gym, spa" 
   ✅ "${character.style === 'ultra-luxury' ? 'lavish infinity pools, private wellness sanctuaries, and exclusive spa experiences' : character.style === 'family-oriented' ? 'sparkling family pools, active play zones, and welcoming community spaces' : 'resort-style pools, modern fitness studios, and serene relaxation areas'}"

2. MATCH STYLE TO PROJECT CHARACTER:
   ${character.style === 'ultra-luxury' ? '→ Use: opulent, exclusive, prestigious, bespoke, curated, refined' : 
     character.style === 'family-oriented' ? '→ Use: welcoming, vibrant, safe, spacious, community-focused' :
     character.style === 'urban-chic' ? '→ Use: dynamic, sleek, connected, contemporary, energetic' :
     character.style === 'resort-lifestyle' ? '→ Use: tranquil, coastal, serene, breathtaking, idyllic' :
     '→ Use: modern, sophisticated, elegant, premium, thoughtfully designed'}

3. LOCATION ENHANCEMENT (vary your approach):
   Options: "in the heart of", "perfectly positioned in", "rising in", "nestled within", "set against", "gracing"
   
4. MUST BE UNIQUE - avoid generic templates:
   - Vary sentence structure
   - Use project-specific details
   - Let the data guide your tone
   - ${character.uniqueSellingPoints.length > 0 ? `Emphasize: ${character.uniqueSellingPoints.join(' and ')}` : ''}

5. WRITE 4-5 COMPLETE SENTENCES:
   Structure (flexible order):
   - Opening: Project name + location with emotion/vision
   - Lifestyle: 2-3 amenities transformed into experiences  
   - Homes: Unit types with descriptive appeal
   - Close: Developer + investment angle OR aspirational note

## CRITICAL:
- Use ALL the data provided (name, location, amenities, unit types, developer)
- NO numbers (557 units, 3 towers, etc.)
- Write for ${character.targetAudience}
- Make it sound ${character.style}, not generic

Write the complete description (4-5 sentences, no formatting):`;
}

/**
 * 推断项目类型
 */
function getProjectType(unitCategories: string[]): string {
  const hasPenthouse = unitCategories.some(c => c.toLowerCase().includes('penthouse'));
  const maxBedrooms = Math.max(
    ...unitCategories
      .map(c => {
        const match = c.match(/(\d+)BR/);
        return match ? parseInt(match[1]) : 0;
      })
  );

  if (hasPenthouse || maxBedrooms >= 4) {
    return 'luxury residential development';
  }
  if (maxBedrooms >= 2) {
    return 'premium residential development';
  }
  return 'modern residential development';
}

/**
 * 生成基本描述（fallback - 简洁吸引人的版本）
 */
function generateBasicDescription(summary: ProjectSummary): string {
  const parts: string[] = [];
  const projectType = getProjectType(summary.unitCategories);

  // 第一句：位置+项目定位（情感化开场）
  if (summary.projectName && summary.area) {
    parts.push(`Discover ${summary.projectName}, where modern elegance meets prime location in ${summary.area}.`);
  } else if (summary.area) {
    parts.push(`Experience refined living in the heart of ${summary.area}, one of Dubai's most sought-after neighborhoods.`);
  } else if (summary.projectName) {
    parts.push(`${summary.projectName} redefines urban living with sophisticated design and exceptional amenities.`);
  } else {
    parts.push(`Discover your sanctuary in this ${projectType}, where luxury meets lifestyle.`);
  }

  // 第二句：生活方式体验（最多2-3个精选设施）
  const lifestyleAmenities = summary.amenities
    .filter(a => /pool|gym|spa|garden|park|wellness|lounge|cinema|beach|club/i.test(a))
    .slice(0, 3);
  
  if (lifestyleAmenities.length >= 2) {
    parts.push(`Residents embrace resort-style living with ${lifestyleAmenities.slice(0, 2).join(' and ')}, creating the perfect balance of relaxation and vitality.`);
  } else if (lifestyleAmenities.length === 1) {
    parts.push(`Enjoy an elevated lifestyle with premium ${lifestyleAmenities[0]} and thoughtfully designed spaces for modern living.`);
  }

  // 第三句：户型选择（简洁优雅，不列数字）
  if (summary.unitCategories.length > 1) {
    const firstUnit = summary.unitCategories[0];
    const lastUnit = summary.unitCategories[summary.unitCategories.length - 1];
    parts.push(`Choose from beautifully crafted ${firstUnit} to ${lastUnit} homes, each designed with contemporary elegance and comfort in mind.`);
  } else if (summary.unitCategories.length === 1) {
    parts.push(`Featuring meticulously designed ${summary.unitCategories[0]} residences that blend style with functionality.`);
  }

  // 第四句：投资价值（开发商或位置）
  if (summary.developer) {
    parts.push(`Developed by ${summary.developer}, this prime address offers exceptional value for discerning investors and families alike.`);
  } else if (summary.area) {
    parts.push(`This prime ${summary.area} location represents an outstanding investment opportunity in Dubai's dynamic real estate market.`);
  } else {
    parts.push(`An exceptional opportunity for those seeking the perfect blend of luxury living and smart investment.`);
  }

  return parts.join(' ');
}
