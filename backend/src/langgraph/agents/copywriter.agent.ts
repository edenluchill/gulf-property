/**
 * Creative Copywriter Agent
 * 
 * Generates marketing content for different platforms and audiences:
 * - 小红书 (Xiaohongshu): Lifestyle-focused, emotional
 * - Twitter: Concise, professional
 * - Investor Email: Detailed, data-driven
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { MarketingContentSchema, type MarketingContent, type BuildingData } from '../../schemas/property.schema';
import { parseJsonResponse } from '../utils/json-parser';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

/**
 * Generate marketing content for multiple platforms
 * 
 * @param buildingData - Complete building/project data
 * @param analysisReport - Optional investment analysis
 * @returns Marketing content for different platforms
 */
export async function generateMarketingContent(
  buildingData: Partial<BuildingData>,
  analysisReport?: string
): Promise<MarketingContent> {
  try {
    console.log(`Generating marketing content for ${buildingData.name}`);

    const model = genAI.getGenerativeModel({
      model: 'gemini-3-flash-preview',
      generationConfig: {
        responseMimeType: 'application/json',  // ⭐ Use JSON mode
      },
    });

    // Prepare building details summary
    const buildingSummary = `
Project: ${buildingData.name || 'Luxury Development'}
Developer: ${buildingData.developer || 'Premium Developer'}
Location: ${buildingData.address || 'Prime Dubai Location'}
Area: ${buildingData.area || 'Dubai'}
Completion: ${buildingData.completionDate || 'TBD'}

Units: ${buildingData.units?.length || 0} types
- Bedrooms: ${buildingData.minBedrooms || 0} to ${buildingData.maxBedrooms || 3} BR
- Size: ${buildingData.minArea || 'N/A'} - ${buildingData.maxArea || 'N/A'} sqft
- Price: AED ${buildingData.minPrice?.toLocaleString() || 'TBD'} - ${buildingData.maxPrice?.toLocaleString() || 'TBD'}

Amenities: ${buildingData.amenities?.slice(0, 5).join(', ') || 'Premium facilities'}

Description: ${buildingData.description || 'A prestigious new development'}

${analysisReport ? `\nInvestment Analysis:\n${analysisReport}` : ''}
`;

    const prompt = `You are an expert real estate copywriter fluent in English and Chinese.

Create compelling marketing content for this Dubai property:

${buildingSummary}

Generate content for 3 platforms:

1. XIAOHONGSHU (小红书) - 200-300 words:
   - Lifestyle-focused, emotional appeal
   - Highlight living experience, views, design
   - Use Chinese language
   - Include relevant emojis naturally
   - Appeal to young professionals and families

2. TWITTER - 2-3 tweets (280 chars each):
   - Professional and concise
   - Focus on key facts and investment highlights
   - Use hashtags strategically
   - English language

3. INVESTOR EMAIL - 300-400 words:
   - Data-driven and analytical
   - Investment thesis and ROI potential
   - Market positioning and competitive advantages
   - Professional English tone

Also provide:
- Headline: Catchy one-liner (10 words max)
- Tagline: Brand message (15 words max)
- Highlights: 5 key selling points (brief bullets)
- Investment Highlights: 4-5 investment-specific points

Return JSON with this structure:
{
  "xiaohongshu": "小红书 content here...",
  "twitter": "Tweet 1\\n\\nTweet 2\\n\\nTweet 3",
  "investorEmail": "Email content here...",
  "headline": "Your Dream Home in Dubai Awaits",
  "tagline": "Where luxury meets lifestyle",
  "highlights": ["Prime location", "Flexible payment", "..."],
  "investmentHighlights": ["8% appreciation", "High yields", "..."]
}`;

    const result = await model.generateContent([prompt]);
    const response = await result.response;
    const text = response.text();

    // Parse JSON (自动处理markdown code fences)
    const parsed = parseJsonResponse(text);

    // Validate with Zod
    const validated = MarketingContentSchema.parse(parsed);

    console.log(`Marketing content generated for ${buildingData.name}`);

    return validated;
  } catch (error) {
    console.error('Error generating marketing content:', error);
    
    // Return minimal fallback
    return {
      headline: buildingData.name || 'Exclusive Dubai Development',
      tagline: 'Your gateway to luxury living',
      highlights: [
        'Prime location',
        'Modern design',
        'Premium amenities',
        'Investment opportunity',
      ],
      investmentHighlights: [
        'Strong market fundamentals',
        'Growing area demand',
      ],
    };
  }
}
