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
import { type MapLayerMouseEvent, type Map as MaplibreMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useTranslation } from 'react-i18next'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  Cross, GraduationCap, TrainFront, ShoppingBag, ShoppingCart,
  Utensils, Coffee, Landmark, CreditCard, TreePine, Building2,
  Hotel, Dumbbell, Umbrella, Film, Fuel, Church,
  Shield, Flame, Mail, Flag, Pill, Stethoscope, School,
  TramFront, Cable, Bus, Ship, Circle, Globe, Ruler, X
} from 'lucide-react'
import { DubaiArea, DubaiLandmark } from '../types'
import { Poi } from '../hooks/useDubaiPois'
import { TransportGeoJSON } from '../lib/api'

// CARTO 无标签风格：选中指标时用，画热力图干净不被街道名干扰
const MAP_STYLE_CLEAN = 'https://basemaps.cartocdn.com/gl/voyager-nolabels-gl-style/style.json'
// CARTO 带标签风格：未选指标时用，显示街道/地名等细节方便探索
const MAP_STYLE_LABELED = 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json'

// 卫星底图风格：Esri World Imagery 栅格瓦片。
// glyphs 指向免费字体服务，保证切换后 area/指标 的文字标签仍能渲染。
const SATELLITE_STYLE = {
  version: 8 as const,
  glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
  sources: {
    'satellite-tiles': {
      type: 'raster' as const,
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Imagery © Esri, Maxar, Earthstar Geographics'
    }
  },
  layers: [
    { id: 'sat-bg', type: 'background' as const, paint: { 'background-color': '#0b1722' } },
    { id: 'satellite', type: 'raster' as const, source: 'satellite-tiles' }
  ]
}

type BaseMap = 'vector' | 'satellite'

