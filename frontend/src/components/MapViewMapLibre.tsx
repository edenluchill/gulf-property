/**
 * MapLibre GL JS 地图组件 - 简洁高效版
 */

import { useState, useRef, useMemo, useCallback, memo, useEffect } from 'react'
import Map, {
  Marker,
  Source,
  Layer,
  MapRef
} from 'react-map-gl/maplibre'
import { type MapLayerMouseEvent } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useTranslation } from 'react-i18next'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  Cross, GraduationCap, TrainFront, ShoppingBag, ShoppingCart,
  Utensils, Coffee, Landmark, CreditCard, TreePine, Building2,
  Hotel, Dumbbell, Umbrella, Film, Fuel, Church,
  Shield, Flame, Mail, Flag, Pill, Stethoscope, School,
  TramFront, Cable
} from 'lucide-react'
import { DubaiArea, DubaiLandmark } from '../types'
import { Poi } from '../hooks/useDubaiPois'
import { TransportGeoJSON } from '../lib/api'

// 使用 CARTO 无标签风格 (area 自己有名字，不需要地图标签)
const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/voyager-nolabels-gl-style/style.json'

// Category-specific colors and icons
const CATEGORY_CONFIG: Record<string, { color: string; Icon: typeof Cross }> = {
  // Healthcare - teal
  hospital: { color: '#0d9488', Icon: Cross },
  clinic: { color: '#0d9488', Icon: Stethoscope },
  pharmacy: { color: '#0d9488', Icon: Pill },
  // Education - blue
  school: { color: '#2563eb', Icon: School },
  university: { color: '#2563eb', Icon: GraduationCap },
  // Shopping - pink
  mall: { color: '#db2777', Icon: ShoppingBag },
  supermarket: { color: '#db2777', Icon: ShoppingCart },
  // Dining - amber
  restaurant: { color: '#d97706', Icon: Utensils },
  cafe: { color: '#d97706', Icon: Coffee },
  // Finance - emerald
  bank: { color: '#059669', Icon: Landmark },
  atm: { color: '#059669', Icon: CreditCard },
  // Leisure - violet
  hotel: { color: '#7c3aed', Icon: Hotel },
  park: { color: '#16a34a', Icon: TreePine },
  gym: { color: '#7c3aed', Icon: Dumbbell },
  beach: { color: '#0ea5e9', Icon: Umbrella },
  cinema: { color: '#7c3aed', Icon: Film },
  // Services - various
  gas_station: { color: '#475569', Icon: Fuel },
  mosque: { color: '#475569', Icon: Church },
  church: { color: '#475569', Icon: Church },
  police: { color: '#1e40af', Icon: Shield },
  fire_station: { color: '#dc2626', Icon: Flame },
  post_office: { color: '#475569', Icon: Mail },
  embassy: { color: '#475569', Icon: Flag },
}

// Transport line colors and icons (nicer colors than official RTA)
const TRANSPORT_LINE_CONFIG: Record<string, { color: string; Icon: typeof Cross }> = {
  red: { color: '#ef4444', Icon: TrainFront },       // Red Line - nice red
  green: { color: '#22c55e', Icon: TrainFront },     // Green Line - nice green
  blue: { color: '#3b82f6', Icon: TrainFront },      // Blue Line - nice blue (future)
  tram: { color: '#f97316', Icon: TramFront },       // Tram - orange
  palm_monorail: { color: '#a855f7', Icon: Cable },  // Palm Monorail - purple
}

