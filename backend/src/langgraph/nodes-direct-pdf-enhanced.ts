/**
 * Enhanced Direct PDF Processing with Image Extraction
 * 
 * Extracts images from PDF and groups units by category
 */

import type { State } from './state';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { researchMarketContext, generateInvestmentAnalysis } from '../agents/market-intelligence.agent';
import { generateMarketingContent } from '../agents/copywriter.agent';
import { extractImagesFromPdf } from '../utils/pdf/image-extractor';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

/**
 * ENHANCED DIRECT PDF PROCESSING NODE
 * Extracts structured data + images from PDF
 */
export async function enhancedDirectPdfProcessingNode(state: State): Promise<Partial<State>> {
  console.log('=== ENHANCED DIRECT PDF PROCESSING ===');
  console.log('Extracting data + images from PDF using Gemini');

  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-3-flash-preview',
    });

    const pdfBase64 = state.pdfBuffer!.toString('base64');

    const prompt = `You are an expert real estate data extraction system. Analyze this Dubai property brochure PDF comprehensively.

Extract ALL information in structured JSON format:

{
  "name": "Project name",
  "developer": "Developer name",
  "address": "Full address",
  "area": "District/Area name",
  "completionDate": "YYYY-MM-DD",
  "launchDate": "YYYY-MM-DD",
  "description": "Detailed project description",
  "amenities": ["Pool", "Gym", "Parking", "..."],
  
  "units": [
    {
      "category": "Studio|1BR|2BR|3BR|4BR|5BR|Penthouse|Duplex",
      "typeName": "Type A|Type B|Corner Unit|etc (如果有细分)",
      "unitNumbers": ["101", "201", "301"],  // Optional: 具体单元号
      "unitCount": 10,  // Optional: 此类型的单元数量
      "bedrooms": 0,
      "bathrooms": 1,
      "area": 450,
      "areaUnit": "sqft",
      "price": 950000,
      "pricePerSqft": 2111,
      "orientation": "North-facing",  // Optional
      "balconyArea": 40,  // Optional
      "features": ["Walk-in closet", "Built-in wardrobes"]  // Optional
    }
  ],
  
  "paymentPlans": [
    {
      "milestones": [
        {"milestone": "Down Payment", "percentage": 20, "date": "2025-01-01"},
        {"milestone": "On Handover", "percentage": 80, "date": "2026-12-31"}
      ],
      "totalPercentage": 100,
      "currency": "AED"
    }
  ],
  
  "minPrice": 950000,
  "maxPrice": 3500000,
  "minArea": 450,
  "maxArea": 2200
}

CRITICAL INSTRUCTIONS:

1. UNIT GROUPING:
   - Group units by CATEGORY (Studio, 1BR, 2BR, etc.)
   - If there are variations within a category (Type A, Type B), list them separately
   - Each category should have its own entry
   - Example: If there are "1BR Type A" and "1BR Type B", create 2 entries with category="1BR" but different typeNames

2. UNIT DETAILS:
   - Extract unit numbers if mentioned (e.g., "Units 101-110")
   - Extract unit count if mentioned (e.g., "20 units available")
   - Extract all features mentioned for each unit type
   - Calculate price per sqft if both price and area are available

3. THOROUGH EXTRACTION:
   - Check ALL pages carefully
   - Look for tables, charts, floor plan labels
   - Extract payment plans from any payment schedule pages
   - If multiple payment plans exist, extract all of them

4. DATA QUALITY:
   - Use null for missing optional fields
   - Ensure areas are in square feet (convert if needed)
   - Preserve exact names as they appear
   - Be consistent with categories

Respond ONLY with valid JSON, no markdown.`;

    console.log('Sending PDF to Gemini for analysis...');

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          mimeType: 'application/pdf',
          data: pdfBase64,
        },
      },
    ]);

    const response = await result.response;
    const text = response.text();

    console.log('✓ Received response from Gemini');

    // Parse JSON
    let extractedData: any;
    try {
      const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || 
                       text.match(/```\s*([\s\S]*?)\s*```/) ||
                       [null, text];
      
      const jsonText = jsonMatch[1] || text;
      extractedData = JSON.parse(jsonText.trim());
    } catch (parseError) {
      console.error('Failed to parse Gemini response:');
      console.error('Response preview:', text.substring(0, 500));
      console.error('Parse error:', parseError);
      
      // Return minimal data instead of failing
      extractedData = {
        name: 'Error extracting data',
        developer: 'Please check PDF',
        address: '',
        units: [],
        paymentPlans: [],
        amenities: [],
      };
    }

    // Structure the data
    const buildingData = {
      name: extractedData.name || '',
      developer: extractedData.developer || '',
      address: extractedData.address || '',
      area: extractedData.area,
      completionDate: extractedData.completionDate,
      launchDate: extractedData.launchDate,
      description: extractedData.description || '',
      amenities: extractedData.amenities || [],
      units: extractedData.units || [],
      paymentPlans: extractedData.paymentPlans || [],
      minPrice: extractedData.minPrice,
      maxPrice: extractedData.maxPrice,
      minArea: extractedData.minArea,
      maxArea: extractedData.maxArea,
    };

    console.log(`✓ Extracted: ${buildingData.units.length} unit types, ${buildingData.paymentPlans.length} payment plans`);
    
    // Group units by category for frontend display
    const groupedUnits = groupUnitsByCategory(buildingData.units);
    console.log(`✓ Grouped into ${Object.keys(groupedUnits).length} categories`);

    // Extract images from PDF
    console.log('\n🖼️  Extracting images from PDF...');
    const images = await extractImagesFromPdf(state.pdfBuffer!, state.outputDir);
    
    console.log(`   ✅ Extracted ${images.length} images`);

    // For small images (<200KB), use base64. For large images, skip or compress
    const smallImages = images.filter(img => img.size < 200 * 1024);
    console.log(`   📦 ${smallImages.length} small images (will include in response)`);

    // Classify images simply
    const projectImages = smallImages.slice(0, 6).map(img => img.base64);
    const floorPlanImages = smallImages.slice(6, 16).map(img => img.base64);
    
    console.log(`   🏢 Project images: ${projectImages.length}`);
    console.log(`   📐 Floor plan images: ${floorPlanImages.length}`);

    return {
      buildingData: {
        ...buildingData,
        images: {
          projectImages,      // 项目效果图
          floorPlanImages,    // 户型图
          allImages: images.map(img => img.base64),  // 所有图片
        },
      } as any, // Type assertion to bypass strict schema
      totalPages: 1,
      processingStage: 'reducing',
    };

  } catch (error) {
    console.error('Error in enhanced PDF processing:', error);
    return {
      errors: [`Enhanced PDF processing failed: ${error}`],
      processingStage: 'error',
    };
  }
}

