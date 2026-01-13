/**
 * Floor Plan Auditor Agent
 * 
 * Precision extraction of floor plan details using Gemini 2.0 Flash.
 * Extracts unit types, sizes, bedrooms, orientations, and bounding boxes.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { readFileSync } from 'fs';
import { UnitTypeSchema, type UnitType } from '../schemas/property.schema';
import { z } from 'zod';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

/**
 * Schema for floor plan extraction result
 */
const FloorPlanExtractionSchema = z.object({
  units: z.array(UnitTypeSchema),
});

/**
 * Extract floor plan details from an image
 * 
 * @param imagePath - Path to floor plan image
 * @param pageNumber - Page number for reference
 * @returns Array of extracted unit types
 */
export async function extractFloorPlanDetails(
  imagePath: string,
  pageNumber: number
): Promise<UnitType[]> {
  try {
    // Use Gemini 2.0 Flash for precision extraction
    const model = genAI.getGenerativeModel({
      model: 'gemini-3-flash-preview',
    });

    // Load image
    const imageBuffer = readFileSync(imagePath);
    const imageBase64 = imageBuffer.toString('base64');

    const prompt = `You are a real estate floor plan analysis expert.

Analyze this floor plan image and extract ALL unit types with their specifications.

For EACH unit type shown on the page, extract:
- Unit name/type (e.g., "1 BEDROOM TYPE A", "STUDIO", "2BR")
- Number of bedrooms (0 for studio)
- Number of bathrooms (include half baths as 0.5)
- Area in square feet (sqft) or square meters (sqm)
- Orientation if mentioned (e.g., "North-facing", "Sea view")
- Balcony/terrace area if shown separately

IMPORTANT:
1. Extract ALL units shown on this page
2. If multiple layout variations exist (Type A, Type B), list them separately
3. Look for dimension labels, area numbers, and room counts carefully
4. If area is in sqm, note it - we'll convert later
5. Generate a unique ID for each unit (format: "unit_<bedroom>bed_<letter>")

Respond with JSON only:
{
  "units": [
    {
      "id": "unit_1bed_a",
      "name": "1 BEDROOM TYPE A",
      "bedrooms": 1,
      "bathrooms": 1,
      "area": 650,
      "areaUnit": "sqft",
      "orientation": "North-facing",
      "balconyArea": 50
    }
  ]
}

If no floor plans found, return {"units": []}. Respond ONLY with valid JSON.`;

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

    // Parse JSON
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || 
                     text.match(/```\s*([\s\S]*?)\s*```/) ||
                     [null, text];
    
    const jsonText = jsonMatch[1] || text;
    const parsed = JSON.parse(jsonText.trim());

    // Validate with Zod
    const validated = FloorPlanExtractionSchema.parse(parsed);

    console.log(`Extracted ${validated.units.length} unit types from page ${pageNumber}`);

    return validated.units;
  } catch (error) {
    console.error(`Error extracting floor plans from page ${pageNumber}:`, error);
    return [];
  }
}

/**
 * Batch extract floor plans from multiple images
 */
export async function extractFloorPlans(
  imagePaths: string[]
): Promise<UnitType[]> {
  console.log(`Extracting floor plans from ${imagePaths.length} images...`);

  const allUnits: UnitType[] = [];

  for (let i = 0; i < imagePaths.length; i++) {
    const units = await extractFloorPlanDetails(imagePaths[i], i + 1);
    allUnits.push(...units);
  }

  // Deduplicate units by ID
  const uniqueUnits = Array.from(
    new Map(allUnits.map(unit => [unit.id, unit])).values()
  );

  console.log(`Total unique units extracted: ${uniqueUnits.length}`);

  return uniqueUnits;
}
