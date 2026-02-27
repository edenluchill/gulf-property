/**
 * Google Maps Geocoding Service
 *
 * Converts addresses to coordinates using Google Maps Geocoding API
 * Used internally by the PDF processing workflow
 */

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY

export interface GeocodingResult {
  lat: number
  lng: number
  formattedAddress?: string
}

interface GoogleGeocodingResponse {
  status: string
  error_message?: string
  results: Array<{
    geometry: {
      location: {
        lat: number
        lng: number
      }
    }
    formatted_address: string
  }>
}

/**
 * Geocode an address to get coordinates
 * Biased towards Dubai, UAE
 *
 * @param address - Address string to geocode (e.g. "Dubai Marina" or "Jumeirah Beach Residence")
 * @param projectName - Optional project name to combine with address for better results
 * @returns Coordinates or null if not found
 */
export async function geocodeAddress(
  address: string,
  projectName?: string
): Promise<GeocodingResult | null> {
  if (!address) {
    return null
  }

  if (!GOOGLE_MAPS_API_KEY) {
    console.warn('   ⚠️  Google Maps API key not configured, skipping geocoding')
    return null
  }

  try {
    // Build search query - combine project name and address for better results
    let searchQuery = address
    if (projectName && !address.toLowerCase().includes(projectName.toLowerCase())) {
      searchQuery = `${projectName}, ${address}`
    }

    // Ensure Dubai context
    if (!searchQuery.toLowerCase().includes('dubai') && !searchQuery.toLowerCase().includes('uae')) {
      searchQuery = `${searchQuery}, Dubai, UAE`
    }

    console.log(`   🌍 Geocoding: "${searchQuery}"`)

    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json')
    url.searchParams.set('address', searchQuery)
    url.searchParams.set('key', GOOGLE_MAPS_API_KEY)
    // Bias results to Dubai area (lat_lo,lng_lo|lat_hi,lng_hi)
    url.searchParams.set('bounds', '24.7,54.8|25.6,56.0')
    url.searchParams.set('region', 'ae')

    const response = await fetch(url.toString())
    const data = await response.json() as GoogleGeocodingResponse

    if (data.status === 'ZERO_RESULTS') {
      console.log(`   ⚠️  No geocoding results for: "${searchQuery}"`)
      return null
    }

    if (data.status !== 'OK') {
      console.error(`   ✗ Geocoding API error: ${data.status}`, data.error_message)
      return null
    }

    const result = data.results[0]
    const coords: GeocodingResult = {
      lat: result.geometry.location.lat,
      lng: result.geometry.location.lng,
      formattedAddress: result.formatted_address
    }

    console.log(`   ✓ Geocoded: ${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}`)
    return coords

  } catch (error) {
    console.error('   ✗ Geocoding error:', error)
    return null
  }
}
