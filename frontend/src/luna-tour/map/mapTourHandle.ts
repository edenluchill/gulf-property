/**
 * Luna Tour — shared cinematic camera/overlay handle.
 *
 * `createMapTourHandle` turns ANY maplibre-gl map instance into something the
 * TimelineEngine can drive frame-by-frame. Used by:
 *   • the main search map (MapViewMapLibre) — so the tour runs ON the real map
 *     with all its live data layers (§ user request: 统一主地图)
 *   • the standalone demo TourMap (fallback)
 *
 * ISOLATION: pure factory, no React. Adds only `lt-` prefixed sources/layers/
 * markers so it never collides with the host map's own layers. clearOverlays()
 * removes exactly what it added. Delete the luna-tour directory to remove.
 */
import maplibregl, { Map as MaplibreMap, Marker } from 'maplibre-gl'
import type { Camera, LngLat } from '../types'

export interface DistanceLineOpts {
  from: LngLat
  to: LngLat
  label: string
}
export interface AmenitySpokesOpts {
  center: LngLat
  spokes: { label: string; distance_km: number }[]
  score: number
  tier?: string
}

export interface MapTourHandle {
  flyTo(o: {
    center?: LngLat
    zoom?: number
    pitch?: number
    bearing?: number
    duration?: number
    easing?: string
  }): Promise<void>
  orbit(o: { center: LngLat; degrees: number; duration: number }): Promise<void>
  flyover(o: { from?: LngLat; to: LngLat; duration: number }): Promise<void>
  executeCamera(cam: Camera, prevCenter?: LngLat): Promise<void>
  jumpTo(o: { center?: LngLat; zoom?: number; pitch?: number; bearing?: number }): void
  drift(on: boolean): void
  drawDistanceLine(o: DistanceLineOpts): void
  showAmenitySpokes(o: AmenitySpokesOpts): void
  highlightPins(ids: string[]): void
  /** pulse a single focus ring at a coord (current property). null clears it. */
  pulseAt(coord: LngLat | null): void
  /** show the tour's own base pins (just a few, cheap) since search pins are hidden */
  setBasePins(pins: { id: string; coord: LngLat }[]): void
  clearOverlays(): void
  setStyle(style: 'dark' | 'default'): void
  resize(): void
}

export interface MapTourHandleDeps {
  getMap: () => MaplibreMap | null | undefined
  accent: string
  /** id → [lng,lat], so highlightPins can pulse rings on host-map pins */
  getCoordById?: (id: string) => LngLat | undefined
  /** style URLs for setStyle (host map may differ) */
  darkStyle?: string
  defaultStyle?: string
}

const EASINGS: Record<string, (t: number) => number> = {
  linear: (t) => t,
  easeIn: (t) => t * t,
  easeOut: (t) => t * (2 - t),
  easeInOut: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
}

