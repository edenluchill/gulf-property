/**
 * Financial Structurer Agent
 * 
 * Extracts and structures payment plan information from tables and text.
 * Converts complex payment schedules into standardized JSON format.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { readFileSync } from 'fs';
import { PaymentPlanSchema, type PaymentPlan } from '../schemas/property.schema';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

/**
 * Extract payment plan from an image
 * 
 * @param imagePath - Path to payment plan image
 * @param pageNumber - Page number for reference
 * @returns Extracted payment plan
 */
export async function extractPaymentPlan(
  imagePath: string,
  pageNumber: number
): Promise<PaymentPlan | null> {
  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-3-flash-preview',
    });

    const imageBuffer = readFileSync(imagePath);
    const imageBase64 = imageBuffer.toString('base64');

    const prompt = `You are a financial document analysis expert specializing in real estate payment plans.

Analyze this page and extract the complete payment plan/schedule.

Payment plans typically include:
- Down payment (initial deposit)
- Monthly/periodic installments during construction
- Payment on handover/completion
- Specific percentages and dates

Extract ALL payment milestones with:
- milestone: Name/description (e.g., "Down Payment", "Month 6", "On Handover")
- percentage: Payment percentage (0-100)
- date: Specific date if mentioned (ISO format YYYY-MM-DD) or null
- description: Any additional notes

IMPORTANT:
1. Preserve exact milestone names as they appear
2. Ensure all percentages add up to 100% or close to it
3. Order milestones chronologically
4. Include ALL payment stages mentioned

Respond with JSON only:
{
  "milestones": [
    {
      "milestone": "Down Payment",
      "percentage": 20,
      "date": "2025-01-15",
      "description": "Upon booking"
    },
    {
      "milestone": "Month 6",
      "percentage": 5,
      "date": null
    }
  ],
  "totalPercentage": 100,
  "currency": "AED"
}

If no payment plan found, return null. Respond ONLY with valid JSON.`;

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

    // Handle null response
    if (text.trim().toLowerCase() === 'null' || text.trim() === '{}') {
      return null;
    }

    // Parse JSON
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || 
                     text.match(/```\s*([\s\S]*?)\s*```/) ||
                     [null, text];
    
    const jsonText = jsonMatch[1] || text;
    const parsed = JSON.parse(jsonText.trim());

    if (!parsed || !parsed.milestones) {
      return null;
    }

    // Validate with Zod
    const validated = PaymentPlanSchema.parse(parsed);

    console.log(`Extracted payment plan with ${validated.milestones.length} milestones from page ${pageNumber}`);

    return validated;
  } catch (error) {
    console.error(`Error extracting payment plan from page ${pageNumber}:`, error);
    return null;
  }
}

/**
 * Extract payment plans from multiple images and merge them
 */
export async function extractPaymentPlans(
  imagePaths: string[]
): Promise<PaymentPlan[]> {
  console.log(`Extracting payment plans from ${imagePaths.length} images...`);

  const plans: PaymentPlan[] = [];

  for (let i = 0; i < imagePaths.length; i++) {
    const plan = await extractPaymentPlan(imagePaths[i], i + 1);
    if (plan) {
      plans.push(plan);
    }
  }

  console.log(`Total payment plans extracted: ${plans.length}`);

  return plans;
}

/**
 * Merge multiple payment plans (handle duplicates)
 */
export function mergePaymentPlans(plans: PaymentPlan[]): PaymentPlan | null {
  if (plans.length === 0) return null;
  if (plans.length === 1) return plans[0];

  // Take the most complete plan (highest totalPercentage)
  const sortedPlans = plans.sort((a, b) => b.totalPercentage - a.totalPercentage);
  
  return sortedPlans[0];
}
