/**
 * Property Analyzer Service
 *
 * Uses Google Gemini Flash to analyze and compare properties
 * with personalized recommendations based on user profile
 */

import { GoogleGenerativeAI } from '@google/generative-ai'
import { FLASH } from '../services/ai/models'

interface UserProfile {
  // Free-form description (preferred)
  freeformDescription?: string
  // Structured fields (legacy)
  familyStatus?: string
  purpose?: string
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
  profile: UserProfile,
  language: string = 'en'
): Promise<ComparisonReport> {
  const apiKey = process.env.GEMINI_API_KEY

  if (!apiKey) {
    console.warn('GEMINI_API_KEY not found, using mock analysis')
    return generateMockReport(properties, profile, language)
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({
      model: FLASH,
    })

    const prompt = buildAnalysisPrompt(properties, profile, language)

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

    // Helper to ensure scores are integers
    const roundScores = (scores: number[] | undefined, defaultVal: number[]) => {
      if (!scores || !Array.isArray(scores)) return defaultVal
      return scores.map(s => Math.round(s))
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
          scores: roundScores(analysisData.dimensions?.investment?.scores, [...defaultScores]),
          explanation: analysisData.dimensions?.investment?.explanation || ''
        },
        lifestyle: {
          scores: roundScores(analysisData.dimensions?.lifestyle?.scores, [...defaultScores]),
          explanation: analysisData.dimensions?.lifestyle?.explanation || ''
        },
        location: {
          scores: roundScores(analysisData.dimensions?.location?.scores, [...defaultScores]),
          explanation: analysisData.dimensions?.location?.explanation || ''
        },
        value: {
          scores: roundScores(analysisData.dimensions?.value?.scores, [...defaultScores]),
          explanation: analysisData.dimensions?.value?.explanation || ''
        }
      },
      personalizedAdvice: analysisData.personalizedAdvice || ''
    }

    return report
  } catch (error) {
    console.error('Error analyzing properties with Gemini:', error)
    return generateMockReport(properties, profile, language)
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
function buildAnalysisPrompt(properties: PropertyData[], profile: UserProfile, language: string): string {
  const propertyCount = properties.length
  const labels = PROPERTY_LABELS.slice(0, propertyCount)

  // 自动检测:按用户界面语言产出全部文案(界面语言由前端 Accept-Language/参数传入)。
  const outputLanguageInstruction =
    `\n\n**IMPORTANT: Generate ALL text content (summary, reasons, explanations, personalizedAdvice) in the user's language (code "${language}" — e.g. zh=简体中文, en=English, ar=العربية, ru=Русский, fr=Français). If unclear, match the language of the input query. Property names can remain in English.**`

  // Build property descriptions
  const propertyDescriptions = properties
    .map((prop, idx) => buildPropertyDescription(prop, labels[idx]))
    .join('\n\n')

  // Build score example for JSON template
  const scoreArrayExample = labels.map(() => '85').join(', ')

  // Build winner ID options
  const winnerIdOptions = properties.map((p, idx) => `"${p.id}" for ${labels[idx]}`).join(' or ')

  // Build winner index options
  const winnerIndexOptions = labels.map((l, idx) => `${idx} for Property ${l}`).join(', ')

  // Build buyer profile section - prefer freeform description
  let buyerProfileSection: string
  if (profile.freeformDescription) {
    buyerProfileSection = `## Buyer Profile (User's Own Description)
"${profile.freeformDescription}"

Please extract their needs, preferences, budget constraints, family situation, and investment goals from this description.`
  } else {
    buyerProfileSection = `## Buyer Profile
- Family Status: ${profile.familyStatus || 'Not specified'}
- Primary Purpose: ${profile.purpose || 'Not specified'}
${profile.hasChildren ? `- Has Children (ages: ${profile.childrenAges || 'not specified'})` : ''}
${profile.investmentHorizon ? `- Investment Horizon: ${profile.investmentHorizon}` : ''}
${profile.riskTolerance ? `- Risk Tolerance: ${profile.riskTolerance}` : ''}
${profile.workLocation ? `- Work Location: ${profile.workLocation}` : ''}
${profile.schoolPreference ? '- School proximity is important' : ''}
${profile.budget ? `- Budget: AED ${profile.budget.min.toLocaleString()} - ${profile.budget.max.toLocaleString()}` : ''}`
  }

  return `You are an expert Dubai real estate advisor. Analyze these ${propertyCount} properties and provide a DATA-DRIVEN personalized comparison for the buyer.

${buyerProfileSection}

${propertyDescriptions}

## Analysis Requirements

Provide a comprehensive comparison with SPECIFIC DATA POINTS. Don't be generic - reference actual numbers from the properties.

{
  "summary": "2-3 sentences comparing the properties with SPECIFIC price/sqft/location data",
  "recommendation": {
    "winnerId": "${properties[0].id}",
    "winnerIndex": 0,
    "confidence": "high|medium|low",
    "reasons": [
      "Specific reason with data, e.g. 'Lowest price per sqft at AED X vs AED Y for B'",
      "Another specific reason with numbers",
      "Third reason with concrete comparison"
    ]
  },
  "dimensions": {
    "investment": {
      "scores": [${scoreArrayExample}],
      "explanation": "Compare with SPECIFIC DATA: price/sqft, developer track record, area appreciation rates. E.g., 'A offers AED X/sqft vs B's AED Y/sqft. Developer X has delivered Y projects.'"
    },
    "lifestyle": {
      "scores": [${scoreArrayExample}],
      "explanation": "Compare amenities COUNT and TYPES. E.g., 'A has pool, gym, park (3 amenities) vs B's pool, gym (2 amenities). A better for families.'"
    },
    "location": {
      "scores": [${scoreArrayExample}],
      "explanation": "Compare locations with SPECIFIC factors. E.g., 'Dubai Design District is closer to Downtown than JVC. Better for work commute.'"
    },
    "value": {
      "scores": [${scoreArrayExample}],
      "explanation": "Compare total value with NUMBERS. E.g., 'A: AED X total, Y sqft = Z/sqft. B: AED X total, Y sqft = Z/sqft. A is X% better value.'"
    }
  },
  "personalizedAdvice": "Specific advice based on the buyer's stated needs with concrete recommendations and numbers"
}

CRITICAL REQUIREMENTS:
1. winnerIndex: ${winnerIndexOptions}
2. winnerId: ${winnerIdOptions}
3. scores array: EXACTLY ${propertyCount} INTEGER values (no decimals), order: ${labels.join(', ')}
4. ALL scores must be INTEGERS between 0-100 (e.g., 85, 72, 91 - NOT 85.5 or 72.3)
5. Explanations MUST include specific numbers from the property data
6. Don't use generic phrases like "varies across properties" - use actual data${outputLanguageInstruction}

Respond ONLY with valid JSON, no additional text.`
}

/**
 * Generate mock report when API is unavailable
 */
function generateMockReport(
  properties: PropertyData[],
  profile: UserProfile,
  language: string = 'en'
): ComparisonReport {
  const isChineseLang = language.startsWith('zh')

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

  // Generate dimension scores with some variation (always integers)
  const generateDimensionScores = (variation: number) => {
    return baseScores.map(s => Math.round(Math.max(30, Math.min(95, s + (Math.random() * variation * 2 - variation)))))
  }

  // Text content based on language
  const purpose = profile.purpose || 'investment'
  const familyStatus = profile.familyStatus || 'single'

  if (isChineseLang) {
    const purposeText = purpose === 'investment' ? '投资' : purpose === 'residence' ? '自住' : '综合用途'
    const familyText = familyStatus === 'single' ? '单身' : familyStatus === 'couple' ? '情侣' : '家庭'

    return {
      id: `mock_report_${Date.now()}`,
      createdAt: Date.now(),
      items: properties.map(p => ({
        projectId: p.projectId,
        unitTypeId: p.unitTypeId
      })),
      summary: `根据您的${purposeText}目标和${familyText}状况，我们分析了${properties.length}个房产。${winner.projectName}似乎非常符合您的需求，在${winner.area}地区提供有竞争力的价格和合适的配套设施。`,
      recommendation: {
        winnerId: winner.id,
        winnerIndex,
        confidence: 'medium',
        reasons: [
          `在${properties.length}个选项中，${purposeText}性价比最佳`,
          `${winner.area}的位置与您的偏好非常契合`,
          `开发商${winner.developer}在迪拜有良好的业绩记录`
        ]
      },
      dimensions: {
        investment: {
          scores: generateDimensionScores(10),
          explanation: `${properties.length}个房产的投资潜力各有不同。${winner.area}近年来持续升值。`
        },
        lifestyle: {
          scores: generateDimensionScores(8),
          explanation: `每个房产都提供不同的生活配套。${winner.projectName}提供了均衡的社区设施组合。`
        },
        location: {
          scores: generateDimensionScores(12),
          explanation: `所有位置都是迪拜的理想区域。建议考虑与您${profile.workLocation || '工作地点'}的距离。`
        },
        value: {
          scores: generateDimensionScores(6),
          explanation: `综合考虑每平方尺价格和付款计划灵活性。${winner.projectName}提供有竞争力的整体价值。`
        }
      },
      personalizedAdvice: purpose === 'investment'
        ? `考虑到您的${profile.investmentHorizon === 'short' ? '短期' : profile.investmentHorizon === 'long' ? '长期' : '中期'}投资周期和${profile.riskTolerance === 'conservative' ? '保守' : profile.riskTolerance === 'aggressive' ? '激进' : '稳健'}的风险偏好，建议在做决定前比较所有${properties.length}个选项的付款计划灵活性。`
        : `作为寻求${purposeText}的${familyText}，建议在比较这${properties.length}个房产时优先考虑社区配套和${profile.schoolPreference ? '学校距离' : '交通便利性'}。`
    }
  }

  return {
    id: `mock_report_${Date.now()}`,
    createdAt: Date.now(),
    items: properties.map(p => ({
      projectId: p.projectId,
      unitTypeId: p.unitTypeId
    })),
    summary: `Based on your ${purpose} goals and ${familyStatus} status, we've analyzed ${properties.length} properties. ${winner.projectName} appears to be a strong match for your requirements, offering competitive pricing and suitable amenities in ${winner.area}.`,
    recommendation: {
      winnerId: winner.id,
      winnerIndex,
      confidence: 'medium',
      reasons: [
        `Best value proposition for ${purpose} purposes among the ${properties.length} options`,
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