export function createMapTourHandle(deps: MapTourHandleDeps): MapTourHandle {
  const { getMap, accent } = deps
  let rafId: number | null = null
  let driftRafId: number | null = null
  const overlayLayerIds: string[] = []
  const labelMarkers: Marker[] = []
  const highlightMarkers = new Map<string, Marker>()
  let pulseMarker: Marker | null = null
  let basePins: Marker[] = []

  const cancelRaf = () => {
    if (rafId) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
  }

  function flyTo(o: {
    center?: LngLat
    zoom?: number
    pitch?: number
    bearing?: number
    duration?: number
    easing?: string
  }): Promise<void> {
    const map = getMap()
    if (!map) return Promise.resolve()
    cancelRaf()
    return new Promise((resolve) => {
      const done = () => resolve()
      map.once('moveend', done)
      map.flyTo({
        center: o.center,
        zoom: o.zoom,
        pitch: o.pitch,
        bearing: o.bearing,
        duration: o.duration ?? 2000,
        curve: 1.6,
        easing: EASINGS[o.easing ?? 'easeInOut'] ?? EASINGS.easeInOut,
        essential: true,
      })
      window.setTimeout(done, (o.duration ?? 2000) + 400)
    })
  }

  function orbit(o: { center: LngLat; degrees: number; duration: number }): Promise<void> {
    const map = getMap()
    if (!map) return Promise.resolve()
    cancelRaf()
    return new Promise((resolve) => {
      const startCenter = map.getCenter()
      const tgt = { lng: o.center[0], lat: o.center[1] }
      const startBearing = map.getBearing()
      const startT = performance.now()
      const tick = (now: number) => {
        const p = Math.min(1, (now - startT) / o.duration)
        // ease the centre into place over the first 40% so an orbit that starts
        // a beat doesn't TELEPORT to the property — it glides in, then rotates.
        const cp = EASINGS.easeInOut(Math.min(1, p / 0.4))
        map.setCenter({
          lng: startCenter.lng + (tgt.lng - startCenter.lng) * cp,
          lat: startCenter.lat + (tgt.lat - startCenter.lat) * cp,
        })
        map.setBearing(startBearing + o.degrees * EASINGS.easeInOut(p))
        if (p < 1) {
          rafId = requestAnimationFrame(tick)
        } else {
          rafId = null
          resolve()
        }
      }
      rafId = requestAnimationFrame(tick)
    })
  }

  function flyover(o: { from?: LngLat; to: LngLat; duration: number }): Promise<void> {
    const map = getMap()
    if (!map) return Promise.resolve()
    cancelRaf()
    return new Promise((resolve) => {
      const done = () => resolve()
      map.once('moveend', done)
      map.flyTo({
        center: o.to,
        zoom: 13.5,
        pitch: 55,
        duration: o.duration,
        curve: 2.0,
        speed: 1.2,
        easing: EASINGS.easeInOut,
        essential: true,
      })
      window.setTimeout(done, o.duration + 400)
    })
  }

  function executeCamera(cam: Camera, prevCenter?: LngLat): Promise<void> {
    if ('type' in cam && cam.type === 'orbit') {
      return orbit({ center: cam.center, degrees: cam.degrees, duration: cam.duration_ms })
    }
    if ('type' in cam && cam.type === 'flyover') {
      return flyover({ from: cam.from ?? prevCenter, to: cam.to, duration: cam.duration_ms })
    }
    return flyTo({
      center: cam.center,
      zoom: cam.zoom,
      pitch: cam.pitch,
      bearing: cam.bearing,
      duration: cam.duration_ms,
      easing: cam.easing,
    })
  }

  function jumpTo(o: { center?: LngLat; zoom?: number; pitch?: number; bearing?: number }) {
    const map = getMap()
    if (!map) return
    cancelRaf()
    map.jumpTo({
      center: o.center ?? map.getCenter(),
      zoom: o.zoom ?? map.getZoom(),
      pitch: o.pitch ?? map.getPitch(),
      bearing: o.bearing ?? map.getBearing(),
    })
  }

  function drift(on: boolean) {
    const map = getMap()
    if (!map) return
    if (driftRafId) {
      cancelAnimationFrame(driftRafId)
      driftRafId = null
    }
    if (!on) return
    const tick = () => {
      const m = getMap()
      if (!m) return
      m.setBearing(m.getBearing() + 0.04)
      driftRafId = requestAnimationFrame(tick)
    }
    driftRafId = requestAnimationFrame(tick)
  }

  function drawDistanceLine(o: DistanceLineOpts) {
    const map = getMap()
    if (!map || !map.isStyleLoaded()) return
    const id = `lt-dist-${Math.abs(hashStr(o.label + o.to.join(',')))}`
    if (map.getSource(id)) return
    const full: GeoJSON.Feature<GeoJSON.LineString> = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: [o.from, o.to] },
    }
    map.addSource(id, { type: 'geojson', data: lineSlice(full, 0) })
    map.addLayer({
      id,
      type: 'line',
      source: id,
      paint: { 'line-color': accent, 'line-width': 3, 'line-opacity': 0.9, 'line-blur': 1.5 },
    })
    overlayLayerIds.push(id)
    const start = performance.now()
    const dur = 900
    const animate = (now: number) => {
      const p = Math.min(1, (now - start) / dur)
      const src = map.getSource(id) as maplibregl.GeoJSONSource | undefined
      if (!src) return
      src.setData(lineSlice(full, EASINGS.easeOut(p)))
      if (p < 1) requestAnimationFrame(animate)
      else addLabelPin(map, o.to, o.label)
    }
    requestAnimationFrame(animate)
  }

  function showAmenitySpokes(o: AmenitySpokesOpts) {
    const map = getMap()
    if (!map || !map.isStyleLoaded()) return
    const spokes = o.spokes.length ? o.spokes : []
    const features: GeoJSON.Feature<GeoJSON.LineString>[] = spokes.map((s, i) => {
      const angle = (i / Math.max(1, spokes.length)) * Math.PI * 2
      const km = Math.max(0.3, s.distance_km)
      const end: LngLat = [
        o.center[0] + (km / (111 * Math.cos((o.center[1] * Math.PI) / 180))) * Math.sin(angle),
        o.center[1] + (km / 111) * Math.cos(angle),
      ]
      return {
        type: 'Feature',
        properties: { label: s.label },
        geometry: { type: 'LineString', coordinates: [o.center, end] },
      }
    })
    const id = `lt-spokes-${Math.abs(hashStr(o.center.join(',')))}`
    if (map.getSource(id)) return
    map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features } })
    map.addLayer({
      id,
      type: 'line',
      source: id,
      paint: { 'line-color': accent, 'line-width': 2, 'line-opacity': 0.7, 'line-blur': 1 },
    })
    overlayLayerIds.push(id)
    const el = document.createElement('div')
    el.className = 'lt-score-chip'
    el.style.setProperty('--lt-accent', accent)
    el.innerHTML = `<b>${o.score}</b><span>${o.tier ?? ''}</span>`
    labelMarkers.push(new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(o.center).addTo(map))
  }

  function highlightPins(ids: string[]) {
    const map = getMap()
    if (!map) return
    // remove rings no longer requested
    highlightMarkers.forEach((m, id) => {
      if (!ids.includes(id)) {
        m.remove()
        highlightMarkers.delete(id)
      }
    })
    // add new ones
    for (const id of ids) {
      if (highlightMarkers.has(id)) continue
      const coord = deps.getCoordById?.(id)
      if (!coord) continue
      const el = document.createElement('div')
      el.className = 'lt-pin lt-pin-hot'
      el.innerHTML = `<span class="lt-pin-dot"></span><span class="lt-pin-ring"></span>`
      el.style.setProperty('--lt-accent', accent)
      highlightMarkers.set(
        id,
        new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(coord).addTo(map)
      )
    }
  }

  function pulseAt(coord: LngLat | null) {
    if (pulseMarker) {
      pulseMarker.remove()
      pulseMarker = null
    }
    const map = getMap()
    if (!map || !coord) return
    const el = document.createElement('div')
    el.className = 'lt-pin lt-pin-hot lt-focus'
    el.innerHTML = `<span class="lt-pin-dot"></span><span class="lt-pin-ring"></span>`
    el.style.setProperty('--lt-accent', accent)
    pulseMarker = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(coord).addTo(map)
  }

  function setBasePins(pins: { id: string; coord: LngLat }[]) {
    basePins.forEach((m) => m.remove())
    basePins = []
    const map = getMap()
    if (!map) return
    for (const p of pins) {
      const el = document.createElement('div')
      el.className = 'lt-pin'
      el.innerHTML = `<span class="lt-pin-dot"></span><span class="lt-pin-ring"></span>`
      el.style.setProperty('--lt-accent', accent)
      basePins.push(new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(p.coord).addTo(map))
    }
  }

  function addLabelPin(map: MaplibreMap, at: LngLat, label: string) {
    const el = document.createElement('div')
    el.className = 'lt-dist-label'
    el.style.setProperty('--lt-accent', accent)
    el.textContent = label
    labelMarkers.push(new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat(at).addTo(map))
  }

  function clearOverlays() {
    const map = getMap()
    if (map) {
      overlayLayerIds.forEach((id) => {
        if (map.getLayer(id)) map.removeLayer(id)
        if (map.getSource(id)) map.removeSource(id)
      })
    }
    overlayLayerIds.length = 0
    labelMarkers.forEach((m) => m.remove())
    labelMarkers.length = 0
    highlightMarkers.forEach((m) => m.remove())
    highlightMarkers.clear()
    if (pulseMarker) {
      pulseMarker.remove()
      pulseMarker = null
    }
  }

  function setStyle(style: 'dark' | 'default') {
    const map = getMap()
    if (!map) return
    const url = style === 'dark' ? deps.darkStyle : deps.defaultStyle
    if (url) map.setStyle(url)
  }

  function resize() {
    getMap()?.resize()
  }

  return {
    flyTo,
    orbit,
    flyover,
    executeCamera,
    jumpTo,
    drift,
    drawDistanceLine,
    showAmenitySpokes,
    highlightPins,
    pulseAt,
    setBasePins,
    clearOverlays,
    setStyle,
    resize,
  }
}

function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i)
  return h | 0
}

function lineSlice(
  full: GeoJSON.Feature<GeoJSON.LineString>,
  t: number
): GeoJSON.Feature<GeoJSON.LineString> {
  const [a, b] = full.geometry.coordinates
  const lng = a[0] + (b[0] - a[0]) * t
  const lat = a[1] + (b[1] - a[1]) * t
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: [a, [lng, lat]] },
  }
}
