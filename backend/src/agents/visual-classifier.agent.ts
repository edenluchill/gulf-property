/**
 * Visual Classifier Agent
 * 
 * Fast page classification using Gemini Flash.
 * Identifies page type (Cover, Floor Plan, Payment Plan, etc.)
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { readFileSync } from 'fs';
import { PageClassificationSchema, type PageClassification } from '../schemas/property.schema';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

/**
 * Classify a single page image
 * 
 * @param imagePath - Path to page image
 * @param pageNumber - Page number for context
 * @returns Classification result
 */
export async function classifyPage(
  imagePath: string,
  pageNumber: number
): Promise<PageClassification> {
  try {
    // Use Gemini Flash for fast classification
    const model = genAI.getGenerativeModel({
      model: 'gemini-3-flash-preview',
    });

    // Load image as base64
    const imageBuffer = readFileSync(imagePath);
    const imageBase64 = imageBuffer.toString('base64');

    const prompt = `You are a document classification expert for real estate brochures.

Analyze this page (page ${pageNumber}) and classify it into ONE of these categories:
- Cover: Title page, project logo, main hero image
- Rendering: 3D renderings, architectural visualizations, photo-realistic images
- FloorPlan: Unit layouts, floor plans with room dimensions
- PaymentPlan: Payment schedules, installment tables, pricing tables
- LocationMap: Maps, location diagrams, area plans
- Amenities: Facilities, amenities lists, lifestyle features
- GeneralText: Text-heavy pages with descriptions
- Unknown: Cannot determine or mixed content

Provide your response as JSON:
{
  "category": "one of the categories above",
  "confidence": 0.0 to 1.0,
  "description": "brief description of what you see on the page",
  "hasTable": true/false (if page contains tabular data),
  "hasFloorPlan": true/false (if page shows floor plan diagrams)
}

Be precise and confident. Respond ONLY with valid JSON.`;

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

    // Parse JSON from response
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || 
                     text.match(/```\s*([\s\S]*?)\s*```/) ||
                     [null, text];
    
    const jsonText = jsonMatch[1] || text;
    const parsed = JSON.parse(jsonText.trim());

    // Validate with Zod
    const validated = PageClassificationSchema.parse(parsed);

    console.log(`Page ${pageNumber} classified as: ${validated.category} (confidence: ${validated.confidence})`);

    return validated;
  } catch (error) {
    console.error(`Error classifying page ${pageNumber}:`, error);
    
    // Return fallback classification
    return {
      category: 'Unknown',
      confidence: 0.0,
      description: `Error classifying page: ${error}`,
      hasTable: false,
      hasFloorPlan: false,
    };
  }
}

/**
 * Batch classify multiple pages in parallel
 */
export async function classifyPages(
  imagePaths: string[]
): Promise<PageClassification[]> {
  console.log(`Classifying ${imagePaths.length} pages...`);

  const classifications = await Promise.all(
    imagePaths.map((imagePath, index) => 
      classifyPage(imagePath, index + 1)
    )
  );

  return classifications;
}
