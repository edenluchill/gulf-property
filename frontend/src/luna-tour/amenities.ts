/**
 * Luna Tour — real amenity analysis (§ user: 用地图自带功能 + 真实数据).
 *
 * Ports the backend `analyze_area_amenities` scoring to the client and reuses
 * the existing public POI endpoint (/api/dubai-pois/near). Given a property's
 * coords, returns the SAME payload the voice assistant feeds the map's real
 * radial amenity viz (voiceAmenities) — real nearest hospital/school/mall/metro/
 * supermarket with real distances + a 0-100 convenience score. No placeholders.
 */
import { API_BASE_URL } from '../lib/config'
import type { AmenityPayload, AmenitySpoke } from './types'

const SPECS = [
  { cat: 'hospital', zh: '医院', emoji: '🏥', ideal: 2, zero: 10, weight: 0.2 },
  { cat: 'school', zh: '学校', emoji: '🏫', ideal: 1.5, zero: 6, weight: 0.2 },
  { cat: 'mall', zh: '商场', emoji: '🛍️', ideal: 3, zero: 8, weight: 0.2 },
  { cat: 'metro_station', zh: '地铁', emoji: '🚇', ideal: 1.5, zero: 5, weight: 0.25 },
  { cat: 'supermarket', zh: '超市', emoji: '🛒', ideal: 1, zero: 4, weight: 0.15 },
] as const

interface NearPoi {
  name: string
  category: string
  lat: number
  lng: number
  distance_meters: number
}

function tierOf(score100: number): string {
  return score100 >= 75 ? '优秀' : score100 >= 55 ? '良好' : score100 >= 35 ? '一般' : '偏远'
}

/** Compute the real amenity radial for a property coord. Returns null on failure. */
export async function fetchAmenity(
  lng: number,
  lat: number,
  centerName: string
): Promise<AmenityPayload | null> {
  try {
    const cats = SPECS.map((s) => s.cat).join(',')
    const res = await fetch(
      `${API_BASE_URL}/api/dubai-pois/near?lat=${lat}&lng=${lng}&radius=10000&categories=${cats}`
    )
    if (!res.ok) return null
    const data = (await res.json()) as { pois?: NearPoi[] }
    const pois = data.pois || []

    const spokes: AmenitySpoke[] = []
    let score = 0
    for (const s of SPECS) {
      const hit = pois
        .filter((p) => p.category === s.cat)
        .sort((a, b) => a.distance_meters - b.distance_meters)[0]
      if (!hit) continue
      const km = hit.distance_meters / 1000
      const sub = Math.max(0, Math.min(1, (s.zero - km) / (s.zero - s.ideal)))
      score += s.weight * sub
      spokes.push({
        category: s.cat,
        label: s.zh,
        emoji: s.emoji,
        name: hit.name,
        lng: hit.lng,
        lat: hit.lat,
        distanceKm: Number(km.toFixed(2)),
      })
    }
    if (spokes.length === 0) return null
    const score100 = Math.round(score * 100)
    return { center: [lng, lat], centerName, score: score100, tier: tierOf(score100), spokes }
  } catch {
    return null
  }
}
