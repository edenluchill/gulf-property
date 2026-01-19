/**
 * LangGraph Node Functions - Direct PDF Processing
 * 
 * Simplified version that uses Gemini's native PDF processing
 * WITHOUT requiring pdf-img-convert or canvas
 */

import type { State } from './state';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { researchMarketContext, generateInvestmentAnalysis } from './agents/market-intelligence.agent';
import { generateMarketingContent } from './agents/copywriter.agent';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

/**
 * DIRECT PDF PROCESSING NODE
 * Process entire PDF in one go using Gemini's native PDF support
 */
export async function directPdfProcessingNode(state: State): Promise<Partial<State>> {
  console.log('=== DIRECT PDF PROCESSING ===');
  console.log('Using Gemini native PDF processing (no image conversion needed)');

  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-3-flash-preview',
    });

    // Convert PDF to base64
    const pdfBase64 = state.pdfBuffer!.toString('base64');

    const prompt = `You are an expert real estate data extraction system. Analyze this Dubai property brochure PDF comprehensively.

Extract ALL information in structured JSON format:

{
  "name": "Project name",
  "developer": "Developer name",
  "address": "Full address",
  "area": "District/Area",
  "completionDate": "YYYY-MM-DD",
  "launchDate": "YYYY-MM-DD",
  "description": "Project description",
  "amenities": ["amenity1", "amenity2"],
  "units": [
    {
      "id": "unit_1bed_a",
      "name": "1 BEDROOM TYPE A",
      "bedrooms": 1,
      "bathrooms": 1,
      "area": 650,
      "areaUnit": "sqft",
      "price": 1800000,
      "orientation": "North-facing",
      "balconyArea": 50
    }
  ],
  "paymentPlans": [
    {
      "milestones": [
        {
          "milestone": "Down Payment",
          "percentage": 20,
          "date": "2025-01-01"
        }
      ],
      "totalPercentage": 100,
      "currency": "AED"
    }
  ],
  "minPrice": 1200000,
  "maxPrice": 3500000,
  "minArea": 422,
  "maxArea": 1991,
  "minBedrooms": 0,
  "maxBedrooms": 3
}

CRITICAL INSTRUCTIONS:
1. Extract ALL unit types (Studio, 1BR, 2BR, 3BR, Penthouse, etc.)
2. Extract ALL payment milestones with exact percentages
3. Look through ALL pages - be thorough
4. Convert areas to square feet if in sqm
5. Calculate min/max values from all units
6. Preserve exact names as they appear
7. If data not found, use null (not 0 or empty string)

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
      console.error('Failed to parse Gemini response');
      throw new Error('AI response was not valid JSON');
    }

    // Validate and structure
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
      minBedrooms: extractedData.minBedrooms,
      maxBedrooms: extractedData.maxBedrooms,
    };

    console.log(`✓ Extracted: ${buildingData.units.length} units, ${buildingData.paymentPlans.length} payment plans`);

    return {
      buildingData,
      totalPages: 1, // We processed the whole PDF at once
      processingStage: 'reducing',
    };

  } catch (error) {
    console.error('Error in direct PDF processing:', error);
    return {
      errors: [`Direct PDF processing failed: ${error}`],
      processingStage: 'error',
    };
  }
}

/**
 * MARKET RESEARCH NODE (same as before)
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
 * ANALYSIS NODE (same as before)
 */
export async function analysisNode(state: State): Promise<Partial<State>> {
  console.log('=== ANALYSIS ===');

  try {
    const { buildingData, marketContext } = state;

    if (!marketContext) {
      return {};
    }

    const avgPriceSqft = buildingData.units && buildingData.units.length > 0
      ? buildingData.units
          .filter(u => u.price && u.area)
          .map(u => u.price! / u.area)
          .reduce((sum, val) => sum + val, 0) / buildingData.units.length
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

    console.log('✓ Analysis completed');

    return { analysisReport };
  } catch (error) {
    console.error('Error in analysis:', error);
    return { warnings: [`Analysis failed: ${error}`] };
  }
}

/**
 * COPYWRITING NODE (same as before)
 */
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