// Generate POI icon using Lucide SVG + Canvas
async function generatePoiIcon(color: string, Icon: typeof Cross, size = 64): Promise<ImageData> {
  return new Promise((resolve) => {
    const iconSize = size * 0.55  // Bigger icon inside circle
    const offset = (size - iconSize) / 2

    // Render Lucide icon to SVG string
    const fullIconSvg = renderToStaticMarkup(
      createElement(Icon, {
        size: 24,  // Lucide native size
        stroke: '#ffffff',
        strokeWidth: 2.5,
        fill: 'none'
      })
    )
    // Extract the inner paths from the Lucide SVG (remove outer <svg> tags)
    const innerContent = fullIconSvg
      .replace(/<svg[^>]*>/, '')
      .replace(/<\/svg>/, '')
      // Ensure all paths have white stroke and no fill
      .replace(/stroke="[^"]*"/g, 'stroke="#ffffff"')
      .replace(/fill="[^"]*"/g, 'fill="none"')

    // Create full SVG with circle background + icon
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${size/2}" cy="${size/2}" r="${size/2 - 2}" fill="${color}" stroke="#ffffff" stroke-width="3"/>
      <g transform="translate(${offset}, ${offset})">
        <svg width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          ${innerContent}
        </svg>
      </g>
    </svg>`

    // Convert SVG to Image
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      resolve(ctx.getImageData(0, 0, size, size))
    }
    img.onerror = (e) => {
      console.error('Failed to load POI icon:', e)
      // Fallback: simple colored circle
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')!
      ctx.beginPath()
      ctx.arc(size/2, size/2, size/2 - 2, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.fill()
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 3
      ctx.stroke()
      resolve(ctx.getImageData(0, 0, size, size))
    }
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)))
  })
}

// Default config for unknown categories
const DEFAULT_CATEGORY_CONFIG = { color: '#475569', Icon: Building2 }

export type AreaMetric = 'none' | 'medianUnitPrice' | 'medianPriceSqft' | 'capitalGrowth' | 'transactionCount' | 'rentalYield'

// ============================================================================
// Helper Functions
// ============================================================================

function getCentroid(coords: [number, number][]): [number, number] {
  let lngSum = 0, latSum = 0
  for (const [lng, lat] of coords) {
    lngSum += lng
    latSum += lat
  }
  return [lngSum / coords.length, latSum / coords.length]
}

function getPolygonSpan(coords: [number, number][]): number {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity
  for (const [lng, lat] of coords) {
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
    if (lng < minLng) minLng = lng
    if (lng > maxLng) maxLng = lng
  }
  return Math.sqrt((maxLat - minLat) ** 2 + (maxLng - minLng) ** 2)
}

// 根据 span 计算该 area 应该在什么 zoom 级别开始显示
// 这样一旦显示，zoom in 时就不会消失
function getMinZoomForSpan(span: number): number {
  if (span >= 0.15) return 8    // 超大区域
  if (span >= 0.08) return 9    // 大区域
  if (span >= 0.04) return 10   // 中等区域
  if (span >= 0.02) return 11   // 小区域
  if (span >= 0.01) return 12   // 更小区域
  return 13                      // 最小区域
}

const formatPriceShort = (price: number): string => {
  if (price >= 1000000) return `${(price / 1000000).toFixed(1)}M`
  if (price >= 1000) return `${Math.round(price / 1000)}K`
  return price.toString()
}

// 格式化指标值
function formatMetricValue(area: DubaiArea, metric: AreaMetric): string {
  switch (metric) {
    case 'medianUnitPrice': {
      // Total median unit price in AED
      const v = area.medianUnitPrice
      if (v === undefined || v === null) return ''
      if (v >= 1000000) return `$${(v / 1000000).toFixed(1)}M`
      if (v >= 1000) return `$${Math.round(v / 1000)}K`
      return `$${v}`
    }
    case 'medianPriceSqft': {
      // medianPriceSqm converted to sqft (1 sqm = 10.764 sqft)
      const v = area.medianPriceSqm
      if (v === undefined || v === null) return ''
      const pricePerSqft = v / 10.764
      if (pricePerSqft >= 1000) return `$${(pricePerSqft / 1000).toFixed(1)}K`
      return `$${Math.round(pricePerSqft)}`
    }
    case 'capitalGrowth': {
      const v = area.capitalAppreciation
      if (v === undefined || v === null) return ''
      return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`
    }
    case 'transactionCount': {
      const v = area.transactionCount
      if (v === undefined || v === null) return ''
      if (v >= 1000) return `${(v / 1000).toFixed(1)}K`
      return `${v}`
    }
    case 'rentalYield': {
      const v = area.rentalYield
      if (v === undefined || v === null) return ''
      return `${v.toFixed(1)}%`
    }
    default:
      return ''
  }
}

// 获取指标的原始数值 (用于热力图计算)
function getMetricRawValue(area: DubaiArea, metric: AreaMetric): number | null {
  switch (metric) {
    case 'medianUnitPrice': return area.medianUnitPrice ?? null
    case 'medianPriceSqft': {
      const v = area.medianPriceSqm
      return v !== undefined && v !== null ? v / 10.764 : null
    }
    case 'capitalGrowth': return area.capitalAppreciation ?? null
    case 'transactionCount': return area.transactionCount ?? null
    case 'rentalYield': return area.rentalYield ?? null
    default: return null
  }
}

