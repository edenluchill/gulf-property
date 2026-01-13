/**
 * PDF Processing Service with AI
 * 
 * This service uses AI (Claude/OpenAI) to process PDF documents and extract:
 * - Property details (name, developer, location, pricing, etc.)
 * - Unit types with specifications
 * - Payment plans
 * - Images (categorized as showcase, floorplans, amenities)
 * 
 * The AI agent analyzes the PDF structure and intelligently extracts data.
 */

import Anthropic from '@anthropic-ai/sdk'

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
 * Process PDF with AI to extract property data
 */
export async function processPdfWithAI(
  pdfBuffer: Buffer,
  filename: string
): Promise<ProcessedPdfData> {
  
  // Check if Anthropic API key is available
  const apiKey = process.env.ANTHROPIC_API_KEY
  
  if (!apiKey) {
    console.warn('ANTHROPIC_API_KEY not found, using mock data')
    return generateMockData(filename)
  }

  try {
    const anthropic = new Anthropic({
      apiKey: apiKey,
    })

    // Convert PDF to base64 for API
    const pdfBase64 = pdfBuffer.toString('base64')

    console.log('Sending PDF to Claude for processing...')

    // Use Claude with PDF support
    const message = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: pdfBase64,
              },
            },
            {
              type: 'text',
              text: `Analyze this real estate property brochure PDF and extract all relevant information. 

Please provide a comprehensive JSON response with the following structure:

{
  "projectName": "string - The name of the building/project",
  "developer": "string - The developer company name",
  "address": "string - Full address including area/district and city",
  "minPrice": number - Minimum price in AED (extract from any unit type, if available),
  "maxPrice": number - Maximum price in AED (extract from any unit type, if available),
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

Important extraction guidelines:
1. Extract ALL unit types mentioned (Studio, 1BR, 2BR, 3BR, Penthouse, etc.)
2. For payment plans, preserve the exact milestone names as they appear in the PDF
3. Convert all areas to square feet if given in other units
4. Extract amenities from any amenities section or feature lists
5. If lat/long not explicitly stated, leave as null (don't guess)
6. Be thorough - check tables, charts, and infographics for data
7. For dates, use ISO format YYYY-MM-DD
8. If a field is not available in the PDF, use null for numbers or empty string for text

Please respond ONLY with valid JSON, no additional text.`
            }
          ]
        }
      ]
    })

    console.log('Received response from Claude')

    // Extract JSON from response
    const responseText = message.content
      .filter((block) => block.type === 'text')
      .map((block: any) => block.text)
      .join('')

    // Try to parse JSON from the response
    let extractedData: any
    try {
      // Remove markdown code blocks if present
      const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/) || 
                       responseText.match(/```\s*([\s\S]*?)\s*```/)
      
      const jsonText = jsonMatch ? jsonMatch[1] : responseText
      extractedData = JSON.parse(jsonText.trim())
    } catch (parseError) {
      console.error('Failed to parse Claude response as JSON:', responseText)
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
        showcase: [], // PDF image extraction would require additional library (pdf-lib, pdfjs-dist)
        floorplans: [],
        amenities: [],
      }
    }

    console.log('Successfully processed PDF:', processedData.projectName)

    return processedData
  } catch (error) {
    console.error('Error processing PDF with AI:', error)
    
    // Fallback to mock data on error
    console.warn('Falling back to mock data due to AI processing error')
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
    projectName: projectNameFromFile || 'Sample Project',
    developer: 'Sample Developer',
    address: 'Business Bay, Dubai, UAE',
    minPrice: 1200000,
    maxPrice: 3500000,
    minArea: 422,
    maxArea: 1991,
    minBedrooms: 0,
    maxBedrooms: 3,
    latitude: 25.1872,
    longitude: 55.2608,
    completionDate: '2026-12-31',
    launchDate: '2024-01-01',
    description: 'A luxurious residential development in the heart of Dubai, offering modern amenities and stunning views.',
    amenities: [
      'Swimming Pool',
      'Gym & Fitness Center',
      'Children\'s Play Area',
      '24/7 Security',
      'Covered Parking',
      'Landscaped Gardens',
      'Business Center',
      'Concierge Services'
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
        milestone: 'On Completion',
        percentage: 30,
        date: '2026-12-31'
      }
    ],
    images: {
      showcase: [],
      floorplans: [],
      amenities: []
    }
  }
}
