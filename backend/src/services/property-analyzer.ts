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

// Labels for properties (A, B, C, D)
const PROPERTY_LABELS = ['A', 'B', 'C', 'D']

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
    console.log(`Comparing ${properties.length} properties`)

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

    // Generate default scores array based on property count
    const defaultScores = properties.map(() => 50)

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
          scores: analysisData.dimensions?.investment?.scores || [...defaultScores],
          explanation: analysisData.dimensions?.investment?.explanation || ''
        },
        lifestyle: {
          scores: analysisData.dimensions?.lifestyle?.scores || [...defaultScores],
          explanation: analysisData.dimensions?.lifestyle?.explanation || ''
        },
        location: {
          scores: analysisData.dimensions?.location?.scores || [...defaultScores],
          explanation: analysisData.dimensions?.location?.explanation || ''
        },
        value: {
          scores: analysisData.dimensions?.value?.scores || [...defaultScores],
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
 * Build property description for prompt
 */
function buildPropertyDescription(prop: PropertyData, label: string): string {
  return `## Property ${label}
- Name: ${prop.unitTypeName || prop.projectName}
- Project: ${prop.projectName}
- Developer: ${prop.developer}
- Location: ${prop.area}
- Price: AED ${prop.price.toLocaleString()}
- Size: ${prop.size > 0 ? prop.size + ' sqft' : 'Not specified'}
${prop.pricePerSqft ? `- Price/sqft: AED ${prop.pricePerSqft.toLocaleString()}` : ''}
- Bedrooms: ${prop.bedrooms === 0 ? 'Studio' : prop.bedrooms}
- Status: ${prop.status}
${prop.completionDate ? `- Completion: ${prop.completionDate}` : ''}
${prop.constructionProgress ? `- Progress: ${prop.constructionProgress}%` : ''}
- Amenities: ${prop.amenities.join(', ') || 'Not specified'}
${prop.paymentPlan ? `- Payment Plan: ${prop.paymentPlan.downPayment}% down / ${prop.paymentPlan.duringConstruction}% during / ${prop.paymentPlan.onHandover}% on handover` : ''}`
}

/**
 * Build the analysis prompt for Gemini
 */
function buildAnalysisPrompt(properties: PropertyData[], profile: UserProfile): string {
  const propertyCount = properties.length
  const labels = PROPERTY_LABELS.slice(0, propertyCount)

  // Build property descriptions
  const propertyDescriptions = properties
    .map((prop, idx) => buildPropertyDescription(prop, labels[idx]))
    .join('\n\n')

  // Build score example for JSON template
  const scoreExample = labels.map(l => `score${l} (0-100)`).join(', ')

  // Build winner ID options
  const winnerIdOptions = properties.map((p, idx) => `"${p.id}" for ${labels[idx]}`).join(' or ')

  // Build winner index options
  const winnerIndexOptions = labels.map((l, idx) => `${idx} for Property ${l}`).join(', ')

  return `You are an expert Dubai real estate advisor. Analyze these ${propertyCount} properties and provide a personalized comparison for the buyer.

## Buyer Profile
- Family Status: ${profile.familyStatus}
- Primary Purpose: ${profile.purpose}
${profile.hasChildren ? `- Has Children (ages: ${profile.childrenAges || 'not specified'})` : '- No children'}
${profile.investmentHorizon ? `- Investment Horizon: ${profile.investmentHorizon}` : ''}
${profile.riskTolerance ? `- Risk Tolerance: ${profile.riskTolerance}` : ''}
${profile.workLocation ? `- Work Location: ${profile.workLocation}` : ''}
${profile.schoolPreference ? '- School proximity is important' : ''}
${profile.budget ? `- Budget: AED ${profile.budget.min.toLocaleString()} - ${profile.budget.max.toLocaleString()}` : ''}

${propertyDescriptions}

## Analysis Requirements

Based on the buyer's profile and the property details, provide a comprehensive comparison in JSON format:

{
  "summary": "2-3 sentence overview of the comparison tailored to the buyer's needs",
  "recommendation": {
    "winnerId": "${properties[0].id}",
    "winnerIndex": 0,
    "confidence": "high|medium|low",
    "reasons": ["reason 1", "reason 2", "reason 3"]
  },
  "dimensions": {
    "investment": {
      "scores": [${scoreExample}],
      "explanation": "Brief explanation of investment potential comparison"
    },
    "lifestyle": {
      "scores": [${scoreExample}],
      "explanation": "Brief explanation of lifestyle fit comparison"
    },
    "location": {
      "scores": [${scoreExample}],
      "explanation": "Brief explanation of location comparison"
    },
    "value": {
      "scores": [${scoreExample}],
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
- winnerIndex should be ${winnerIndexOptions}
- winnerId should be ${winnerIdOptions}
- Each scores array must have exactly ${propertyCount} values (one for each property in order: ${labels.join(', ')})
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
  // Calculate scores based on price (lower price = higher score)
  const prices = properties.map(p => p.price)
  const minPrice = Math.min(...prices)
  const maxPrice = Math.max(...prices)
  const priceRange = maxPrice - minPrice || 1

  // Score properties: lower price gets higher score
  const baseScores = properties.map(p => {
    const priceScore = 100 - ((p.price - minPrice) / priceRange) * 30
    return Math.round(Math.max(40, Math.min(90, priceScore)))
  })

  // Find winner (highest score)
  const maxScore = Math.max(...baseScores)
  const winnerIndex = baseScores.indexOf(maxScore)
  const winner = properties[winnerIndex]

  // Generate dimension scores with some variation
  const generateDimensionScores = (variation: number) => {
    return baseScores.map(s => Math.max(30, Math.min(95, s + (Math.random() * variation * 2 - variation))))
  }

  return {
    id: `mock_report_${Date.now()}`,
    createdAt: Date.now(),
    items: properties.map(p => ({
      projectId: p.projectId,
      unitTypeId: p.unitTypeId
    })),
    summary: `Based on your ${profile.purpose} goals and ${profile.familyStatus} status, we've analyzed ${properties.length} properties. ${winner.projectName} appears to be a strong match for your requirements, offering competitive pricing and suitable amenities in ${winner.area}.`,
    recommendation: {
      winnerId: winner.id,
      winnerIndex,
      confidence: 'medium',
      reasons: [
        `Best value proposition for ${profile.purpose} purposes among the ${properties.length} options`,
        `Location in ${winner.area} aligns well with your preferences`,
        `Developer ${winner.developer} has a strong track record in Dubai`
      ]
    },
    dimensions: {
      investment: {
        scores: generateDimensionScores(10),
        explanation: `Investment potential varies across the ${properties.length} properties. ${winner.area} has shown consistent appreciation in recent years.`
      },
      lifestyle: {
        scores: generateDimensionScores(8),
        explanation: `Each property offers different lifestyle amenities. ${winner.projectName} provides a well-balanced mix of community features.`
      },
      location: {
        scores: generateDimensionScores(12),
        explanation: `All locations are desirable areas in Dubai. Consider proximity to your ${profile.workLocation || 'work'} location when deciding.`
      },
      value: {
        scores: generateDimensionScores(6),
        explanation: `Value assessment considers price per sqft and payment plan flexibility. ${winner.projectName} offers competitive overall value.`
      }
    },
    personalizedAdvice: profile.purpose === 'investment'
      ? `Given your ${profile.investmentHorizon || 'medium'}-term investment horizon and ${profile.riskTolerance || 'moderate'} risk tolerance, compare the payment plan flexibility across all ${properties.length} options before deciding.`
      : `As a ${profile.familyStatus} looking for ${profile.purpose}, prioritize the community amenities and ${profile.schoolPreference ? 'school proximity' : 'accessibility'} when comparing these ${properties.length} properties.`
  }
}
