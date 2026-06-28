// Web-mercator latitude → slippy tile Y at a given zoom (for tile prefetching).
export const lat2tileY = (lat: number, z: number) =>
  Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z)

// Web-mercator longitude → slippy tile X at a given zoom.
export const lon2tileX = (lng: number, z: number) =>
  Math.floor(((lng + 180) / 360) * 2 ** z)

/**
 * A satellite-aerial thumbnail URL for a lat/lng — a free, accurate, copyright-safe
 * "photo of the place" for areas that have no project image of their own. Uses the
 * same Esri World Imagery tiles the map falls back to (no API key).
 */
export const satelliteThumbUrl = (lat: number, lng: number, z = 13): string =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${lat2tileY(lat, z)}/${lon2tileX(lng, z)}`

/** Rough center (bbox midpoint) of a GeoJSON Polygon/MultiPolygon. */
export function geomCenter(geom: any): { lat: number; lng: number } | null {
  if (!geom?.coordinates) return null
  let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180, seen = false
  const walk = (a: any) => {
    if (typeof a[0] === 'number') {
      const [lng, lat] = a
      if (Number.isFinite(lng) && Number.isFinite(lat)) {
        seen = true
        if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat
        if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng
      }
    } else if (Array.isArray(a)) a.forEach(walk)
  }
  walk(geom.coordinates)
  return seen ? { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 } : null
}

// 两点间球面距离（km），用于地图测距工具
export function haversineKm(a: { lng: number; lat: number }, b: { lng: number; lat: number }): number {
  const R = 6371
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
