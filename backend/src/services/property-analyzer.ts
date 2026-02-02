/**
 * Property Analyzer Service
 *
 * Uses Google Gemini Flash to analyze and compare properties
 * with personalized recommendations based on user profile
 */

import { GoogleGenerativeAI } from '@google/generative-ai'

interface UserProfile {
  familyStatus: string
  purpose: string
  hasChildren?: boolean
  childrenAges?: string
  investmentHorizon?: string
  riskTolerance?: string
  workLocation?: string
  schoolPreference?: boolean
  budget?: { min: number; max: number }
}

interface PropertyData {
  id: string
  projectId: string
  unitTypeId?: string
  projectName: string
  developer: string
  area: string
  address: string
  unitTypeName?: string
  bedrooms: number
  bathrooms?: string
  size: number
  price: number
  pricePerSqft?: number
  completionDate?: string
  status: string
  constructionProgress?: number
  amenities: string[]
  paymentPlan?: {
    downPayment: number
    duringConstruction: number
    onHandover: number
  }
}

interface ComparisonReport {
  id: string
  createdAt: number
  items: { projectId: string; unitTypeId?: string }[]
  summary: string
  recommendation: {
    winnerId: string
    winnerIndex: number
    confidence: 'high' | 'medium' | 'low'
    reasons: string[]
  }
  dimensions: {
    investment: { scores: number[]; explanation: string }
    lifestyle: { scores: number[]; explanation: string }
    location: { scores: number[]; explanation: string }
    value: { scores: number[]; explanation: string }
  }
  personalizedAdvice: string
}

/**
 * Analyze properties and generate comparison report
 */
export async function analyzeProperties(
  properties: PropertyData[],
  profile: UserProfile
): Promise<ComparisonReport> {
  const apiKey = process.env.GEMINI_API_KEY

  if (!apiKey) {
    console.warn('GEMINI_API_KEY not found, using mock analysis')
    return generateMockReport(properties, profile)
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash-exp',
    })

    const prompt = buildAnalysisPrompt(properties, profile)

    console.log('Sending request to Gemini for property analysis...')

    const result = await model.generateContent(prompt)
    const response = await result.response
    const text = response.text()

    console.log('Received response from Gemini')

    // Parse JSON from response
    let analysisData: any
    try {
      const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) ||
                       text.match(/```\s*([\s\S]*?)\s*```/)
      const jsonText = jsonMatch ? jsonMatch[1] : text
      analysisData = JSON.parse(jsonText.trim())
    } catch (parseError) {
      console.error('Failed to parse Gemini response:', text.substring(0, 500))
      throw new Error('AI response was not valid JSON')
    }

    // Build report from AI response
    const report: ComparisonReport = {
      id: `report_${Date.now()}`,
      createdAt: Date.now(),
      items: properties.map(p => ({
        projectId: p.projectId,
        unitTypeId: p.unitTypeId
      })),
      summary: analysisData.summary || '',
      recommendation: {
        winnerId: analysisData.recommendation?.winnerId || properties[0].id,
        winnerIndex: analysisData.recommendation?.winnerIndex ?? 0,
        confidence: analysisData.recommendation?.confidence || 'medium',
        reasons: analysisData.recommendation?.reasons || []
      },
      dimensions: {
        investment: {
          scores: analysisData.dimensions?.investment?.scores || [50, 50],
          explanation: analysisData.dimensions?.investment?.explanation || ''
        },
        lifestyle: {
          scores: analysisData.dimensions?.lifestyle?.scores || [50, 50],
          explanation: analysisData.dimensions?.lifestyle?.explanation || ''
        },
        location: {
          scores: analysisData.dimensions?.location?.scores || [50, 50],
          explanation: analysisData.dimensions?.location?.explanation || ''
        },
        value: {
          scores: analysisData.dimensions?.value?.scores || [50, 50],
          explanation: analysisData.dimensions?.value?.explanation || ''
        }
      },
      personalizedAdvice: analysisData.personalizedAdvice || ''
    }

    return report
  } catch (error) {
    console.error('Error analyzing properties with Gemini:', error)
    return generateMockReport(properties, profile)
  }
}

/**
 * Build the analysis prompt for Gemini
 */