// 两点间球面距离（km），用于地图测距工具
function haversineKm(a: { lng: number; lat: number }, b: { lng: number; lat: number }): number {
  const R = 6371
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

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

// Route type icons for custom routes (uses route's color from GeoJSON)
const ROUTE_TYPE_CONFIG: Record<string, { defaultColor: string; Icon: typeof Cross }> = {
  metro: { defaultColor: '#ef4444', Icon: TrainFront },
  tram: { defaultColor: '#f97316', Icon: TramFront },
  bus: { defaultColor: '#22c55e', Icon: Bus },
  monorail: { defaultColor: '#a855f7', Icon: Cable },
  ferry: { defaultColor: '#0ea5e9', Icon: Ship },
  custom: { defaultColor: '#6b7280', Icon: Circle },
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
// 优化：更早显示小区域标签，减少 zoom 门槛
function getMinZoomForSpan(span: number): number {
  if (span >= 0.15) return 7    // 超大区域 - 更早显示
  if (span >= 0.08) return 8    // 大区域
  if (span >= 0.04) return 9    // 中等区域
  if (span >= 0.02) return 10   // 小区域
  if (span >= 0.01) return 11   // 更小区域
  return 12                      // 最小区域 - 从 13 降到 12
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
      if (v >= 1000000) return `AED ${(v / 1000000).toFixed(1)}M`
      if (v >= 1000) return `AED ${Math.round(v / 1000)}K`
      return `AED ${v}`
    }
    case 'medianPriceSqft': {
      // medianPriceSqm converted to sqft (1 sqm = 10.764 sqft)
      const v = area.medianPriceSqm
      if (v === undefined || v === null) return ''
      const pricePerSqft = v / 10.764
      if (pricePerSqft >= 1000) return `AED ${(pricePerSqft / 1000).toFixed(1)}K`
      return `AED ${Math.round(pricePerSqft)}`
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
  const [isHovered, setIsHovered] = useState(false)
  const [showBelow, setShowBelow] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const isSoldOut = project.status === 'sold-out'

  // Format price range
  const priceText = useMemo(() => {
    if (project.minPrice && project.maxPrice) {
      return `${formatPriceShort(project.minPrice)} - ${formatPriceShort(project.maxPrice)}`
    } else if (project.minPrice) {
      return `From ${formatPriceShort(project.minPrice)}`
    }
    return null
  }, [project.minPrice, project.maxPrice])

  // Format bedroom range
  const bedText = project.minBeds !== null && project.maxBeds !== null
    ? project.minBeds === project.maxBeds
      ? `${project.minBeds} BR`
      : `${project.minBeds}-${project.maxBeds} BR`
    : project.minBeds !== null
      ? `${project.minBeds}+ BR`
      : null

  // Format completion date (e.g., "2029-12-27T08:00:00.000Z" -> "Q4 2029")
  const completionText = useMemo(() => {
    if (!project.completionDate) return null
    try {
      const date = new Date(project.completionDate)
      const quarter = Math.ceil((date.getMonth() + 1) / 3)
      return `Q${quarter} ${date.getFullYear()}`
    } catch {
      return null
    }
  }, [project.completionDate])

  // Check if marker is near top of viewport
  const handleMouseEnter = useCallback(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect()
      // If marker is within 200px of viewport top, show tooltip below
      setShowBelow(rect.top < 200)
    }
    setIsHovered(true)
  }, [])

  const handleMouseLeave = useCallback(() => {
    setIsHovered(false)
  }, [])

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
        ref={containerRef}
        className="cursor-pointer transition-all duration-200 hover:scale-110 hover:z-[100]"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.25))',
        }}
      >
        {/* Hover tooltip - rich info card, smart positioning */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            ...(showBelow ? {
              top: '100%',
              marginTop: '12px',
            } : {
              bottom: '100%',
              marginBottom: '12px',
            }),
            transform: 'translateX(-50%)',
            background: '#fff',
            borderRadius: '12px',
            padding: '0',
            boxShadow: '0 8px 30px rgba(0,0,0,0.25)',
            pointerEvents: 'none',
            minWidth: '180px',
            maxWidth: '220px',
            overflow: 'hidden',
            opacity: isHovered ? 1 : 0,
            visibility: isHovered ? 'visible' : 'hidden',
            transition: 'opacity 0.15s ease',
            zIndex: 9999,
          }}
        >
          {/* Mini image */}
          {project.image && (
            <div style={{ width: '100%', height: '80px', overflow: 'hidden' }}>
              <img
                src={getImageUrl(project.image, 'thumbnail')}
                alt=""
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                }}
              />
            </div>
          )}
          {/* Info */}
          <div style={{ padding: '10px 12px' }}>
            {/* Project name - full, no truncate */}
            <div style={{
              fontSize: '13px',
              fontWeight: 700,
              color: '#0f172a',
              lineHeight: 1.3,
              marginBottom: '6px',
            }}>
              {project.name}
            </div>
            {/* Price - prominent */}
            {priceText && (
              <div style={{
                fontSize: '12px',
                fontWeight: 600,
                color: '#0d9488',
                marginBottom: '4px',
              }}>
                AED {priceText}
              </div>
            )}
            {/* Details row */}
            <div style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '8px',
              fontSize: '11px',
              color: '#64748b',
            }}>
              {bedText && <span>{bedText}</span>}
              {completionText && <span>{completionText}</span>}
            </div>
          </div>
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

          {/* Sold Out badge - small red circle at top-right */}
          {isSoldOut && (
            <div
              style={{
                position: 'absolute',
                top: '2px',
                right: '-2px',
                background: '#dc2626',
                color: '#fff',
                fontSize: '7px',
                fontWeight: 700,
                padding: '2px 4px',
                borderRadius: '4px',
                border: '1.5px solid #fff',
                lineHeight: 1,
                letterSpacing: '0.02em',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
              }}
            >
              SOLD
            </div>
          )}
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
// Landmark Marker - Circle with image thumbnail or type icon
// ============================================================================

