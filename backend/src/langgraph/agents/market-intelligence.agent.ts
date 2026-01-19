/**
 * Market Intelligence Agent
 * 
 * Performs web research to gather market context, competitor analysis,
 * nearby infrastructure, and government plans.
 * 
 * Note: This uses Gemini for research instead of Tavily as it's more accessible.
 * For production, consider integrating Tavily API for better real-time search.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { MarketContextSchema, type MarketContext } from '../../schemas/property.schema';
import { parseJsonResponse } from '../utils/json-parser';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

/**
 * Research market context for a property
 * 
 * @param buildingName - Name of the building/project
 * @param address - Property address
 * @param area - Area/district name
 * @returns Market intelligence data
 */
export async function researchMarketContext(
  buildingName: string,
  address: string,
  area: string
): Promise<MarketContext> {
  try {
    console.log(`Researching market context for ${buildingName} in ${area}`);

    const model = genAI.getGenerativeModel({
      model: 'gemini-3-flash-preview',
      generationConfig: {
        responseMimeType: 'application/json',  // ⭐ Use JSON mode
      },
    });

    const prompt = `You are a Dubai real estate market research expert.

Research and provide market intelligence for this property:
- Building: ${buildingName}
- Location: ${address}
- Area: ${area}

Provide the following information (use your knowledge of Dubai real estate):

1. NEARBY METRO STATIONS (within 2km):
   - Station name and distance in meters
   - Walking time estimate

2. COMPETITOR PROJECTS (similar developments in the area):
   - Project name, developer
   - Average price per sqft (estimate based on area)
   - Distance from target property

3. AREA INSIGHTS:
   - Average price per sqft in the area
   - Year-over-year price growth percentage
   - Demand level (High/Medium/Low)
   - Investment grade (A/B/C)

4. GOVERNMENT PLANS & FUTURE DEVELOPMENTS:
   - Any known government initiatives in the area
   - Upcoming infrastructure projects
   - Area development plans

Return JSON with this structure:
{
  "nearbyMetroStations": [{"name": "...", "distance": 800, "walkingTime": 10}],
  "competitorProjects": [{"name": "...", "developer": "...", "avgPriceSqft": 1500, "distance": 500}],
  "areaInsights": {"averagePriceSqft": 1450, "priceGrowthYoY": 8.5, "demandLevel": "High", "investmentGrade": "A"},
  "governmentPlans": ["Dubai 2040 plan...", "New metro line..."],
  "sources": [{"title": "...", "url": "...", "snippet": "..."}]
}

Provide realistic estimates based on Dubai market knowledge.`;

    const result = await model.generateContent([prompt]);
    const response = await result.response;
    const text = response.text();

    // Parse JSON (自动处理markdown code fences)
    const parsed = parseJsonResponse(text);

    // Validate with Zod
    const validated = MarketContextSchema.parse(parsed);

    console.log(`Market research completed for ${buildingName}`);

    return validated;
  } catch (error) {
    console.error('Error researching market context:', error);
    
    // Return minimal fallback data
    return {
      nearbyMetroStations: [],
      competitorProjects: [],
      governmentPlans: [],
      sources: [],
    };
  }
}

/**
 * Generate investment analysis based on market context
 */
export async function generateInvestmentAnalysis(
  buildingName: string,
  marketContext: MarketContext,
  unitCount: number,
  avgPriceSqft?: number
): Promise<string> {
  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-3-flash-preview',
    });

    const contextSummary = `
Market Context:
- Nearby Metro: ${marketContext.nearbyMetroStations.length} stations within range
- Competitors: ${marketContext.competitorProjects.length} similar projects
- Area Avg Price/sqft: ${marketContext.areaInsights?.averagePriceSqft || 'N/A'}
- Price Growth YoY: ${marketContext.areaInsights?.priceGrowthYoY || 'N/A'}%
- Demand Level: ${marketContext.areaInsights?.demandLevel || 'N/A'}
- Investment Grade: ${marketContext.areaInsights?.investmentGrade || 'N/A'}
- Government Plans: ${marketContext.governmentPlans.length} initiatives
`;

    const prompt = `Generate a concise investment analysis (2-3 paragraphs) for ${buildingName}.

${contextSummary}

Project Details:
- Unit Types: ${unitCount} different layouts
- Avg Price/sqft: ${avgPriceSqft || 'TBD'} AED

Analyze:
1. Location advantages (metro proximity, area development)
2. Price competitiveness vs market
3. Investment potential and appreciation outlook
4. Target buyer profile

Write in a professional but accessible tone. Focus on data-driven insights.`;

    const result = await model.generateContent([prompt]);
    const response = await result.response;
    
    return response.text().trim();
  } catch (error) {
    console.error('Error generating investment analysis:', error);
    return 'Investment analysis unavailable.';
  }
}