// 计算分位数
function calculatePercentiles(values: number[]): { p25: number; p50: number; p75: number } {
  if (values.length === 0) return { p25: 0, p50: 0, p75: 0 }
  const sorted = [...values].sort((a, b) => a - b)
  const p25 = sorted[Math.floor(sorted.length * 0.25)]
  const p50 = sorted[Math.floor(sorted.length * 0.50)]
  const p75 = sorted[Math.floor(sorted.length * 0.75)]
  return { p25, p50, p75 }
}

// 热力图颜色计算
// capitalGrowth: 绿色=正增长, 红色=负增长
// 其他指标: 用分位数 P25/P50/P75 分割
function getHeatmapColor(
  value: number | null,
  metric: AreaMetric,
  percentiles: { p25: number; p50: number; p75: number }
): string {
  if (value === null) return '#94a3b8' // 灰色表示无数据

  if (metric === 'capitalGrowth') {
    // 增长率: 绿色=正, 红色=负
    if (value >= 10) return '#059669'      // 深绿 (>10%)
    if (value >= 5) return '#10b981'       // 绿色 (5-10%)
    if (value >= 0) return '#6ee7b7'       // 浅绿 (0-5%)
    if (value >= -5) return '#fca5a5'      // 浅红 (-5-0%)
    if (value >= -10) return '#ef4444'     // 红色 (-10--5%)
    return '#dc2626'                        // 深红 (<-10%)
  }

  // 其他指标: 用分位数分割
  const { p25, p50, p75 } = percentiles

  if (value >= p75) return '#059669'       // 深绿 (top 25%, > P75)
  if (value >= p50) return '#10b981'       // 绿色 (P50-P75)
  if (value >= p25) return '#fbbf24'       // 黄色 (P25-P50)
  return '#ef4444'                          // 红色 (bottom 25%, < P25)
}

// ============================================================================
// Project Pin Marker - Premium teardrop style with thumbnail
// ============================================================================

import { MapPinProject } from '../lib/api'
import { getImageUrl } from '../lib/image-utils'

const ProjectPinMarker = memo(({ project, onClick }: { project: MapPinProject; onClick?: (p: MapPinProject) => void }) => {
  // Truncate project name for display
  const displayName = project.name.length > 18
    ? project.name.substring(0, 16) + '...'
    : project.name

  return (
    <Marker
      longitude={project.lng}
      latitude={project.lat}
      anchor="bottom"
      onClick={(e) => {
        e.originalEvent.stopPropagation()
        onClick?.(project)
      }}
    >
      <div
        className="cursor-pointer transition-all duration-200 hover:scale-110 hover:z-[100]"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.25))',
        }}
      >
        {/* Project name label - ABOVE pin */}
        <div
          style={{
            marginBottom: '4px',
            background: 'rgba(15, 23, 42, 0.9)',
            color: '#fff',
            borderRadius: '6px',
            padding: '3px 8px',
            fontSize: '11px',
            fontWeight: 600,
            whiteSpace: 'nowrap',
            maxWidth: '120px',
            textAlign: 'center',
            backdropFilter: 'blur(4px)',
          }}
        >
          {displayName}
        </div>

        {/* Teardrop pin with image */}
        <div
          style={{
            position: 'relative',
            width: '46px',
            height: '58px',
          }}
        >
          {/* Teardrop shape SVG background - premium dark gradient */}
          <svg
            viewBox="0 0 46 58"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
            }}
          >
            <defs>
              <linearGradient id={`pinGrad-${project.id}`} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#1e293b" />
                <stop offset="50%" stopColor="#334155" />
                <stop offset="100%" stopColor="#1e293b" />
              </linearGradient>
            </defs>
            {/* Teardrop path */}
            <path
              d="M23 0C10.3 0 0 10.3 0 23c0 8.5 6.5 17 13 23.5 3.5 3.5 7 7 10 11.5 3-4.5 6.5-8 10-11.5 6.5-6.5 13-15 13-23.5C46 10.3 35.7 0 23 0z"
              fill={`url(#pinGrad-${project.id})`}
              stroke="rgba(255,255,255,0.3)"
              strokeWidth="1.5"
            />
            {/* Inner highlight */}
            <path
              d="M23 3C12 3 3 12 3 23c0 7 5.5 14.5 11 20"
              fill="none"
              stroke="rgba(255,255,255,0.15)"
              strokeWidth="1"
              strokeLinecap="round"
            />
          </svg>

          {/* Circular image inside teardrop */}
          <div
            style={{
              position: 'absolute',
              top: '7px',
              left: '7px',
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              overflow: 'hidden',
              border: '2px solid rgba(255,255,255,0.8)',
              background: '#1e293b',
            }}
          >
            {project.image ? (
              <img
                src={getImageUrl(project.image, 'thumbnail')}
                alt={project.name}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                }}
                loading="lazy"
              />
            ) : (
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'linear-gradient(135deg, #334155 0%, #1e293b 100%)',
                }}
              >
                <Building2 style={{ width: '16px', height: '16px', color: 'rgba(255,255,255,0.7)' }} />
              </div>
            )}
          </div>
        </div>
      </div>
    </Marker>
  )
})

