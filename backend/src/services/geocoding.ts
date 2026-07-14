import { counter } from '../telemetry'
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
    const data = await response.json()

    if (data.status === 'ZERO_RESULTS') {
      // 地理编码失败 = **项目在地图上没有位置**(或落到错的地方)。楼书里的地址千奇百怪,
      // 这个失败率就是数据质量的直接指标 —— 之前只有 console。
      counter('geocode', { result: 'zero_results' }).inc()
      console.log(`   ⚠️  No geocoding results for: "${searchQuery}"`)
      return null
    }

    if (data.status !== 'OK') {
      // status 是 Google 的固定枚举(OVER_QUERY_LIMIT / REQUEST_DENIED / …),低基数,可当 label
      counter('geocode', { result: String(data.status).slice(0, 24) }).inc()
      console.error(`   ✗ Geocoding API error: ${data.status}`, data.error_message)
      return null
    }

    const result = data.results[0]
    const coords: GeocodingResult = {
      lat: result.geometry.location.lat,
      lng: result.geometry.location.lng,
      formattedAddress: result.formatted_address
    }

    counter('geocode', { result: 'ok' }).inc()
    console.log(`   ✓ Geocoded: ${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}`)
    return coords

  } catch (error) {
    counter('geocode', { result: 'error' }).inc()
    console.error('   ✗ Geocoding error:', error)
    return null
  }
}
