import { useState, useEffect, useRef, useMemo, memo } from 'react'
import { MapContainer, TileLayer, Marker, Polygon, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import { DubaiArea, DubaiLandmark } from '../types'

export type AreaMetric = 'none' | 'avgPrice' | 'capitalGrowth' | 'salesVolume' | 'rentalYield'

// Compute centroid of a polygon (average of all points)
function getCentroid(coords: [number, number][]): [number, number] {
  let latSum = 0
  let lngSum = 0
  for (const [lat, lng] of coords) {
    latSum += lat
    lngSum += lng
  }
  return [latSum / coords.length, lngSum / coords.length]
}

// Bounding-box diagonal of a polygon in degrees — rough proxy for "size on screen"
function getPolygonSpan(coords: [number, number][]): number {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity
  for (const [lat, lng] of coords) {
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
    if (lng < minLng) minLng = lng
    if (lng > maxLng) maxLng = lng
  }
  const dLat = maxLat - minLat
  const dLng = maxLng - minLng
  return Math.sqrt(dLat * dLat + dLng * dLng)
}

// Progressive threshold — more aggressive at low zoom
function getMinSpanForZoom(zoom: number): number {
  if (zoom >= 14) return 0
  if (zoom >= 13) return 0.008
  if (zoom >= 12) return 0.02
  if (zoom >= 11) return 0.04
  if (zoom >= 10) return 0.07
  return 0.12 // zoom <= 9
}

// ── Area clustering for low zoom ──────────────────────────────────────────────

interface AreaDataItem { area: DubaiArea; centroid: [number, number]; span: number }
interface AreaClusterGroup {
  items: AreaDataItem[]
  centroid: [number, number]
  bounds: L.LatLngBoundsLiteral
}

function getMergeRadius(zoom: number): number {
  if (zoom >= 13) return 0   // no merging — individual mode
  if (zoom >= 12) return 0.03
  if (zoom >= 11) return 0.06
  if (zoom >= 10) return 0.1
  if (zoom >= 9) return 0.15
  return 0.22
}

function clusterAreas(items: AreaDataItem[], radius: number): AreaClusterGroup[] {
  if (radius <= 0) return items.map(it => ({
    items: [it], centroid: it.centroid,
    bounds: [it.centroid, it.centroid] as L.LatLngBoundsLiteral,
  }))

  const sorted = [...items].sort((a, b) => b.span - a.span) // largest first
  const used = new Set<number>()
  const groups: AreaClusterGroup[] = []

  for (let i = 0; i < sorted.length; i++) {
    if (used.has(i)) continue
    used.add(i)
    const members = [sorted[i]]

    for (let j = i + 1; j < sorted.length; j++) {
      if (used.has(j)) continue
      const dLat = sorted[i].centroid[0] - sorted[j].centroid[0]
      const dLng = sorted[i].centroid[1] - sorted[j].centroid[1]
      if (Math.sqrt(dLat * dLat + dLng * dLng) <= radius) {
        members.push(sorted[j])
        used.add(j)
      }
    }

    let sLat = 0, sLng = 0
    let mnLat = Infinity, mxLat = -Infinity, mnLng = Infinity, mxLng = -Infinity
    for (const m of members) {
      sLat += m.centroid[0]; sLng += m.centroid[1]
      if (m.centroid[0] < mnLat) mnLat = m.centroid[0]
      if (m.centroid[0] > mxLat) mxLat = m.centroid[0]
      if (m.centroid[1] < mnLng) mnLng = m.centroid[1]
      if (m.centroid[1] > mxLng) mxLng = m.centroid[1]
    }

    groups.push({
      items: members,
      centroid: [sLat / members.length, sLng / members.length],
      bounds: [[mnLat - 0.005, mnLng - 0.005], [mxLat + 0.005, mxLng + 0.005]],
    })
  }
  return groups
}

// Aggregate a metric across a cluster
function aggregateMetric(items: AreaDataItem[], metric: AreaMetric): { value: string; color: string } {
  const areas = items.map(i => i.area)
  const none = { value: '-', color: '#64748b' }

  switch (metric) {
    case 'avgPrice': {
      const vals = areas.map(a => a.averagePrice).filter((v): v is number => v != null && v > 0)
      if (!vals.length) return none
      const avg = vals.reduce((s, v) => s + v, 0) / vals.length
      return { value: formatMetricValue({ averagePrice: avg } as DubaiArea, 'avgPrice'), color: '#334155' }
    }
    case 'capitalGrowth': {
      const vals = areas.map(a => a.capitalAppreciation).filter((v): v is number => v != null)
      if (!vals.length) return none
      const avg = vals.reduce((s, v) => s + v, 0) / vals.length
      const color = avg >= 0 ? '#059669' : '#e11d48'
      return { value: formatMetricValue({ capitalAppreciation: avg } as DubaiArea, 'capitalGrowth'), color }
    }
    case 'salesVolume': {
      const vals = areas.map(a => a.salesVolume).filter((v): v is number => v != null && v > 0)
      if (!vals.length) return none
      const total = vals.reduce((s, v) => s + v, 0)
      return { value: formatMetricValue({ salesVolume: total } as DubaiArea, 'salesVolume'), color: '#334155' }
    }
    case 'rentalYield': {
      const vals = areas.map(a => a.rentalYield).filter((v): v is number => v != null && v > 0)
      if (!vals.length) return none
      const avg = vals.reduce((s, v) => s + v, 0) / vals.length
      return { value: formatMetricValue({ rentalYield: avg } as DubaiArea, 'rentalYield'), color: '#334155' }
    }
    default: return none
  }
}

// Cluster summary pin icon
function createClusterPinIcon(count: number, metricLabel: string, metricColor: string): L.DivIcon {
  const hasMetric = metricLabel && metricLabel !== '-'
  return L.divIcon({
    html: `
      <div style="
        position: absolute;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        pointer-events: auto;
        cursor: pointer;
        animation: areaFadeIn 0.3s ease-out;
      ">
        <div style="
          display: inline-flex;
          align-items: center;
          gap: 5px;
          background: rgba(255,255,255,0.92);
          backdrop-filter: blur(8px);
          border-radius: 16px;
          padding: 4px 10px;
          white-space: nowrap;
          border: 1px solid rgba(148,163,184,0.3);
          box-shadow: 0 1px 4px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04);
        ">
          <span style="
            font-size: 10px;
            font-weight: 600;
            color: #94a3b8;
            line-height: 1;
          ">${count} areas</span>
          ${hasMetric ? `
            <span style="width:1px;height:12px;background:#e2e8f0;flex-shrink:0;"></span>
            <span style="
              font-size: 11px;
              font-weight: 700;
              color: ${metricColor};
              line-height: 1;
              letter-spacing: -0.01em;
            ">${metricLabel}</span>
          ` : ''}
        </div>
      </div>
    `,
    className: 'area-cluster-badge',
    iconSize: L.point(0, 0),
    iconAnchor: [0, 0],
  })
}

// Format metric value for display on labels
function formatMetricValue(area: DubaiArea, metric: AreaMetric): string {
  switch (metric) {
    case 'avgPrice': {
      const v = area.averagePrice
      if (v === undefined || v === null) return '-'
      if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M AED`
      if (v >= 1000) return `${(v / 1000).toFixed(0)}K AED`
      return `${v} AED`
    }
    case 'capitalGrowth': {
      const v = area.capitalAppreciation
      if (v === undefined || v === null) return '-'
      return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`
    }
    case 'salesVolume': {
      const v = area.salesVolume
      if (v === undefined || v === null) return '-'
      if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M`
      if (v >= 1000) return `${(v / 1000).toFixed(0)}K`
      return v.toString()
    }
    case 'rentalYield': {
      const v = area.rentalYield
      if (v === undefined || v === null) return '-'
      return `${v.toFixed(1)}%`
    }
    default:
      return ''
  }
}

// Get color class for metric
function getMetricColor(area: DubaiArea, metric: AreaMetric): string {
  if (metric === 'capitalGrowth' && area.capitalAppreciation !== undefined && area.capitalAppreciation !== null) {
    return area.capitalAppreciation >= 0 ? '#059669' : '#e11d48'
  }
  return '#334155'
}

// Helper function to format price in short form (K, M)
const formatPriceShort = (price: number): string => {
  if (price >= 1000000) {
    const millions = price / 1000000
    return `${millions % 1 === 0 ? millions : millions.toFixed(1)}M`
  } else if (price >= 1000) {
    const thousands = price / 1000
    return `${thousands % 1 === 0 ? thousands : thousands.toFixed(1)}K`
  }
  return price.toString()
}

// Create custom cluster icon (blue-900 style) with animation
const createClusterIcon = (cluster: any) => {
  const { count, price_range } = cluster

  const priceRange = price_range.min && price_range.max
    ? `${formatPriceShort(price_range.min)} - ${formatPriceShort(price_range.max)}`
    : 'POA'

  return L.divIcon({
    html: `
      <style>
        @keyframes pinDrop {
          0% {
            transform: translateY(-100px) scale(0.5);
            opacity: 0;
          }
          50% {
            transform: translateY(5px) scale(1.05);
          }
          70% {
            transform: translateY(-3px) scale(0.95);
          }
          100% {
            transform: translateY(0) scale(1);
            opacity: 1;
          }
        }
        @keyframes pulse {
          0%, 100% {
            transform: scale(1);
            opacity: 0.2;
          }
          50% {
            transform: scale(1.2);
            opacity: 0.3;
          }
        }
        .pin-animate {
          animation: pinDrop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }
        .pin-pulse {
          animation: pulse 2s ease-in-out infinite;
        }
      </style>
      <div class="relative inline-flex items-center justify-center pin-animate">
        <div class="absolute inset-0 bg-blue-900 opacity-20 rounded-full blur-md pin-pulse"></div>
        <div class="relative hover:scale-110 transition-all">
          <div class="bg-blue-900 text-white rounded-full px-3 py-1.5 shadow-xl border border-blue-700 cursor-pointer">
            <div class="flex items-center gap-1.5 whitespace-nowrap">
              <span class="text-sm font-bold">${count}</span>
              <span class="text-blue-300 text-xs">|</span>
              <span class="text-xs font-medium">${priceRange}</span>
            </div>
          </div>
          <!-- Small arrow pointing down -->
          <div class="absolute left-1/2 -translate-x-1/2" style="
            bottom: -5px;
            width: 0;
            height: 0;
            border-left: 5px solid transparent;
            border-right: 5px solid transparent;
            border-top: 6px solid #1e3a8a;
            filter: drop-shadow(0 1px 2px rgba(0,0,0,0.3));
          "></div>
        </div>
      </div>
    `,
    className: 'custom-cluster-icon',
    iconSize: L.point(120, 40, true),
    iconAnchor: [60, 40],
  })
}

interface MapViewClusteredProps {
  clusters: any[]
  onBoundsChange?: (bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number }, zoom: number) => void
  onClusterClick?: (cluster: any) => void
  onAreaClick?: (area: DubaiArea) => void
  areaMetric?: AreaMetric
  dubaiAreas?: DubaiArea[]
  dubaiLandmarks?: DubaiLandmark[]
  showDubaiLayer?: boolean
}

interface MapControllerProps {
  clusters: any[]
  onBoundsChange?: (bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number }, zoom: number) => void
}

function MapController({ onBoundsChange }: MapControllerProps) {
  const map = useMap()

  // Listen for map movement to update bounds with throttling
  useEffect(() => {
    if (!onBoundsChange) return

    let timeoutId: number | null = null

    const handleMoveEnd = () => {
      // Clear any pending timeout
      if (timeoutId) {
        clearTimeout(timeoutId)
      }

      // Throttle the bounds update to reduce API calls
      timeoutId = setTimeout(() => {
        const bounds = map.getBounds()
        const zoom = map.getZoom()
        onBoundsChange({
          minLat: bounds.getSouth(),
          minLng: bounds.getWest(),
          maxLat: bounds.getNorth(),
          maxLng: bounds.getEast(),
        }, zoom)
      }, 200) // Wait 200ms after user stops moving
    }

    map.on('moveend', handleMoveEnd)
    map.on('zoomend', handleMoveEnd)

    // Initial call after event listeners are set up
    setTimeout(() => {
      const bounds = map.getBounds()
      const zoom = map.getZoom()
      onBoundsChange({
        minLat: bounds.getSouth(),
        minLng: bounds.getWest(),
        maxLat: bounds.getNorth(),
        maxLng: bounds.getEast(),
      }, zoom)
    }, 100)

    return () => {
      if (timeoutId) clearTimeout(timeoutId)
      map.off('moveend', handleMoveEnd)
      map.off('zoomend', handleMoveEnd)
    }
  }, [map]) // Remove onBoundsChange from dependencies to prevent infinite loop

  return null
}

// Memoized Cluster Marker component - only re-renders if cluster data changes
interface ClusterMarkerProps {
  cluster: any
  onClusterClick?: (cluster: any) => void
}

const ClusterMarker = memo(({ cluster, onClusterClick }: ClusterMarkerProps) => {
  // Cache icon creation - only recreate if cluster data actually changes
  const icon = useMemo(() => createClusterIcon(cluster), [
    cluster.count,
    cluster.price_range?.min,
    cluster.price_range?.max,
  ])

  const position: [number, number] = useMemo(() => [
    cluster.center.lat,
    cluster.center.lng
  ], [cluster.center.lat, cluster.center.lng])

  return (
    <Marker
      position={position}
      icon={icon}
      eventHandlers={{
        click: (e) => {
          e.target.closePopup()
          if (onClusterClick) {
            onClusterClick(cluster)
          }
        }
      }}
    />
  )
}, (prevProps, nextProps) => {
  // Custom comparison: only re-render if actual data changes
  const prev = prevProps.cluster
  const next = nextProps.cluster

  return (
    prev.cluster_id === next.cluster_id &&
    prev.count === next.count &&
    prev.price_range?.min === next.price_range?.min &&
    prev.price_range?.max === next.price_range?.max &&
    prev.center.lat === next.center.lat &&
    prev.center.lng === next.center.lng
  )
})

// Memoized polygon — prevents re-render when only cluster data changes
const AreaPolygon = memo(function AreaPolygon({
  area,
  onAreaClick,
}: {
  area: DubaiArea
  onAreaClick?: (area: DubaiArea) => void
}) {
  const coordinates = useMemo(() => {
    if (area.boundary?.type !== 'Polygon') return []
    return (area.boundary as any).coordinates[0].map(
      ([lng, lat]: [number, number]) => [lat, lng] as [number, number]
    )
  }, [area.boundary])

  const pathOptions = useMemo(() => ({
    color: area.color,
    fillColor: area.color,
    fillOpacity: area.opacity * 0.6,
    weight: 3,
    opacity: 0.8,
    dashArray: '5, 10',
    lineCap: 'round' as const,
    lineJoin: 'round' as const,
  }), [area.color, area.opacity])

  const eventHandlers = useMemo(() => ({
    mouseover: (e: any) => {
      e.target.setStyle({
        weight: 4,
        fillOpacity: area.opacity * 1.2,
        dashArray: '10, 5',
      })
    },
    mouseout: (e: any) => {
      e.target.setStyle({
        weight: 3,
        fillOpacity: area.opacity * 0.6,
        dashArray: '5, 10',
      })
    },
    click: () => { if (onAreaClick) onAreaClick(area) },
  }), [area, onAreaClick])

  if (coordinates.length === 0) return null

  return (
    <Polygon
      positions={coordinates}
      pathOptions={pathOptions}
      eventHandlers={eventHandlers}
    />
  )
})

// Area name — bare text that blends into the polygon block
function createAreaNameIcon(area: DubaiArea): L.DivIcon {
  return L.divIcon({
    html: `
      <div style="
        position: absolute;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        pointer-events: none;
        white-space: nowrap;
        text-align: center;
        animation: areaFadeIn 0.3s ease-out;
      ">
        <div style="
          font-size: 12px;
          font-weight: 600;
          color: ${area.color};
          opacity: 0.7;
          text-shadow: 0 0 4px rgba(255,255,255,0.8), 0 0 8px rgba(255,255,255,0.5);
          letter-spacing: 0.03em;
          user-select: none;
        ">${area.name}</div>
      </div>
    `,
    className: 'area-name-icon',
    iconSize: L.point(0, 0),
    iconAnchor: [0, 0],
  })
}

// Metric pin — polished pin only shown when a metric is selected
function createMetricPinIcon(area: DubaiArea, metric: AreaMetric): L.DivIcon | null {
  const metricValue = formatMetricValue(area, metric)
  if (!metricValue || metricValue === '-') return null

  const metricColor = getMetricColor(area, metric)

  return L.divIcon({
    html: `
      <div style="
        position: absolute;
        left: 50%;
        top: 12px;
        transform: translateX(-50%);
        pointer-events: auto;
        cursor: pointer;
        animation: areaFadeIn 0.3s ease-out;
      ">
        <div style="
          display: inline-flex;
          align-items: center;
          background: rgba(255,255,255,0.92);
          backdrop-filter: blur(8px);
          border-radius: 16px;
          padding: 4px 10px;
          white-space: nowrap;
          border: 1px solid rgba(148,163,184,0.3);
          box-shadow: 0 1px 4px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04);
        ">
          <span style="
            font-size: 11px;
            font-weight: 700;
            color: ${metricColor};
            line-height: 1;
            letter-spacing: -0.01em;
          ">${metricValue}</span>
        </div>
      </div>
    `,
    className: 'area-metric-badge',
    iconSize: L.point(0, 0),
    iconAnchor: [0, 0],
  })
}

// ── Zoom-aware area labels + clustered metric pins ────────────────────────────

function ZoomAwareAreaLabels({
  dubaiAreas,
  areaMetric,
  onAreaClick,
}: {
  dubaiAreas: DubaiArea[]
  areaMetric: AreaMetric
  onAreaClick?: (area: DubaiArea) => void
}) {
  const map = useMap()
  const [zoom, setZoom] = useState(map.getZoom())
  const zoomTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Inject fade-in keyframes once (applied via inline style on inner div, NOT on Leaflet wrapper)
  useEffect(() => {
    const id = 'area-fade-style'
    if (!document.getElementById(id)) {
      const style = document.createElement('style')
      style.id = id
      style.textContent = `@keyframes areaFadeIn { from { opacity: 0 } to { opacity: 1 } }`
      document.head.appendChild(style)
    }
  }, [])

  // Zoom tracking — cancel pending updates on zoomstart to avoid DOM changes during animation
  useEffect(() => {
    const onZoomStart = () => {
      if (zoomTimerRef.current) {
        clearTimeout(zoomTimerRef.current)
        zoomTimerRef.current = null
      }
    }
    const onZoomEnd = () => {
      if (zoomTimerRef.current) clearTimeout(zoomTimerRef.current)
      zoomTimerRef.current = setTimeout(() => setZoom(map.getZoom()), 80)
    }
    map.on('zoomstart', onZoomStart)
    map.on('zoomend', onZoomEnd)
    return () => {
      map.off('zoomstart', onZoomStart)
      map.off('zoomend', onZoomEnd)
      if (zoomTimerRef.current) clearTimeout(zoomTimerRef.current)
    }
  }, [map])

  // Pre-compute centroid + span once
  const areaData = useMemo<AreaDataItem[]>(() => {
    return dubaiAreas
      .filter((area) => {
        if (!area.boundary || (area.boundary as any).type !== 'Polygon') return false
        const coords = (area.boundary as any).coordinates?.[0]
        return coords && coords.length > 0
      })
      .map((area) => {
        const coords: [number, number][] = (area.boundary as any).coordinates[0].map(
          ([lng, lat]: [number, number]) => [lat, lng] as [number, number]
        )
        return { area, centroid: getCentroid(coords), span: getPolygonSpan(coords) }
      })
  }, [dubaiAreas])

  // Cache icon instances — only recreated when source data changes, NOT on zoom
  const nameIconCache = useMemo(() => {
    const cache = new Map<string, L.DivIcon>()
    for (const { area } of areaData) {
      cache.set(area.id, createAreaNameIcon(area))
    }
    return cache
  }, [areaData])

  const metricIconCache = useMemo(() => {
    const cache = new Map<string, L.DivIcon | null>()
    if (areaMetric === 'none') return cache
    for (const { area } of areaData) {
      cache.set(area.id, createMetricPinIcon(area, areaMetric))
    }
    return cache
  }, [areaData, areaMetric])

  const minSpan = getMinSpanForZoom(zoom)
  const mergeRadius = getMergeRadius(zoom)
  const isIndividualMode = mergeRadius <= 0 // zoom >= 13

  // Names — filter only, reuse cached icons (stable references prevent DOM thrashing)
  const visibleNames = useMemo(() => {
    return areaData
      .filter(({ span }) => span >= minSpan)
      .map(({ area, centroid }) => ({ area, centroid, icon: nameIconCache.get(area.id)! }))
  }, [areaData, minSpan, nameIconCache])

  // Individual metric pins — filter only, reuse cached icons
  const individualPins = useMemo(() => {
    if (!isIndividualMode || areaMetric === 'none') return []
    return areaData
      .filter(({ span }) => span >= minSpan)
      .map(({ area, centroid }) => {
        const icon = metricIconCache.get(area.id)
        if (!icon) return null
        return { area, centroid, icon }
      })
      .filter(Boolean) as { area: DubaiArea; centroid: [number, number]; icon: L.DivIcon }[]
  }, [areaData, areaMetric, isIndividualMode, minSpan, metricIconCache])

  // Clustered metric pins — at zoom < 13 when metric selected
  const clusterPins = useMemo(() => {
    if (isIndividualMode || areaMetric === 'none') return []
    const groups = clusterAreas(areaData, mergeRadius)
    return groups.map((group) => {
      const { value, color } = aggregateMetric(group.items, areaMetric)
      if (value === '-') return null
      return {
        key: group.items.map(i => i.area.id).join('-'),
        centroid: group.centroid,
        bounds: group.bounds,
        icon: createClusterPinIcon(group.items.length, value, color),
      }
    }).filter(Boolean) as { key: string; centroid: [number, number]; bounds: L.LatLngBoundsLiteral; icon: L.DivIcon }[]
  }, [areaData, areaMetric, isIndividualMode, mergeRadius])

  return (
    <>
      {/* Area names — progressive by polygon size */}
      {visibleNames.map(({ area, centroid, icon }) => (
        <Marker key={`name-${area.id}`} position={centroid} icon={icon} interactive={false} />
      ))}

      {/* Individual metric pins — zoom >= 13 */}
      {individualPins.map(({ area, centroid, icon }) => (
        <Marker
          key={`metric-${area.id}`}
          position={centroid}
          icon={icon}
          zIndexOffset={1000}
          eventHandlers={{ click: () => { if (onAreaClick) onAreaClick(area) } }}
        />
      ))}

      {/* Clustered summary pins — zoom < 13 → click to zoom in */}
      {clusterPins.map(({ key, centroid, bounds, icon }) => (
        <Marker
          key={`cluster-${key}`}
          position={centroid}
          icon={icon}
          zIndexOffset={1000}
          eventHandlers={{
            click: () => { map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 }) },
          }}
        />
      ))}
    </>
  )
}

// ── Zoom-aware landmarks — hide photo pins when zoomed out ────────────────────

function ZoomAwareLandmarks({
  getImageForLandmark,
  landmarkIcons,
}: {
  getImageForLandmark: (l: DubaiLandmark) => string
  landmarkIcons: { landmark: DubaiLandmark; icon: L.DivIcon; position: [number, number] }[]
}) {
  const map = useMap()
  const [zoom, setZoom] = useState(map.getZoom())
  const zoomTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const onZoomStart = () => {
      if (zoomTimerRef.current) {
        clearTimeout(zoomTimerRef.current)
        zoomTimerRef.current = null
      }
    }
    const onZoomEnd = () => {
      if (zoomTimerRef.current) clearTimeout(zoomTimerRef.current)
      zoomTimerRef.current = setTimeout(() => setZoom(map.getZoom()), 80)
    }
    map.on('zoomstart', onZoomStart)
    map.on('zoomend', onZoomEnd)
    return () => {
      map.off('zoomstart', onZoomStart)
      map.off('zoomend', onZoomEnd)
      if (zoomTimerRef.current) clearTimeout(zoomTimerRef.current)
    }
  }, [map])

  // Progressive: large landmarks at zoom 11+, all at 12+, none below 11
  const visible = useMemo(() => {
    if (zoom >= 12) return landmarkIcons
    if (zoom >= 11) return landmarkIcons.filter(({ landmark }) => landmark.size === 'large')
    return []
  }, [landmarkIcons, zoom])

  return (
    <>
      {visible.map(({ landmark, icon, position }) => (
        <Marker key={landmark.id} position={position} icon={icon}>
          <Popup maxWidth={400} autoPan={false}>
            <div className="p-0 min-w-[380px] bg-white">
              <div className="w-full h-56 overflow-hidden relative">
                <img
                  src={getImageForLandmark(landmark)}
                  alt={landmark.name}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                    (e.target as HTMLImageElement).parentElement!.style.background = `linear-gradient(135deg, ${landmark.color}40, ${landmark.color}80)`;
                  }}
                />
                {landmark.landmarkType && (
                  <div className="absolute top-4 right-4">
                    <span className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-medium backdrop-blur-md bg-white/90 text-slate-700 border border-white/40 shadow-lg">
                      {landmark.landmarkType}
                    </span>
                  </div>
                )}
              </div>
              <div className="p-6">
                <div className="mb-4">
                  <h3 className="font-bold text-2xl text-slate-900 mb-1">{landmark.name}</h3>
                  {landmark.nameAr && <p className="text-sm text-slate-500 font-arabic">{landmark.nameAr}</p>}
                </div>
                {landmark.description && (
                  <p className="text-sm text-slate-600 mb-4 leading-relaxed">{landmark.description}</p>
                )}
                {(landmark.yearBuilt || landmark.websiteUrl) && (
                  <div className="flex flex-wrap gap-3 pt-4 border-t border-slate-100">
                    {landmark.yearBuilt && (
                      <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-lg border border-slate-200">
                        <span className="text-xs text-slate-500">Built</span>
                        <span className="text-sm font-semibold text-slate-900">{landmark.yearBuilt}</span>
                      </div>
                    )}
                    {landmark.websiteUrl && (
                      <a href={landmark.websiteUrl} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-lg border border-slate-200 hover:border-slate-300 hover:bg-slate-100 transition-colors text-sm font-medium text-slate-700">
                        <span>Visit Website</span>
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    )}
                  </div>
                )}
              </div>
            </div>
          </Popup>
        </Marker>
      ))}
    </>
  )
}

function MapViewClustered({ clusters, onBoundsChange, onClusterClick, onAreaClick, areaMetric = 'none', dubaiAreas = [], dubaiLandmarks = [], showDubaiLayer = false }: MapViewClusteredProps) {

  // 地标照片映射 - 优先使用数据库中的图片，否则使用默认图片
  const getImageForLandmark = (landmark: DubaiLandmark): string => {
    // 1. 如果数据库有图片URL，直接使用
    if (landmark.imageUrl) {
      return landmark.imageUrl
    }

    // 2. 否则使用地标名称映射
    const landmarkImages: Record<string, string> = {
      'Burj Khalifa': 'https://images.unsplash.com/photo-1582672060674-bc2bd808a8b5?w=400&h=400&fit=crop',
      'Burj Al Arab': 'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?w=400&h=400&fit=crop',
      'Dubai Mall': 'https://images.unsplash.com/photo-1567449303183-3e2e3e8ae753?w=400&h=400&fit=crop',
      'Dubai Marina': 'https://images.unsplash.com/photo-1518684079-3c830dcef090?w=400&h=400&fit=crop',
      'Palm Jumeirah': 'https://images.unsplash.com/photo-1580674285054-bed31e145f59?w=400&h=400&fit=crop',
      'Dubai Creek': 'https://images.unsplash.com/photo-1546412414-e1885259563a?w=400&h=400&fit=crop',
      'Gold Souk': 'https://images.unsplash.com/photo-1610375461246-83df859d849d?w=400&h=400&fit=crop',
      'Jumeirah Beach': 'https://images.unsplash.com/photo-1559827260-dc66d52bef19?w=400&h=400&fit=crop',
    }

    if (landmarkImages[landmark.name]) {
      return landmarkImages[landmark.name]
    }

    // 3. 最后根据类型返回通用照片
    const typeImages: Record<string, string> = {
      'tower': 'https://images.unsplash.com/photo-1582672060674-bc2bd808a8b5?w=400&h=400&fit=crop',
      'building': 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=400&h=400&fit=crop',
      'mall': 'https://images.unsplash.com/photo-1555529669-e69e7aa0ba9a?w=400&h=400&fit=crop',
      'beach': 'https://images.unsplash.com/photo-1559827260-dc66d52bef19?w=400&h=400&fit=crop',
      'mosque': 'https://images.unsplash.com/photo-1591604129939-f1efa4d9f7fa?w=400&h=400&fit=crop',
      'hotel': 'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=400&h=400&fit=crop',
      'park': 'https://images.unsplash.com/photo-1585320806297-9794b3e4eeae?w=400&h=400&fit=crop',
      'default': 'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?w=400&h=400&fit=crop'
    }

    return typeImages[landmark.landmarkType] || typeImages.default
  }

  // Memoize Dubai landmark icons - 大尺寸照片pin设计
  const landmarkIcons = useMemo(() => {
    if (!Array.isArray(dubaiLandmarks)) return []
    return dubaiLandmarks.map((landmark) => {
      const sizeMap = { small: [70, 90], medium: [80, 100], large: [90, 110] }
      const size = sizeMap[landmark.size] || [80, 100]
      const imageUrl = getImageForLandmark(landmark)

      return {
        landmark,
        icon: L.divIcon({
          html: `
            <style>
              @keyframes pinDrop {
                0% {
                  transform: translateY(-100px) scale(0.5);
                  opacity: 0;
                }
                60% {
                  transform: translateY(5px) scale(1.05);
                }
                80% {
                  transform: translateY(-2px) scale(0.95);
                }
                100% {
                  transform: translateY(0) scale(1);
                  opacity: 1;
                }
              }
              .photo-pin-${landmark.id} {
                animation: pinDrop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
              }
              .photo-pin-${landmark.id}:hover {
                transform: scale(1.1);
                transition: transform 0.2s ease;
              }
            </style>
            <div class="photo-pin-${landmark.id}" style="width: ${size[0]}px; height: ${size[1]}px; position: relative;">
              <!-- 底部阴影 -->
              <div style="
                position: absolute;
                bottom: 0;
                left: 50%;
                transform: translateX(-50%);
                width: ${size[0] * 0.5}px;
                height: ${size[0] * 0.2}px;
                background: rgba(0, 0, 0, 0.35);
                border-radius: 50%;
                filter: blur(4px);
              "></div>

              <!-- Pin SVG - 正确的水滴方向（尖端朝下） -->
              <svg width="${size[0]}" height="${size[1]}" viewBox="0 0 80 100" style="filter: drop-shadow(0 6px 12px rgba(0,0,0,0.3));">
                <defs>
                  <!-- 照片裁剪路径 -->
                  <clipPath id="pin-clip-${landmark.id}">
                    <circle cx="40" cy="35" r="28"/>
                  </clipPath>

                  <!-- 渐变边框 -->
                  <linearGradient id="pin-border-${landmark.id}" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" style="stop-color:#ffffff;stop-opacity:1" />
                    <stop offset="100%" style="stop-color:#e0e0e0;stop-opacity:1" />
                  </linearGradient>
                </defs>

                <!-- 外部白色边框 -->
                <path d="M40 95 L40 95 C40 95, 40 70, 40 70 C40 70, 20 70, 12 58 C4 46, 4 35, 12 23 C20 11, 32 5, 40 5 C48 5, 60 11, 68 23 C76 35, 76 46, 68 58 C60 70, 40 70, 40 70 Z"
                      fill="url(#pin-border-${landmark.id})"
                      stroke="#d0d0d0"
                      stroke-width="1"/>

                <!-- 照片区域 -->
                <image
                  href="${imageUrl}"
                  x="12"
                  y="7"
                  width="56"
                  height="56"
                  clip-path="url(#pin-clip-${landmark.id})"
                  preserveAspectRatio="xMidYMid slice"
                />

                <!-- 内圈边框 -->
                <circle cx="40" cy="35" r="28"
                        fill="none"
                        stroke="white"
                        stroke-width="3"
                        opacity="0.9"/>
              </svg>
            </div>
          `,
          className: 'custom-landmark-icon',
          iconSize: L.point(size[0], size[1]),
          iconAnchor: [size[0] / 2, size[1] - 2],
        }),
        position: [landmark.location.lat, landmark.location.lng] as [number, number]
      }
    })
  }, [dubaiLandmarks])

  return (
    <MapContainer
      center={[25.0961, 55.1561]}
      zoom={11}
      className="h-full w-full rounded-lg overflow-hidden shadow-lg"
    >
      {/* 使用 Carto 的英文地图瓦片 - 清晰现代的设计 */}
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
        subdomains="abcd"
        maxZoom={20}
      />
      <MapController clusters={clusters} onBoundsChange={onBoundsChange} />

      {/* Render Dubai areas as polygons (memoized — won't re-render on cluster data changes) */}
      {showDubaiLayer && Array.isArray(dubaiAreas) && dubaiAreas.map((area) => (
        <AreaPolygon key={area.id} area={area} onAreaClick={onAreaClick} />
      ))}

      {/* Zoom-aware area name text + metric pins */}
      {showDubaiLayer && (
        <ZoomAwareAreaLabels
          dubaiAreas={dubaiAreas}
          areaMetric={areaMetric}
          onAreaClick={onAreaClick}
        />
      )}

      {/* Render Dubai landmarks as markers (zoom-aware) */}
      {showDubaiLayer && (
        <ZoomAwareLandmarks
          getImageForLandmark={getImageForLandmark}
          landmarkIcons={landmarkIcons}
        />
      )}

      {/* Render cluster markers - memoized to prevent unnecessary re-renders */}
      {clusters.map((cluster) => (
        <ClusterMarker
          key={cluster.cluster_id}
          cluster={cluster}
          onClusterClick={onClusterClick}
        />
      ))}
    </MapContainer>
  )
}

// Export memoized component to prevent unnecessary re-renders
export default memo(MapViewClustered)
