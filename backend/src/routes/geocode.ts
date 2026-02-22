/**
 * Google Maps Geocoding API proxy
 * Provides address-to-coordinates conversion via Google Maps API
 */

import { Router, Request, Response } from 'express'

const router = Router()

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY

interface GeocodeResult {
  formattedAddress: string
  lat: number
  lng: number
  placeId: string
}

/**
 * GET /api/geocode/search?address=xxx
 * Search for an address and return coordinates
 */
router.get('/search', async (req: Request, res: Response) => {
  const { address } = req.query

  if (!address || typeof address !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'Address query parameter is required'
    })
  }

  if (!GOOGLE_MAPS_API_KEY) {
    return res.status(500).json({
      success: false,
      error: 'Google Maps API key not configured'
    })
  }

  try {
    // Bias search towards Dubai, UAE
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json')
    url.searchParams.set('address', address)
    url.searchParams.set('key', GOOGLE_MAPS_API_KEY)
    // Bias results to Dubai area
    url.searchParams.set('bounds', '24.7,54.8|25.6,56.0')
    url.searchParams.set('region', 'ae')

    const response = await fetch(url.toString())
    const data = await response.json()

    if (data.status === 'ZERO_RESULTS') {
      return res.json({
        success: true,
        results: []
      })
    }

    if (data.status !== 'OK') {
      console.error('Google Geocoding API error:', data.status, data.error_message)
      return res.status(500).json({
        success: false,
        error: `Geocoding failed: ${data.status}`
      })
    }

    const results: GeocodeResult[] = data.results.slice(0, 5).map((result: any) => ({
      formattedAddress: result.formatted_address,
      lat: result.geometry.location.lat,
      lng: result.geometry.location.lng,
      placeId: result.place_id
    }))

    res.json({
      success: true,
      results
    })
  } catch (error) {
    console.error('Geocoding error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to geocode address'
    })
  }
})

/**
 * GET /api/geocode/place?placeId=xxx
 * Get coordinates for a specific place ID
 */
router.get('/place', async (req: Request, res: Response) => {
  const { placeId } = req.query

  if (!placeId || typeof placeId !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'placeId query parameter is required'
    })
  }

  if (!GOOGLE_MAPS_API_KEY) {
    return res.status(500).json({
      success: false,
      error: 'Google Maps API key not configured'
    })
  }

  try {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json')
    url.searchParams.set('place_id', placeId)
    url.searchParams.set('key', GOOGLE_MAPS_API_KEY)

    const response = await fetch(url.toString())
    const data = await response.json()

    if (data.status !== 'OK' || !data.results.length) {
      return res.status(404).json({
        success: false,
        error: 'Place not found'
      })
    }

    const result = data.results[0]
    res.json({
      success: true,
      result: {
        formattedAddress: result.formatted_address,
        lat: result.geometry.location.lat,
        lng: result.geometry.location.lng,
        placeId: result.place_id
      }
    })
  } catch (error) {
    console.error('Place lookup error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to lookup place'
    })
  }
})

export default router