/**
 * Group units by category for better display
 */
function groupUnitsByCategory(units: any[]): Record<string, any[]> {
  const grouped: Record<string, any[]> = {};
  
  for (const unit of units) {
    const category = unit.category || determineCategory(unit.bedrooms);
    
    if (!grouped[category]) {
      grouped[category] = [];
    }
    
    grouped[category].push(unit);
  }
  
  return grouped;
}

/**
 * Determine category from bedroom count
 */
function determineCategory(bedrooms: number): string {
  if (bedrooms === 0) return 'Studio';
  if (bedrooms === 1) return '1BR';
  if (bedrooms === 2) return '2BR';
  if (bedrooms === 3) return '3BR';
  if (bedrooms === 4) return '4BR';
  if (bedrooms >= 5) return '5BR+';
  return 'Other';
}

/**
 * Market Research Node (same as before)
 */
export async function marketResearchNode(state: State): Promise<Partial<State>> {
  console.log('=== MARKET RESEARCH ===');

  try {
    const { buildingData } = state;

    if (!buildingData.name || !buildingData.address) {
      console.log('⚠ Skipping market research - insufficient building info');
      return {};
    }

    const marketContext = await researchMarketContext(
      buildingData.name,
      buildingData.address,
      buildingData.area || 'Dubai'
    );

    console.log('✓ Market research completed');

    return {
      marketContext,
      processingStage: 'insight',
    };
  } catch (error) {
    console.error('Error in market research:', error);
    return {
      warnings: [`Market research failed: ${error}`],
    };
  }
}

/**
 * Analysis and Copywriting Nodes
 */
export async function analysisNode(state: State): Promise<Partial<State>> {
  console.log('=== ANALYSIS ===');

  try {
    const { buildingData, marketContext } = state;

    if (!marketContext) return {};

    const avgPriceSqft = buildingData.units && buildingData.units.length > 0
      ? buildingData.units
          .filter((u: any) => u.price && u.area)
          .map((u: any) => u.price / u.area)
          .reduce((sum: number, val: number) => sum + val, 0) / buildingData.units.length
      : undefined;

    const analysisText = await generateInvestmentAnalysis(
      buildingData.name || 'Development',
      marketContext,
      buildingData.units?.length || 0,
      avgPriceSqft
    );

    const analysisReport = {
      summary: analysisText,
      strengths: [
        ...(marketContext.nearbyMetroStations.length > 0 ? ['Excellent connectivity'] : []),
        ...(marketContext.areaInsights?.demandLevel === 'High' ? ['High demand area'] : []),
      ],
      considerations: [],
      recommendedFor: ['Investors', 'Families'],
      appreciationPotential: 'Medium' as const,
    };

    return { analysisReport };
  } catch (error) {
    console.error('Error in analysis:', error);
    return { warnings: [`Analysis failed: ${error}`] };
  }
}

export async function copywritingNode(state: State): Promise<Partial<State>> {
  console.log('=== COPYWRITING ===');

  try {
    const { buildingData, analysisReport } = state;

    const marketingContent = await generateMarketingContent(
      buildingData,
      analysisReport?.summary
    );

    console.log('✓ Marketing content generated');

    return {
      marketingContent,
      processingStage: 'complete',
    };
  } catch (error) {
    console.error('Error in copywriting:', error);
    return {
      warnings: [`Copywriting failed: ${error}`],
      processingStage: 'complete',
    };
  }
}