function buildAnalysisPrompt(properties: PropertyData[], profile: UserProfile): string {
  const [propA, propB] = properties

  return `You are an expert Dubai real estate advisor. Analyze these two properties and provide a personalized comparison for the buyer.

## Buyer Profile
- Family Status: ${profile.familyStatus}
- Primary Purpose: ${profile.purpose}
${profile.hasChildren ? `- Has Children (ages: ${profile.childrenAges || 'not specified'})` : '- No children'}
${profile.investmentHorizon ? `- Investment Horizon: ${profile.investmentHorizon}` : ''}
${profile.riskTolerance ? `- Risk Tolerance: ${profile.riskTolerance}` : ''}
${profile.workLocation ? `- Work Location: ${profile.workLocation}` : ''}
${profile.schoolPreference ? '- School proximity is important' : ''}
${profile.budget ? `- Budget: AED ${profile.budget.min.toLocaleString()} - ${profile.budget.max.toLocaleString()}` : ''}

## Property A
- Name: ${propA.unitTypeName || propA.projectName}
- Project: ${propA.projectName}
- Developer: ${propA.developer}
- Location: ${propA.area}
- Price: AED ${propA.price.toLocaleString()}
- Size: ${propA.size > 0 ? propA.size + ' sqft' : 'Not specified'}
${propA.pricePerSqft ? `- Price/sqft: AED ${propA.pricePerSqft.toLocaleString()}` : ''}
- Bedrooms: ${propA.bedrooms === 0 ? 'Studio' : propA.bedrooms}
- Status: ${propA.status}
${propA.completionDate ? `- Completion: ${propA.completionDate}` : ''}
${propA.constructionProgress ? `- Progress: ${propA.constructionProgress}%` : ''}
- Amenities: ${propA.amenities.join(', ') || 'Not specified'}
${propA.paymentPlan ? `- Payment Plan: ${propA.paymentPlan.downPayment}% down / ${propA.paymentPlan.duringConstruction}% during / ${propA.paymentPlan.onHandover}% on handover` : ''}

## Property B
- Name: ${propB.unitTypeName || propB.projectName}
- Project: ${propB.projectName}
- Developer: ${propB.developer}
- Location: ${propB.area}
- Price: AED ${propB.price.toLocaleString()}
- Size: ${propB.size > 0 ? propB.size + ' sqft' : 'Not specified'}
${propB.pricePerSqft ? `- Price/sqft: AED ${propB.pricePerSqft.toLocaleString()}` : ''}
- Bedrooms: ${propB.bedrooms === 0 ? 'Studio' : propB.bedrooms}
- Status: ${propB.status}
${propB.completionDate ? `- Completion: ${propB.completionDate}` : ''}
${propB.constructionProgress ? `- Progress: ${propB.constructionProgress}%` : ''}
- Amenities: ${propB.amenities.join(', ') || 'Not specified'}
${propB.paymentPlan ? `- Payment Plan: ${propB.paymentPlan.downPayment}% down / ${propB.paymentPlan.duringConstruction}% during / ${propB.paymentPlan.onHandover}% on handover` : ''}

## Analysis Requirements

Based on the buyer's profile and the property details, provide a comprehensive comparison in JSON format:

{
  "summary": "2-3 sentence overview of the comparison tailored to the buyer's needs",
  "recommendation": {
    "winnerId": "${propA.id}",
    "winnerIndex": 0,
    "confidence": "high|medium|low",
    "reasons": ["reason 1", "reason 2", "reason 3"]
  },
  "dimensions": {
    "investment": {
      "scores": [scoreA (0-100), scoreB (0-100)],
      "explanation": "Brief explanation of investment potential comparison"
    },
    "lifestyle": {
      "scores": [scoreA, scoreB],
      "explanation": "Brief explanation of lifestyle fit comparison"
    },
    "location": {
      "scores": [scoreA, scoreB],
      "explanation": "Brief explanation of location comparison"
    },
    "value": {
      "scores": [scoreA, scoreB],
      "explanation": "Brief explanation of value for money comparison"
    }
  },
  "personalizedAdvice": "Specific advice for this buyer based on their profile (2-3 sentences)"
}

Consider these factors:
- For INVESTMENT purpose: ROI potential, rental yields, capital appreciation, developer track record
- For RESIDENCE purpose: Lifestyle amenities, community, proximity to work/schools
- For WORK purpose: Business district accessibility, networking potential
- Location scores should consider: accessibility, future development, area reputation
- Value scores should consider: price vs market average, payment plan flexibility, included amenities

IMPORTANT:
- winnerIndex should be 0 for Property A or 1 for Property B
- winnerId should be "${propA.id}" for A or "${propB.id}" for B
- Scores should be 0-100 with meaningful differences
- Keep explanations concise (1-2 sentences each)

Respond ONLY with valid JSON, no additional text.`
}

/**
 * Generate mock report when API is unavailable
 */
function generateMockReport(
  properties: PropertyData[],
  profile: UserProfile
): ComparisonReport {
  const [propA, propB] = properties

  // Simple scoring based on price and purpose
  const aScore = propA.price < propB.price ? 65 : 55
  const bScore = propB.price < propA.price ? 65 : 55

  const winnerIndex = aScore >= bScore ? 0 : 1
  const winner = properties[winnerIndex]

  return {
    id: `mock_report_${Date.now()}`,
    createdAt: Date.now(),
    items: properties.map(p => ({
      projectId: p.projectId,
      unitTypeId: p.unitTypeId
    })),
    summary: `Based on your ${profile.purpose} goals and ${profile.familyStatus} status, we've analyzed both properties. ${winner.projectName} appears to be a better match for your requirements, offering competitive pricing and suitable amenities.`,
    recommendation: {
      winnerId: winner.id,
      winnerIndex,
      confidence: 'medium',
      reasons: [
        `Better value proposition for ${profile.purpose} purposes`,
        `Location in ${winner.area} suits your preferences`,
        `Developer ${winner.developer} has strong track record`
      ]
    },
    dimensions: {
      investment: {
        scores: [aScore, bScore],
        explanation: `Both properties offer investment potential. ${winner.area} has shown consistent appreciation in recent years.`
      },
      lifestyle: {
        scores: [aScore - 5, bScore - 5],
        explanation: `Amenities and community features are comparable. ${winner.projectName} offers slightly better lifestyle options.`
      },
      location: {
        scores: [aScore + 5, bScore + 5],
        explanation: `Both locations are desirable. Consider proximity to your ${profile.workLocation || 'work'} location.`
      },
      value: {
        scores: [aScore, bScore],
        explanation: `Price per sqft and payment plans are competitive. ${winner.projectName} offers better overall value.`
      }
    },
    personalizedAdvice: profile.purpose === 'investment'
      ? `Given your ${profile.investmentHorizon || 'medium'}-term investment horizon and ${profile.riskTolerance || 'moderate'} risk tolerance, consider the payment plan flexibility when making your decision.`
      : `As a ${profile.familyStatus} looking for ${profile.purpose}, prioritize the community amenities and ${profile.schoolPreference ? 'school proximity' : 'accessibility'} when making your final choice.`
  }
}