// ============================================================================
// Cluster Marker - 简洁版 (Legacy, kept for compatibility)
// ============================================================================

const ClusterMarker = memo(({ cluster, onClick }: { cluster: any; onClick?: (c: any) => void }) => {
  const { count, price_range, center } = cluster
  const priceText = price_range?.min && price_range?.max
    ? `${formatPriceShort(price_range.min)}-${formatPriceShort(price_range.max)}`
    : 'POA'

  return (
    <Marker
      longitude={center.lng}
      latitude={center.lat}
      anchor="bottom"
      onClick={(e) => {
        e.originalEvent.stopPropagation()
        onClick?.(cluster)
      }}
    >
      <div
        className="cursor-pointer transition-transform hover:scale-110"
        style={{
          background: 'linear-gradient(135deg, #1e40af 0%, #1e3a8a 100%)',
          color: 'white',
          borderRadius: '16px',
          padding: '6px 10px',
          fontSize: '12px',
          fontWeight: 600,
          boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
          whiteSpace: 'nowrap'
        }}
      >
        {count} | {priceText}
      </div>
    </Marker>
  )
})

// ============================================================================
// Main Component
// ============================================================================

// Transport station info for click handling
export interface TransportStation {
  id: string
  name: string
  nameAr?: string
  category: 'metro_stations' | 'tram_stations' | 'monorail_stations'
  color: string
  lng: number
  lat: number
  line?: string
  network?: string
  operator?: string
}

interface MapViewMapLibreProps {
  clusters?: any[]
  projects?: MapPinProject[]
  onBoundsChange?: (bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number }, zoom: number) => void
  onClusterClick?: (cluster: any) => void
  onProjectClick?: (project: MapPinProject) => void
  onAreaClick?: (area: DubaiArea) => void
  onPoiClick?: (poi: Poi) => void
  onStationClick?: (station: TransportStation) => void
  areaMetric?: AreaMetric
  dubaiAreas?: DubaiArea[]
  dubaiLandmarks?: DubaiLandmark[]
  pois?: Poi[]
  showDubaiLayer?: boolean
  showPois?: boolean
  flyToLocation?: { lat: number; lng: number; zoom?: number } | null
  transportGeoJSON?: TransportGeoJSON | null
  showTransport?: boolean
}

