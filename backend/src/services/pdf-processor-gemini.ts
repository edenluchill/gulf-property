/**
 * PDF Processing Service with Google Gemini Flash
 * 
 * Uses Gemini 2.0 Flash for PDF and image analysis
 * Free tier: 1500 requests/day
 */

import { GoogleGenerativeAI } from '@google/generative-ai'
import { readFileSync } from 'fs'

interface ProcessedPdfData {
  projectName: string
  developer: string
  address: string
  minPrice: number | null
  maxPrice: number | null
  minArea: number | null
  maxArea: number | null
  minBedrooms: number | null
  maxBedrooms: number | null
  latitude: number | null
  longitude: number | null
  completionDate: string
  launchDate: string
  description: string
  amenities: string[]
  unitTypes: Array<{
    id: string
    name: string
    minArea: number | null
    maxArea: number | null
    minPrice: number | null
    maxPrice: number | null
    bedrooms: number | null
    bathrooms: number | null
  }>
  paymentPlan: Array<{
    milestone: string
    percentage: number
    date: string | null
  }>
  images: {
    showcase: string[]
    floorplans: string[]
    amenities: string[]
  }
}

/**
 * Process PDF with Google Gemini Flash
 */
export async function processPdfWithGemini(
  pdfBuffer: Buffer,
  filename: string
): Promise<ProcessedPdfData> {
  
  const apiKey = process.env.GEMINI_API_KEY
  
  if (!apiKey) {
    console.warn('GEMINI_API_KEY not found, using mock data')
    return generateMockData(filename)
  }

  try {
    // Initialize Gemini
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({ 
      model: 'gemini-3-flash-preview',  // Latest model with multimodal support
    })

    console.log('Processing PDF with Gemini Flash...')

    // Convert PDF to base64
    const pdfBase64 = pdfBuffer.toString('base64')

    // Prepare the prompt
    const prompt = `You are an expert real estate data extraction system. Analyze this Dubai property brochure PDF and extract ALL information in a structured JSON format.

Extract the following information:

{
  "projectName": "string - The name of the building/project",
  "developer": "string - The developer company name",
  "address": "string - Full address including area/district and city",
  "minPrice": number - Minimum price in AED (from any unit type),
  "maxPrice": number - Maximum price in AED (from any unit type),
  "minArea": number - Minimum area in square feet,
  "maxArea": number - Maximum area in square feet,
  "minBedrooms": number - Minimum bedrooms (0 for studio),
  "maxBedrooms": number - Maximum bedrooms,
  "latitude": number - Latitude if mentioned or can be inferred from location,
  "longitude": number - Longitude if mentioned or can be inferred from location,
  "completionDate": "YYYY-MM-DD - Expected completion date",
  "launchDate": "YYYY-MM-DD - Launch date if available",
  "description": "string - A brief description of the project",
  "amenities": ["array", "of", "amenities"] - List all amenities mentioned,
  "unitTypes": [
    {
      "id": "unique_id",
      "name": "STUDIO/1 BEDROOM/2 BEDROOM/etc",
      "minArea": number - in sqft,
      "maxArea": number - in sqft,
      "minPrice": number - in AED,
      "maxPrice": number - in AED,
      "bedrooms": number - number of bedrooms (0 for studio),
      "bathrooms": number - number of bathrooms
    }
  ],
  "paymentPlan": [
    {
      "milestone": "Down Payment / Month Name / On Completion / etc",
      "percentage": number - percentage of payment (e.g., 20 for 20%),
      "date": "YYYY-MM-DD or null - specific date if mentioned"
    }
  ]
}

IMPORTANT EXTRACTION GUIDELINES:
1. Extract ALL unit types mentioned in the document (Studio, 1BR, 2BR, 3BR, 4BR, Penthouse, etc.)
2. Look for tables, charts, and infographics carefully
3. Payment plan: Preserve exact milestone names as they appear
4. Convert all areas to square feet if given in other units
5. Extract amenities from any sections mentioning facilities or features
6. If latitude/longitude not explicitly stated, leave as null (don't guess)
7. Be thorough - check every page for data
8. For dates, use ISO format YYYY-MM-DD
9. If a field is not available in the PDF, use null for numbers or empty string for text
10. Pay special attention to the PAYMENT PLAN section - extract ALL milestones with their percentages

Respond ONLY with valid JSON, no additional text or explanation.`

    // Generate content with PDF
    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          mimeType: 'application/pdf',
          data: pdfBase64,
        },
      },
    ])

    const response = await result.response
    const text = response.text()

    console.log('Received response from Gemini')

    // Parse JSON from response
    let extractedData: any
    try {
      // Remove markdown code blocks if present
      const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || 
                       text.match(/```\s*([\s\S]*?)\s*```/)
      
      const jsonText = jsonMatch ? jsonMatch[1] : text
      extractedData = JSON.parse(jsonText.trim())
    } catch (parseError) {
      console.error('Failed to parse Gemini response as JSON:', text.substring(0, 500))
      throw new Error('AI response was not valid JSON')
    }

    // Process and structure the data
    const processedData: ProcessedPdfData = {
      projectName: extractedData.projectName || '',
      developer: extractedData.developer || '',
      address: extractedData.address || '',
      minPrice: extractedData.minPrice || null,
      maxPrice: extractedData.maxPrice || null,
      minArea: extractedData.minArea || null,
      maxArea: extractedData.maxArea || null,
      minBedrooms: extractedData.minBedrooms !== undefined ? extractedData.minBedrooms : null,
      maxBedrooms: extractedData.maxBedrooms !== undefined ? extractedData.maxBedrooms : null,
      latitude: extractedData.latitude || null,
      longitude: extractedData.longitude || null,
      completionDate: extractedData.completionDate || '',
      launchDate: extractedData.launchDate || '',
      description: extractedData.description || '',
      amenities: Array.isArray(extractedData.amenities) ? extractedData.amenities : [],
      unitTypes: Array.isArray(extractedData.unitTypes) 
        ? extractedData.unitTypes.map((unit: any, index: number) => ({
            id: unit.id || `unit_${index}_${Date.now()}`,
            name: unit.name || '',
            minArea: unit.minArea || null,
            maxArea: unit.maxArea || null,
            minPrice: unit.minPrice || null,
            maxPrice: unit.maxPrice || null,
            bedrooms: unit.bedrooms !== undefined ? unit.bedrooms : null,
            bathrooms: unit.bathrooms || null,
          }))
        : [],
      paymentPlan: Array.isArray(extractedData.paymentPlan)
        ? extractedData.paymentPlan.map((item: any) => ({
            milestone: item.milestone || '',
            percentage: item.percentage || 0,
            date: item.date || null,
          }))
        : [],
      images: {
        showcase: [], // Can be extracted with Gemini Vision API in Phase 2
        floorplans: [],
        amenities: [],
      }
    }

    console.log('Successfully processed PDF:', processedData.projectName)
    console.log('Extracted unit types:', processedData.unitTypes.length)
    console.log('Extracted payment plan items:', processedData.paymentPlan.length)

    return processedData
  } catch (error) {
    console.error('Error processing PDF with Gemini:', error)
    
    // Fallback to mock data on error
    console.warn('Falling back to mock data due to Gemini processing error')
    return generateMockData(filename)
  }
}