const LandmarkMarker = memo(({ landmark, onClick }: {
  landmark: DubaiLandmark
  onClick?: (lm: DubaiLandmark) => void
}) => {
  const pinSize = landmark.size === 'large' ? 52 : landmark.size === 'small' ? 36 : 44

  return (
    <Marker
      longitude={landmark.location.lng}
      latitude={landmark.location.lat}
      anchor="center"
      onClick={(e) => {
        e.originalEvent.stopPropagation()
        onClick?.(landmark)
      }}
    >
      <div
        className="cursor-pointer transition-transform duration-150 hover:scale-110"
        style={{
          width: pinSize,
          height: pinSize,
          borderRadius: '50%',
          overflow: 'hidden',
          border: '2.5px solid #fff',
          boxShadow: '0 1px 4px rgba(0,0,0,0.25), 0 4px 12px rgba(0,0,0,0.12)',
          background: landmark.imageUrl ? '#f1f5f9' : '#334155',
        }}
      >
        {landmark.imageUrl ? (
          <img
            src={landmark.imageUrl}
            alt={landmark.name}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            loading="lazy"
          />
        ) : (
          <div style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <Building2 style={{ width: pinSize * 0.45, height: pinSize * 0.45, color: 'rgba(255,255,255,0.8)' }} />
          </div>
        )}
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
  onLandmarkClick?: (landmark: DubaiLandmark) => void
  areaMetric?: AreaMetric
  dubaiAreas?: DubaiArea[]
  dubaiLandmarks?: DubaiLandmark[]
  pois?: Poi[]
  showDubaiLayer?: boolean
  showPois?: boolean
  flyToLocation?: { lat: number; lng: number; zoom?: number; bounds?: [[number, number], [number, number]] } | null
  transportGeoJSON?: TransportGeoJSON | null
  showTransport?: boolean
  /** 由语音助手触发的测距：传入点序列即进入测距模式并画线 */
  voiceMeasure?: { points: [number, number][] } | null
  /** 由语音助手触发的「区域配套放射图」：从区域中心向最近配套画连线+距离 */
  voiceAmenities?: {
    center: [number, number]; centerName: string; score: number; tier: string
    spokes: { category: string; label: string; emoji: string; name: string; lng: number; lat: number; distanceKm: number }[]
  } | null
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
  onLandmarkClick,
  areaMetric = 'none',
  dubaiAreas = [],
  dubaiLandmarks = [],
  pois = [],
  showDubaiLayer = false,
  showPois = false,
  flyToLocation = null,
  transportGeoJSON = null,
  showTransport = false,
  voiceMeasure = null,
  voiceAmenities = null
}: MapViewMapLibreProps) {
  const { i18n } = useTranslation()
  const mapRef = useRef<MapRef>(null)
  const [mapLoaded, setMapLoaded] = useState(false)
  const [baseMap, setBaseMapState] = useState<BaseMap>(
    () => ((localStorage.getItem('map-base') as BaseMap) || 'satellite')
  )
  const setBaseMap = (v: BaseMap | ((p: BaseMap) => BaseMap)) => {
    setBaseMapState(prev => {
      const next = typeof v === 'function' ? (v as (p: BaseMap) => BaseMap)(prev) : v
      try { localStorage.setItem('map-base', next) } catch { /* ignore */ }
      return next
    })
  }
  const [measureMode, setMeasureMode] = useState(false)
  const [measurePoints, setMeasurePoints] = useState<{ lng: number; lat: number }[]>([])

  const measureTotalKm = useMemo(() => {
    let sum = 0
    for (let i = 1; i < measurePoints.length; i++) {
      sum += haversineKm(measurePoints[i - 1], measurePoints[i])
    }
    return sum
  }, [measurePoints])

  const measureGeoJson = useMemo(() => {
    const coords = measurePoints.map(p => [p.lng, p.lat])
    const fmt = (km: number) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(2)} km`)
    // 逐段:每相邻两点一条 LineString,带该段距离标签 → 地图上直接显示数字
    const segments = {
      type: 'FeatureCollection' as const,
      features: measurePoints.slice(1).map((p, i) => {
        const a = measurePoints[i]
        return {
          type: 'Feature' as const,
          properties: { label: fmt(haversineKm(a, p)) },
          geometry: { type: 'LineString' as const, coordinates: [[a.lng, a.lat], [p.lng, p.lat]] }
        }
      })
    }
    return {
      segments,
      points: {
        type: 'FeatureCollection' as const,
        features: coords.map((c, i) => ({
          type: 'Feature' as const,
          properties: { idx: i },
          geometry: { type: 'Point' as const, coordinates: c }
        }))
      }
    }
  }, [measurePoints])

  const exitMeasure = useCallback(() => {
    setMeasureMode(false)
    setMeasurePoints([])
  }, [])

  // 测距模式：Esc 退出并清空
  useEffect(() => {
    if (!measureMode) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') exitMeasure() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [measureMode, exitMeasure])

  // 测距模式：地图光标改为十字
  useEffect(() => {
    const canvas = mapRef.current?.getMap()?.getCanvas()
    if (canvas) canvas.style.cursor = measureMode ? 'crosshair' : ''
  }, [measureMode, mapLoaded])

  // 语音助手触发测距：进入测距模式、落点、自动缩放到这些点
  useEffect(() => {
    if (!voiceMeasure || !voiceMeasure.points?.length) return
    const pts = voiceMeasure.points.map(([lng, lat]) => ({ lng, lat }))
    setMeasureMode(true)
    setMeasurePoints(pts)
    const map = mapRef.current?.getMap()
    if (map && mapLoaded && pts.length >= 2) {
      const lngs = pts.map(p => p.lng)
      const lats = pts.map(p => p.lat)
      map.fitBounds(
        [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
        { padding: 120, maxZoom: 13, duration: 1500 }
      )
    }
  }, [voiceMeasure, mapLoaded])

  // 语音助手「配套放射图」：每来一份新数据就重新显示面板
  const [amenityClosed, setAmenityClosed] = useState(false)
  useEffect(() => { setAmenityClosed(false) }, [voiceAmenities])
  const amenityGeoJson = useMemo(() => {
    if (!voiceAmenities) return { lines: null, points: null }
    const [clng, clat] = voiceAmenities.center
    return {
      lines: {
        type: 'FeatureCollection' as const,
        features: voiceAmenities.spokes.map(s => ({
          type: 'Feature' as const,
          properties: { label: `${s.label} ${s.distanceKm}km` },
          geometry: { type: 'LineString' as const, coordinates: [[clng, clat], [s.lng, s.lat]] }
        }))
      },
      points: {
        type: 'FeatureCollection' as const,
        features: [
          {
            type: 'Feature' as const,
            properties: { kind: 'center', label: voiceAmenities.centerName },
            geometry: { type: 'Point' as const, coordinates: [clng, clat] }
          },
          ...voiceAmenities.spokes.map(s => ({
            type: 'Feature' as const,
            properties: { kind: 'amenity', label: `${s.label} ${s.distanceKm}km` },
            geometry: { type: 'Point' as const, coordinates: [s.lng, s.lat] }
          }))
        ]
      }
    }
  }, [voiceAmenities])
  const showAmenities = !!voiceAmenities && !amenityClosed

  const [hoveredAreaId, setHoveredAreaId] = useState<string | null>(null)
  const boundsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 地图初始视图
  const [viewState, setViewState] = useState({
    longitude: 55.089,
    latitude: 25.019,
    zoom: 10.115216007819594
  })

  // Fly to location or fitBounds when flyToLocation changes
  useEffect(() => {
    if (!flyToLocation || !mapRef.current || !mapLoaded) return

    const map = mapRef.current.getMap()
    if (!map) return

    if (flyToLocation.bounds) {
      // fitBounds for multi-point results
      map.fitBounds(flyToLocation.bounds, {
        padding: { top: 80, bottom: 120, left: 40, right: 80 },
        maxZoom: 13,
        duration: 2000
      })
    } else {
      map.flyTo({
        center: [flyToLocation.lng, flyToLocation.lat],
        zoom: flyToLocation.zoom ?? 11,
        duration: 2000,
        curve: 1.8,
        essential: true
      })
    }
  }, [flyToLocation, mapLoaded])

  // 地图加载完成后再渲染 layers
  // 生成并注入自定义图标（POI / 交通站点 / 路线）。
  // 切换底图会清空 style 内的自定义 image，故需在 style.load 时重新注入。
  const addCustomIcons = useCallback(async (map: MaplibreMap) => {
    const safeAddImage = (name: string, data: ImageData) => {
      try {
        if (!map.hasImage(name)) {
          map.addImage(name, data, { pixelRatio: 2 })
        }
      } catch {
        // Image already exists (race condition), ignore
      }
    }

    const poiIconPromises = Object.entries(CATEGORY_CONFIG).map(async ([category, config]) => {
      const imageData = await generatePoiIcon(config.color, config.Icon, 48)
      safeAddImage(`poi-${category}`, imageData)
    })
    const transportIconPromises = Object.entries(TRANSPORT_LINE_CONFIG).map(async ([line, config]) => {
      const imageData = await generatePoiIcon(config.color, config.Icon, 48)
      safeAddImage(`station-${line}`, imageData)
    })
    const routeTypeIconPromises = Object.entries(ROUTE_TYPE_CONFIG).map(async ([type, config]) => {
      const imageData = await generatePoiIcon(config.defaultColor, config.Icon, 48)
      safeAddImage(`station-${type}`, imageData)
    })

    await Promise.all([...poiIconPromises, ...transportIconPromises, ...routeTypeIconPromises])
  }, [])

  const handleMapLoad = useCallback(async () => {
    const map = mapRef.current?.getMap()
    if (!map) return

    await addCustomIcons(map)

    // 底图切换后 style 重建，重新注入自定义图标
    map.on('style.load', () => { addCustomIcons(map) })

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
    // 测距模式：每次点击落一个点，不触发区域/POI 选择
    if (measureMode) {
      setMeasurePoints(prev => [...prev, { lng: e.lngLat.lng, lat: e.lngLat.lat }])
      return
    }

    if (!e.features?.length) return

    // Prioritize: POI > Station > Area
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
  }, [dubaiAreas, pois, onAreaClick, onPoiClick, onStationClick, measureMode])

  return (
    <div className="h-full w-full">
      <Map
        ref={mapRef}
        {...viewState}
        onMove={evt => setViewState(evt.viewState)}
        onMoveEnd={handleMoveEnd}
        onLoad={handleMapLoad}
        attributionControl={false}
        style={{ width: '100%', height: '100%' }}
        mapStyle={
          baseMap === 'satellite'
            ? SATELLITE_STYLE
            : (areaMetric === 'none' ? MAP_STYLE_LABELED : MAP_STYLE_CLEAN)
        }
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

        {/* Area Labels - 区域名称 (始终显示；选指标时名称上移，数值在下方) */}
        {mapLoaded && areaLabelsGeoJson && (
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
                  8, 8,    // 更小的字体
                  10, 9,
                  12, 10,
                  14, 11,
                  16, 12
                ],
                'text-anchor': 'center',
                // 选了指标时，区域名上移，给下方的指标值留位置
                'text-offset': areaMetric === 'none' ? [0, 0] : [0, -0.8],
                // 更宽松的防叠：zoom 12+ 显示所有
                'text-allow-overlap': [
                  'step',
                  ['zoom'],
                  false,  // zoom < 12: hide overlapping
                  12, true   // zoom >= 12: show all labels
                ],
                // 更小的 padding，允许更紧密的标签
                'text-padding': [
                  'step',
                  ['zoom'],
                  4,   // zoom < 10: small padding
                  10, 2,  // zoom 10: smaller padding
                  11, 1,  // zoom 11: minimal padding
                  12, 0   // zoom >= 12: no padding
                ],
                'symbol-sort-key': ['get', 'minZoom']
              }}
              paint={{
                'text-color': '#334155',
                'text-halo-color': '#ffffff',
                'text-halo-width': 1.5  // 稍微减少 halo 宽度
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
                  8, 9,    // 更小的字体
                  10, 10,
                  12, 11,
                  14, 12,
                  16, 13
                ],
                'text-anchor': 'center',
                // 指标值显示在区域名下方
                'text-offset': [0, 0.9],
                // 更宽松的防叠：zoom 12+ 显示所有
                'text-allow-overlap': [
                  'step',
                  ['zoom'],
                  false,  // zoom < 12: hide overlapping
                  12, true   // zoom >= 12: show all
                ],
                // 更小的 padding
                'text-padding': [
                  'step',
                  ['zoom'],
                  3,   // zoom < 10: small padding
                  10, 2,  // zoom 10: smaller padding
                  11, 1,  // zoom 11: minimal padding
                  12, 0   // zoom >= 12: no padding
                ],
                'symbol-sort-key': ['get', 'minZoom']
              }}
              paint={{
                'text-color': ['get', 'metricColor'],
                'text-halo-color': '#ffffff',
                'text-halo-width': 2
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
            {/* Main colored line - use color property from GeoJSON */}
            <Layer
              id="transport-lines-main"
              type="line"
              filter={['in', ['get', 'category'], ['literal', ['metro_lines', 'tram_lines', 'monorail']]]}
              layout={{
                'line-cap': 'butt',
                'line-join': 'round'
              }}
              paint={{
                'line-color': ['coalesce', ['get', 'color'], '#6b7280'],
                'line-width': [
                  'interpolate', ['linear'], ['zoom'],
                  8, 2,
                  12, 3,
                  16, 4
                ],
                'line-opacity': 1
              }}
            />

            {/* Station icons - icon based on line/type property */}
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

        {/* Landmark Markers — individual markers with image thumbnails */}
        {dubaiLandmarks.map(lm => (
          <LandmarkMarker
            key={lm.id}
            landmark={lm}
            onClick={onLandmarkClick}
          />
        ))}

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

        {/* 测距：连线 + 顶点 */}
        {mapLoaded && measurePoints.length > 0 && (
          <>
            <Source id="measure-line" type="geojson" data={measureGeoJson.segments}>
              <Layer
                id="measure-line-layer"
                type="line"
                paint={{ 'line-color': '#2563eb', 'line-width': 3, 'line-dasharray': [2, 1] }}
              />
              <Layer
                id="measure-seg-label"
                type="symbol"
                layout={{
                  'symbol-placement': 'line-center',
                  'text-field': ['get', 'label'],
                  'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
                  'text-size': 13,
                  'text-allow-overlap': true,
                  'text-ignore-placement': true
                }}
                paint={{ 'text-color': '#1d4ed8', 'text-halo-color': '#ffffff', 'text-halo-width': 2.5 }}
              />
            </Source>
            <Source id="measure-points" type="geojson" data={measureGeoJson.points}>
              <Layer
                id="measure-points-layer"
                type="circle"
                paint={{
                  'circle-radius': 5,
                  'circle-color': '#2563eb',
                  'circle-stroke-color': '#ffffff',
                  'circle-stroke-width': 2
                }}
              />
            </Source>
          </>
        )}

        {/* 语音助手：区域配套放射图（中心→最近 医院/学校/商场/地铁/超市） */}
        {mapLoaded && showAmenities && amenityGeoJson.lines && amenityGeoJson.points && (
          <>
            <Source id="amenity-lines" type="geojson" data={amenityGeoJson.lines}>
              <Layer
                id="amenity-lines-layer"
                type="line"
                paint={{ 'line-color': '#f59e0b', 'line-width': 2.5, 'line-dasharray': [2, 1.5] }}
              />
              <Layer
                id="amenity-lines-label"
                type="symbol"
                layout={{
                  'symbol-placement': 'line-center',
                  'text-field': ['get', 'label'],
                  'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
                  'text-size': 12
                }}
                paint={{ 'text-color': '#b45309', 'text-halo-color': '#ffffff', 'text-halo-width': 2 }}
              />
            </Source>
            <Source id="amenity-points" type="geojson" data={amenityGeoJson.points}>
              <Layer
                id="amenity-points-layer"
                type="circle"
                paint={{
                  'circle-radius': ['case', ['==', ['get', 'kind'], 'center'], 8, 5],
                  'circle-color': ['case', ['==', ['get', 'kind'], 'center'], '#059669', '#f59e0b'],
                  'circle-stroke-color': '#ffffff',
                  'circle-stroke-width': 2
                }}
              />
              <Layer
                id="amenity-center-label"
                type="symbol"
                filter={['==', ['get', 'kind'], 'center']}
                layout={{
                  'text-field': ['get', 'label'],
                  'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
                  'text-size': 13,
                  'text-offset': [0, 1.4],
                  'text-anchor': 'top'
                }}
                paint={{ 'text-color': '#065f46', 'text-halo-color': '#ffffff', 'text-halo-width': 2 }}
              />
            </Source>
          </>
        )}
      </Map>

      {/* 底图切换：干净/卫星，放右上角（在指标条与 POI 按钮下方，避免重叠） */}
      <button
        type="button"
        onClick={() => setBaseMap(prev => (prev === 'vector' ? 'satellite' : 'vector'))}
        className="absolute top-28 right-4 z-[1000] flex items-center gap-1.5 rounded-lg bg-white/95 px-3 py-2 text-xs font-medium text-slate-700 shadow-lg ring-1 ring-slate-200 backdrop-blur transition hover:bg-white"
        title={baseMap === 'vector' ? '切换到卫星地图' : '切换回地图'}
        aria-label="切换底图"
      >
        <Globe size={15} className={baseMap === 'satellite' ? 'text-emerald-600' : 'text-slate-500'} />
        {baseMap === 'vector' ? '卫星' : '地图'}
      </button>

      {/* 测距工具按钮 */}
      <button
        type="button"
        onClick={() => (measureMode ? exitMeasure() : setMeasureMode(true))}
        className={`absolute top-40 right-4 z-[1000] flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium shadow-lg ring-1 backdrop-blur transition ${
          measureMode
            ? 'bg-blue-600 text-white ring-blue-700 hover:bg-blue-700'
            : 'bg-white/95 text-slate-700 ring-slate-200 hover:bg-white'
        }`}
        title={measureMode ? '退出测距 (Esc)' : '测量两点距离'}
        aria-label="测距工具"
      >
        <Ruler size={15} className={measureMode ? 'text-white' : 'text-slate-500'} />
        {measureMode ? '退出' : '测距'}
      </button>

      {/* 测距距离面板 */}
      {measureMode && (
        <div className="absolute top-52 right-4 z-[1000] w-44 rounded-lg bg-white/95 px-3 py-2.5 text-xs shadow-lg ring-1 ring-slate-200 backdrop-blur">
          <div className="font-semibold text-slate-800">
            {measurePoints.length < 2
              ? '点击地图开始测距'
              : measureTotalKm < 1
                ? `${Math.round(measureTotalKm * 1000)} 米`
                : `${measureTotalKm.toFixed(2)} 公里`}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-500">
            {measurePoints.length} 个点 · 点击继续，Esc 退出
          </div>
          {measurePoints.length > 0 && (
            <button
              type="button"
              onClick={() => setMeasurePoints([])}
              className="mt-1.5 text-[11px] font-medium text-blue-600 hover:underline"
            >
              清除重测
            </button>
          )}
        </div>
      )}

      {/* 语音助手：配套便利度评分面板 */}
      {showAmenities && voiceAmenities && (
        <div className="absolute left-3 bottom-24 md:bottom-6 z-[1000] w-[256px] rounded-2xl bg-white/95 p-3.5 shadow-xl ring-1 ring-slate-200 backdrop-blur">
          <button
            type="button"
            onClick={() => setAmenityClosed(true)}
            className="absolute right-2 top-2 rounded-full p-1 text-slate-400 hover:bg-slate-100"
            aria-label="关闭"
          >
            <X size={14} />
          </button>
          <div className="text-xs font-medium text-slate-500">{voiceAmenities.centerName} · 生活便利度</div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className={`text-3xl font-bold ${
              voiceAmenities.tier === '优秀' ? 'text-emerald-600'
                : voiceAmenities.tier === '良好' ? 'text-sky-600'
                : voiceAmenities.tier === '一般' ? 'text-amber-600' : 'text-slate-500'
            }`}>{voiceAmenities.score}</span>
            <span className="text-sm text-slate-400">/100</span>
            <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-semibold ${
              voiceAmenities.tier === '优秀' ? 'bg-emerald-50 text-emerald-700'
                : voiceAmenities.tier === '良好' ? 'bg-sky-50 text-sky-700'
                : voiceAmenities.tier === '一般' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'
            }`}>{voiceAmenities.tier}</span>
          </div>
          <div className="mt-2.5 space-y-1.5">
            {voiceAmenities.spokes.map(s => (
              <div key={s.category} className="flex items-center gap-2 text-xs">
                <span className="w-4 text-center">{s.emoji}</span>
                <span className="text-slate-600">{s.label}</span>
                <span className="ml-auto truncate font-medium text-slate-800" title={s.name}>{s.distanceKm} km</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default memo(MapViewMapLibre)