function MapViewMapLibre({
  clusters = [],
  projects = [],
  onBoundsChange,
  onClusterClick,
  onProjectClick,
  onAreaClick,
  onPoiClick,
  onStationClick,
  areaMetric = 'none',
  dubaiAreas = [],
  dubaiLandmarks: _dubaiLandmarks = [],
  pois = [],
  showDubaiLayer = false,
  showPois = false,
  flyToLocation = null,
  transportGeoJSON = null,
  showTransport = false
}: MapViewMapLibreProps) {
  const { i18n } = useTranslation()
  const mapRef = useRef<MapRef>(null)
  const [mapLoaded, setMapLoaded] = useState(false)
  const [hoveredAreaId, setHoveredAreaId] = useState<string | null>(null)
  const boundsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 地图初始视图
  const [viewState, setViewState] = useState({
    longitude: 55.089,
    latitude: 25.019,
    zoom: 10.115216007819594
  })

  // Fly to location when flyToLocation changes
  useEffect(() => {
    if (!flyToLocation || !mapRef.current || !mapLoaded) return

    const map = mapRef.current.getMap()
    if (!map) return

    map.flyTo({
      center: [flyToLocation.lng, flyToLocation.lat],
      zoom: flyToLocation.zoom ?? 14,
      duration: 1500,
      essential: true
    })
  }, [flyToLocation, mapLoaded])

  // 地图加载完成后再渲染 layers
  const handleMapLoad = useCallback(async () => {
    const map = mapRef.current?.getMap()
    if (!map) return

    // Generate and load POI icons for each category (using Lucide SVGs)
    const poiIconPromises = Object.entries(CATEGORY_CONFIG).map(async ([category, config]) => {
      const iconName = `poi-${category}`
      if (!map.hasImage(iconName)) {
        const imageData = await generatePoiIcon(config.color, config.Icon, 48)
        map.addImage(iconName, imageData, { pixelRatio: 2 })
      }
    })

    // Generate and load transport station icons
    const transportIconPromises = Object.entries(TRANSPORT_LINE_CONFIG).map(async ([line, config]) => {
      const iconName = `station-${line}`
      if (!map.hasImage(iconName)) {
        const imageData = await generatePoiIcon(config.color, config.Icon, 48)
        map.addImage(iconName, imageData, { pixelRatio: 2 })
      }
    })

    await Promise.all([...poiIconPromises, ...transportIconPromises])

    setMapLoaded(true)

    // 延迟触发 bounds change
    setTimeout(() => {
      if (mapRef.current && onBoundsChange) {
        const bounds = map.getBounds()
        onBoundsChange({
          minLat: bounds.getSouth(),
          minLng: bounds.getWest(),
          maxLat: bounds.getNorth(),
          maxLng: bounds.getEast(),
        }, map.getZoom())
      }
    }, 100)
  }, [onBoundsChange])

  // Bounds change handler (debounced)
  const handleMoveEnd = useCallback(() => {
    if (!onBoundsChange || !mapRef.current) return

    if (boundsTimeoutRef.current) clearTimeout(boundsTimeoutRef.current)

    boundsTimeoutRef.current = setTimeout(() => {
      const map = mapRef.current?.getMap()
      if (!map) return
      const bounds = map.getBounds()
      onBoundsChange({
        minLat: bounds.getSouth(),
        minLng: bounds.getWest(),
        maxLat: bounds.getNorth(),
        maxLng: bounds.getEast(),
      }, map.getZoom())
    }, 150)
  }, [onBoundsChange])

  // Area polygons GeoJSON - 支持热力图
  const areasGeoJson = useMemo(() => {
    if (!showDubaiLayer || !dubaiAreas.length || !mapLoaded) return null

    // 计算分位数用于热力图
    let percentiles = { p25: 0, p50: 0, p75: 0 }
    if (areaMetric !== 'none') {
      const values = dubaiAreas
        .map(area => getMetricRawValue(area, areaMetric))
        .filter((v): v is number => v !== null)
      percentiles = calculatePercentiles(values)
    }

    const features = dubaiAreas
      .filter(area => area.boundary?.type === 'Polygon')
      .map(area => {
        // 如果选择了指标，使用热力图颜色
        let fillColor = area.color || '#3b82f6'
        if (areaMetric !== 'none') {
          const rawValue = getMetricRawValue(area, areaMetric)
          fillColor = getHeatmapColor(rawValue, areaMetric, percentiles)
        }

        return {
          type: 'Feature' as const,
          id: area.id,
          properties: {
            id: area.id,
            name: area.name,
            color: fillColor,
            opacity: area.opacity ?? 0.5
          },
          geometry: area.boundary
        }
      })

    return { type: 'FeatureCollection' as const, features }
  }, [dubaiAreas, showDubaiLayer, mapLoaded, areaMetric])

  // Area labels GeoJSON - 区域名称
  const areaLabelsGeoJson = useMemo(() => {
    if (!showDubaiLayer || !dubaiAreas.length || !mapLoaded) return null

    const langKey = i18n.language?.split('-')[0]

    const features = dubaiAreas
      .filter(area => {
        if (area.boundary?.type !== 'Polygon') return false
        const coords = (area.boundary as any).coordinates?.[0]
        return Array.isArray(coords) && coords.length >= 3
      })
      .map(area => {
        const coords = (area.boundary as any).coordinates[0]
        const centroid = getCentroid(coords)
        const span = getPolygonSpan(coords)
        const minZoom = getMinZoomForSpan(span)
        const translatedName = langKey ? area.translations?.[langKey]?.name : undefined

        // 只显示区域名称（不包含指标值，指标值用单独的 layer）
        let displayName = area.name
        if (translatedName) displayName += `\n${translatedName}`

        return {
          type: 'Feature' as const,
          properties: {
            name: area.name,
            translatedName: translatedName || '',
            span,
            minZoom,
            displayName
          },
          geometry: { type: 'Point' as const, coordinates: centroid }
        }
      })

    return { type: 'FeatureCollection' as const, features }
  }, [dubaiAreas, showDubaiLayer, mapLoaded, i18n.language])

  // Metric values GeoJSON - 独立的指标值图层，带颜色
  const metricValuesGeoJson = useMemo(() => {
    if (!showDubaiLayer || !dubaiAreas.length || !mapLoaded || areaMetric === 'none') return null

    // 计算分位数
    const values = dubaiAreas
      .map(area => getMetricRawValue(area, areaMetric))
      .filter((v): v is number => v !== null)
    const percentiles = calculatePercentiles(values)

    const features = dubaiAreas
      .filter(area => {
        if (area.boundary?.type !== 'Polygon') return false
        const coords = (area.boundary as any).coordinates?.[0]
        return Array.isArray(coords) && coords.length >= 3
      })
      .map(area => {
        const coords = (area.boundary as any).coordinates[0]
        const centroid = getCentroid(coords)
        const span = getPolygonSpan(coords)
        const minZoom = getMinZoomForSpan(span)
        const metricValue = formatMetricValue(area, areaMetric)
        const rawValue = getMetricRawValue(area, areaMetric)
        const metricColor = getHeatmapColor(rawValue, areaMetric, percentiles)

        return {
          type: 'Feature' as const,
          properties: {
            metricValue: metricValue || '-',
            metricColor,
            span,
            minZoom
          },
          geometry: { type: 'Point' as const, coordinates: centroid }
        }
      })

    return { type: 'FeatureCollection' as const, features }
  }, [dubaiAreas, showDubaiLayer, mapLoaded, areaMetric])

  // POI GeoJSON for WebGL rendering (no limit needed - symbol layers are fast)
  const poiGeoJson = useMemo(() => {
    if (!showPois || !pois.length || !mapLoaded) {
      return { type: 'FeatureCollection' as const, features: [] }
    }

    const features = pois.map(poi => {
      const config = CATEGORY_CONFIG[poi.category] || DEFAULT_CATEGORY_CONFIG

      return {
        type: 'Feature' as const,
        id: poi.id,
        properties: {
          id: poi.id,
          name: poi.name,
          category: poi.category,
          color: config.color,
          icon: `poi-${poi.category}`,  // e.g. "poi-hospital", "poi-police"
        },
        geometry: {
          type: 'Point' as const,
          coordinates: [poi.lng, poi.lat]
        }
      }
    })

    return { type: 'FeatureCollection' as const, features }
  }, [pois, showPois, mapLoaded])

  // Hover handlers for areas and POIs
  const handleMouseMove = useCallback((e: MapLayerMouseEvent) => {
    const map = mapRef.current?.getMap()
    if (!map) return

    if (e.features?.length) {
      const layerId = e.features[0].layer?.id
      // Change cursor for clickable layers
      map.getCanvas().style.cursor = 'pointer'

      if (layerId === 'area-fills') {
        setHoveredAreaId(e.features[0].properties?.id || null)
      }
    } else {
      map.getCanvas().style.cursor = ''
      setHoveredAreaId(null)
    }
  }, [])

  const handleMouseLeave = useCallback(() => {
    const map = mapRef.current?.getMap()
    if (map) map.getCanvas().style.cursor = ''
    setHoveredAreaId(null)
  }, [])

  const handleMapClick = useCallback((e: MapLayerMouseEvent) => {
    if (!e.features?.length) return

    // Prioritize: POI > Station > Area
    // Find the most specific feature type
    const poiFeature = e.features.find(f => f.layer?.id === 'poi-circles')
    const stationFeature = e.features.find(f => f.layer?.id === 'transport-stations-bg')
    const areaFeature = e.features.find(f => f.layer?.id === 'area-fills')

    // Handle POI click (highest priority)
    if (poiFeature && onPoiClick) {
      const poiId = poiFeature.properties?.id
      const poi = pois.find(p => p.id === poiId)
      if (poi) {
        onPoiClick(poi)
        return
      }
    }

    // Handle station click
    if (stationFeature && onStationClick) {
      const props = stationFeature.properties || {}
      const coords = (stationFeature.geometry as any)?.coordinates
      if (coords) {
        const station: TransportStation = {
          id: props.id || `station-${Date.now()}`,
          name: props.name || 'Unknown Station',
          nameAr: props.nameAr || undefined,
          category: props.category as TransportStation['category'],
          color: props.color || '#E31837',
          lng: coords[0],
          lat: coords[1],
          line: props.line || undefined,
          network: props.network || undefined,
          operator: props.operator || undefined,
        }
        onStationClick(station)
        return
      }
    }

    // Handle area click (lowest priority)
    if (areaFeature && onAreaClick) {
      const areaId = areaFeature.properties?.id
      const area = dubaiAreas.find(a => a.id === areaId)
      if (area) onAreaClick(area)
    }
  }, [dubaiAreas, pois, onAreaClick, onPoiClick, onStationClick])

  return (
    <div className="h-full w-full">
      <Map
        ref={mapRef}
        {...viewState}
        onMove={evt => setViewState(evt.viewState)}
        onMoveEnd={handleMoveEnd}
        onLoad={handleMapLoad}
        style={{ width: '100%', height: '100%' }}
        mapStyle={MAP_STYLE}
        interactiveLayerIds={mapLoaded ? [
          ...(areasGeoJson ? ['area-fills'] : []),
          ...(showTransport && transportGeoJSON ? ['transport-stations-bg'] : []),
          ...(poiGeoJson.features.length ? ['poi-circles'] : [])
        ] : []}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleMapClick}
      >
        {/* Area Polygons */}
        {mapLoaded && areasGeoJson && (
          <Source id="areas" type="geojson" data={areasGeoJson}>
            <Layer
              id="area-fills"
              type="fill"
              paint={{
                'fill-color': ['get', 'color'],
                'fill-opacity': [
                  'case',
                  ['==', ['get', 'id'], hoveredAreaId],
                  ['*', ['get', 'opacity'], 0.7],  // hover: opacity * 0.7
                  ['*', ['get', 'opacity'], 0.4]   // normal: opacity * 0.4 (和之前一样淡)
                ]
              }}
            />
          </Source>
        )}

        {/* Area Labels - 区域名称 (only show when no metric selected) */}
        {mapLoaded && areaLabelsGeoJson && areaMetric === 'none' && (
          <Source id="area-labels" type="geojson" data={areaLabelsGeoJson}>
            <Layer
              id="area-label-text"
              type="symbol"
              filter={['<=', ['get', 'minZoom'], ['zoom']]}
              layout={{
                'text-field': ['get', 'displayName'],
                'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
                'text-size': [
                  'interpolate', ['linear'], ['zoom'],
                  8, 10,
                  12, 12,
                  14, 14
                ],
                'text-anchor': 'center',
                // Gradual clustering: 11-13 with decreasing padding, 14+ show all
                'text-allow-overlap': [
                  'step',
                  ['zoom'],
                  false,  // zoom < 14: hide overlapping
                  14, true   // zoom >= 14: show all
                ],
                'text-padding': [
                  'step',
                  ['zoom'],
                  12,  // zoom < 11: large padding (tight clustering)
                  11, 8,  // zoom 11: medium-large padding
                  12, 4,  // zoom 12: medium padding
                  13, 2,  // zoom 13: small padding (loose clustering)
                  14, 0   // zoom >= 14: no padding
                ],
                'symbol-sort-key': ['get', 'minZoom']
              }}
              paint={{
                'text-color': '#334155',
                'text-halo-color': '#ffffff',
                'text-halo-width': 2
              }}
            />
          </Source>
        )}

        {/* Metric Values - 指标数值（带颜色） */}
        {mapLoaded && metricValuesGeoJson && (
          <Source id="metric-values" type="geojson" data={metricValuesGeoJson}>
            <Layer
              id="metric-value-text"
              type="symbol"
              filter={['<=', ['get', 'minZoom'], ['zoom']]}
              layout={{
                'text-field': ['get', 'metricValue'],
                'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
                'text-size': [
                  'interpolate', ['linear'], ['zoom'],
                  8, 12,
                  12, 14,
                  14, 16
                ],
                'text-anchor': 'center',
                // Gradual clustering: 11-13 with decreasing padding, 14+ show all
                'text-allow-overlap': [
                  'step',
                  ['zoom'],
                  false,  // zoom < 14: hide overlapping
                  14, true   // zoom >= 14: show all
                ],
                'text-padding': [
                  'step',
                  ['zoom'],
                  8,   // zoom < 11: large padding
                  11, 5,  // zoom 11: medium-large padding
                  12, 3,  // zoom 12: medium padding
                  13, 1,  // zoom 13: small padding
                  14, 0   // zoom >= 14: no padding
                ],
                'symbol-sort-key': ['get', 'minZoom']
              }}
              paint={{
                'text-color': ['get', 'metricColor'],
                'text-halo-color': '#ffffff',
                'text-halo-width': 2.5
              }}
            />
          </Source>
        )}

        {/* Transport Lines - Metro/Tram only */}
        {mapLoaded && showTransport && transportGeoJSON && transportGeoJSON.features.length > 0 && (
          <Source
            id="transport-lines"
            type="geojson"
            data={transportGeoJSON}
          >
            {/* White casing for visibility */}
            <Layer
              id="transport-lines-casing"
              type="line"
              filter={['in', ['get', 'category'], ['literal', ['metro_lines', 'tram_lines', 'monorail']]]}
              layout={{
                'line-cap': 'butt',
                'line-join': 'round'
              }}
              paint={{
                'line-color': '#ffffff',
                'line-width': [
                  'interpolate', ['linear'], ['zoom'],
                  8, 4,
                  12, 5,
                  16, 6
                ],
                'line-opacity': 0.9
              }}
            />
            {/* Main colored line - color based on line property */}
            <Layer
              id="transport-lines-main"
              type="line"
              filter={['in', ['get', 'category'], ['literal', ['metro_lines', 'tram_lines', 'monorail']]]}
              layout={{
                'line-cap': 'butt',
                'line-join': 'round'
              }}
              paint={{
                'line-color': [
                  'match', ['get', 'line'],
                  'red', '#ef4444',
                  'green', '#22c55e',
                  'blue', '#3b82f6',
                  'tram', '#f97316',
                  'palm_monorail', '#a855f7',
                  '#6b7280'  // default gray
                ],
                'line-width': [
                  'interpolate', ['linear'], ['zoom'],
                  8, 2,
                  12, 3,
                  16, 4
                ],
                'line-opacity': 1
              }}
            />

            {/* Station icons - same size as POI icons */}
            <Layer
              id="transport-stations-bg"
              type="symbol"
              filter={['in', ['get', 'category'], ['literal', ['metro_stations', 'tram_stations', 'monorail_stations']]]}
              layout={{
                'icon-image': [
                  'concat',
                  'station-',
                  ['get', 'line']
                ],
                'icon-size': [
                  'interpolate', ['linear'], ['zoom'],
                  10, 0.8,
                  13, 1.0,
                  16, 1.2,
                  18, 1.4
                ],
                'icon-allow-overlap': true
              }}
            />

            {/* Station labels - show at higher zoom */}
            <Layer
              id="transport-stations-labels"
              type="symbol"
              filter={['all',
                ['in', ['get', 'category'], ['literal', ['metro_stations', 'tram_stations', 'monorail_stations']]],
                ['>=', ['zoom'], 13]
              ]}
              layout={{
                'text-field': ['get', 'name'],
                'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
                'text-size': [
                  'interpolate', ['linear'], ['zoom'],
                  13, 10,
                  15, 12,
                  17, 14
                ],
                'text-offset': [0, 1.5],
                'text-anchor': 'top',
                'text-allow-overlap': false,
                'text-optional': true
              }}
              paint={{
                'text-color': ['get', 'color'],
                'text-halo-color': '#ffffff',
                'text-halo-width': 2
              }}
            />

          </Source>
        )}

        {/* POI Icons - Symbol Layer */}
        {mapLoaded && poiGeoJson.features.length > 0 && (
          <Source
            id="pois"
            type="geojson"
            data={poiGeoJson}
          >
            <Layer
              id="poi-circles"
              type="symbol"
              layout={{
                'icon-image': ['get', 'icon'],
                'icon-size': [
                  'interpolate', ['linear'], ['zoom'],
                  10, 0.8,
                  13, 1.0,
                  16, 1.2,
                  18, 1.4
                ],
                // Gradual clustering: 11-13 with decreasing padding, 14+ show all
                'icon-allow-overlap': [
                  'step',
                  ['zoom'],
                  false,  // zoom < 14: hide overlapping
                  14, true   // zoom >= 14: show all
                ],
                'icon-padding': [
                  'step',
                  ['zoom'],
                  6,   // zoom < 11: large padding
                  11, 4,  // zoom 11: medium-large padding
                  12, 2,  // zoom 12: medium padding
                  13, 1,  // zoom 13: small padding
                  14, 0   // zoom >= 14: no padding
                ]
              }}
            />
          </Source>
        )}

        {/* Cluster Markers (legacy) */}
        {clusters.map(cluster => (
          <ClusterMarker
            key={cluster.cluster_id}
            cluster={cluster}
            onClick={onClusterClick}
          />
        ))}

        {/* Project Pins - individual markers with thumbnail images */}
        {projects.map(project => (
          <ProjectPinMarker
            key={project.id}
            project={project}
            onClick={onProjectClick}
          />
        ))}
      </Map>
    </div>
  )
}

export default memo(MapViewMapLibre)