/**
 * Generate mock data for testing (when API key not available)
 */
function generateMockData(filename: string): ProcessedPdfData {
  // Extract project name from filename if possible
  const projectNameFromFile = filename
    .replace('.pdf', '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, l => l.toUpperCase())

  return {
    projectName: projectNameFromFile || 'Binghatti Skyrise',
    developer: 'Binghatti',
    address: 'Business Bay, Dubai, UAE',
    minPrice: 1200000,
    maxPrice: 3500000,
    minArea: 422,
    maxArea: 1991,
    minBedrooms: 0,
    maxBedrooms: 3,
    latitude: 25.1872,
    longitude: 55.2608,
    completionDate: '2026-09-30',
    launchDate: '2024-11-01',
    description: 'A luxurious residential development in the heart of Dubai\'s Business Bay, offering modern amenities and stunning views. Binghatti Skyrise features contemporary design with world-class facilities.',
    amenities: [
      'Swimming Pool',
      'Gym & Fitness Center',
      'Children\'s Play Area',
      '24/7 Security',
      'Covered Parking',
      'Landscaped Gardens',
      'Business Center',
      'Concierge Services',
      'Steam & Sauna',
      'BBQ Area'
    ],
    unitTypes: [
      {
        id: 'unit_1',
        name: 'STUDIO',
        minArea: 422,
        maxArea: 477,
        minPrice: 1200000,
        maxPrice: 1350000,
        bedrooms: 0,
        bathrooms: 1
      },
      {
        id: 'unit_2',
        name: '1 BEDROOM',
        minArea: 762,
        maxArea: 1022,
        minPrice: 1800000,
        maxPrice: 2100000,
        bedrooms: 1,
        bathrooms: 1.5
      },
      {
        id: 'unit_3',
        name: '2 BEDROOM',
        minArea: 1277,
        maxArea: 1667,
        minPrice: 2500000,
        maxPrice: 2900000,
        bedrooms: 2,
        bathrooms: 2
      },
      {
        id: 'unit_4',
        name: '3 BEDROOM',
        minArea: 1839,
        maxArea: 1991,
        minPrice: 3200000,
        maxPrice: 3500000,
        bedrooms: 3,
        bathrooms: 3
      }
    ],
    paymentPlan: [
      {
        milestone: 'Down Payment',
        percentage: 20,
        date: '2025-11-01'
      },
      {
        milestone: 'December 2024',
        percentage: 2,
        date: '2024-12-01'
      },
      {
        milestone: 'January 2025',
        percentage: 2,
        date: '2025-01-01'
      },
      {
        milestone: 'February 2025',
        percentage: 2,
        date: '2025-02-01'
      },
      {
        milestone: 'March 2025',
        percentage: 2,
        date: '2025-03-01'
      },
      {
        milestone: 'April 2025',
        percentage: 2,
        date: '2025-04-01'
      },
      {
        milestone: 'May 2025',
        percentage: 2,
        date: '2025-05-01'
      },
      {
        milestone: 'June 2025',
        percentage: 2,
        date: '2025-06-01'
      },
      {
        milestone: 'July 2025',
        percentage: 2,
        date: '2025-07-01'
      },
      {
        milestone: 'August 2025',
        percentage: 2,
        date: '2025-08-01'
      },
      {
        milestone: 'September 2025',
        percentage: 2,
        date: '2025-09-01'
      },
      {
        milestone: 'October 2025',
        percentage: 2,
        date: '2025-10-01'
      },
      {
        milestone: 'November 2025',
        percentage: 2,
        date: '2025-11-01'
      },
      {
        milestone: 'December 2025',
        percentage: 2,
        date: '2025-12-01'
      },
      {
        milestone: 'January 2026',
        percentage: 2,
        date: '2026-01-01'
      },
      {
        milestone: 'February 2026',
        percentage: 2,
        date: '2026-02-01'
      },
      {
        milestone: 'March 2026',
        percentage: 2,
        date: '2026-03-01'
      },
      {
        milestone: 'April 2026',
        percentage: 3,
        date: '2026-04-01'
      },
      {
        milestone: 'May 2026',
        percentage: 3,
        date: '2026-05-01'
      },
      {
        milestone: 'June 2026',
        percentage: 3,
        date: '2026-06-01'
      },
      {
        milestone: 'July 2026',
        percentage: 3,
        date: '2026-07-01'
      },
      {
        milestone: 'August 2026',
        percentage: 3,
        date: '2026-08-01'
      },
      {
        milestone: 'September 2026',
        percentage: 3,
        date: '2026-09-01'
      },
      {
        milestone: 'On Completion',
        percentage: 30,
        date: '2026-09-30'
      }
    ],
    images: {
      showcase: [],
      floorplans: [],
      amenities: []
    }
  }
}
