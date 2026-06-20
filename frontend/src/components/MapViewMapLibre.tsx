/**
 * MapLibre GL JS 地图组件 - 简洁高效版
 */

import { useState, useRef, useMemo, useCallback, memo, useEffect, forwardRef, useImperativeHandle } from 'react'
import Map, {
  Marker,
  Source,
  Layer,
  MapRef
} from 'react-map-gl/maplibre'
import Supercluster from 'supercluster'
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
// Luna Tour cinematic handle (isolated; lets the tour drive THIS map). Delete
// the import + useImperativeHandle below + luna-tour/ to remove.
import { createMapTourHandle, type MapTourHandle } from '../luna-tour/map/mapTourHandle'

// CARTO 无标签风格：选中指标时用，画热力图干净不被街道名干扰
const MAP_STYLE_CLEAN = 'https://basemaps.cartocdn.com/gl/voyager-nolabels-gl-style/style.json'
// CARTO 带标签风格：未选指标时用，显示街道/地名等细节方便探索
const MAP_STYLE_LABELED = 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json'
// CARTO 夜景风格：电影沉浸底图（与 Luna Tour demo 同款 dark-matter）。
// 数据图层（热力/POI/区域/交通）叠加其上不变；只是底图变深色。
const MAP_STYLE_DARK = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

// 卫星底图风格。
// 有 VITE_MAPTILER_KEY → MapTiler satellite-v2 的 512 retina 瓦片(手机/高DPI屏清晰);
// 没有 → 退回 Esri World Imagery 256(免 key,但高 DPI 屏会偏糊)。免费 key: maptiler.com
const MAPTILER_KEY = (import.meta as any).env?.VITE_MAPTILER_KEY as string | undefined

const SATELLITE_SOURCE = MAPTILER_KEY
  ? {
      type: 'raster' as const,
      tiles: [`https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key=${MAPTILER_KEY}`],
      tileSize: 512,
      maxzoom: 20,
      attribution: '© MapTiler © Esri, Maxar'
    }
  : {
      type: 'raster' as const,
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Imagery © Esri, Maxar, Earthstar Geographics'
    }

// glyphs 指向免费字体服务，保证切换后 area/指标 的文字标签仍能渲染。
const SATELLITE_STYLE = {
  version: 8 as const,
  glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
  sources: { 'satellite-tiles': SATELLITE_SOURCE },
  layers: [
    { id: 'sat-bg', type: 'background' as const, paint: { 'background-color': '#0b1722' } },
    { id: 'satellite', type: 'raster' as const, source: 'satellite-tiles' }
  ]
}

type BaseMap = 'vector' | 'satellite' | 'dark'

// Web-mercator latitude → slippy tile Y at a given zoom (for tile prefetching).
const lat2tileY = (lat: number, z: number) =>
  Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z)

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

// 新版 UAE 迪拉姆官方符号：D + 两道向左伸出的横线（与 DirhamSymbol.tsx 同造型）。
// 固定中性色（像 ¥/$ 一样），不随价格热力色变：深底图用白字、浅底图用深灰。
function generateDirhamIcon(color: string, halo: string, size = 26): ImageData {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = color
  ctx.font = `700 ${size * 0.92}px Georgia, 'Times New Roman', serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = halo
  ctx.lineWidth = Math.max(3, size * 0.14)
  const dX = size * 0.56
  const dY = size * 0.85
  const barW = size * 0.58
  const barH = Math.max(2, size * 0.085)
  const bar1Y = size * 0.36
  const bar2Y = size * 0.56
  ctx.strokeText('D', dX, dY)
  ctx.strokeRect(0 + ctx.lineWidth / 2, bar1Y, barW, barH)
  ctx.strokeRect(0 + ctx.lineWidth / 2, bar2Y, barW, barH)
  ctx.fillText('D', dX, dY)
  ctx.fillRect(0 + ctx.lineWidth / 2, bar1Y, barW, barH)
  ctx.fillRect(0 + ctx.lineWidth / 2, bar2Y, barW, barH)
  return ctx.getImageData(0, 0, size, size)
}

// 1x1 透明图：没有价格的区域用它占位，地图上不会出现孤零零的货币符号
function transparentIcon(): ImageData {
  const canvas = document.createElement('canvas')
  canvas.width = 2
  canvas.height = 2
  return canvas.getContext('2d')!.getImageData(0, 0, 2, 2)
}

export type AreaMetric = 'none' | 'medianUnitPrice' | 'medianPriceSqft' | 'capitalGrowth' | 'transactionCount' | 'rentalYield' | 'rentStability'

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

// Progressive disclosure by importance (LOD). The busiest markets reveal first
// at city overview; quieter areas appear as you zoom into their neighborhood.
// This is LOSSLESS (every label is reachable by zooming) and deterministic —
// the opposite of letting the collision engine randomly drop crowded labels.
// `rank` is the area's position when all areas are sorted by transaction count
// (0 = busiest). Areas with no transaction data get Infinity → revealed last.
// Ranking by importance (not polygon size) keeps the overview a clean, curated
// set: big-but-quiet desert areas no longer crowd the city core — their color
// fill still marks them, and the name appears once you zoom into the area.
function getMinZoomForRank(rank: number): number {
  if (rank < 12) return 9    // top ~12 busiest markets — visible at city overview
  if (rank < 28) return 10
  if (rank < 50) return 11
  if (rank < 90) return 12
  return 13                   // long tail / no-data — only when zoomed right in
}

// 格式化指标值（按语言：中文 185万，英文 1.85M；中文用户对 K/M 不直观）。
// 不带 "AED" 前缀——地图标签寸土寸金，货币单位由顶部指标条/图例承担。
function formatMetricValue(area: DubaiArea, metric: AreaMetric, lang: string): string {
  switch (metric) {
    case 'medianUnitPrice': {
      // Total median unit price in AED
      const v = area.medianUnitPrice
      if (v === undefined || v === null) return ''
      return formatMoneyCompact(v, lang)
    }
    case 'medianPriceSqft': {
      // medianPriceSqm converted to sqft (1 sqm = 10.764 sqft)
      const v = area.medianPriceSqm
      if (v === undefined || v === null) return ''
      return formatMoneyFull(v / 10.764)
    }
    case 'capitalGrowth': {
      const v = area.capitalAppreciation
      if (v === undefined || v === null) return ''
      return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`
    }
    case 'transactionCount': {
      const v = area.transactionCount
      if (v === undefined || v === null) return ''
      return formatCountCompact(v, lang)
    }
    case 'rentalYield': {
      const v = area.rentalYield
      if (v === undefined || v === null) return ''
      return `${v.toFixed(1)}%`
    }
    case 'rentStability': {
      const v = area.rentStability
      if (v === undefined || v === null) return ''
      return `${Math.round(v)}%`
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
    case 'rentStability': return area.rentStability ?? null
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
import { formatMoneyCompact, formatCountCompact, formatMoneyFull } from '../lib/money'
import DirhamSymbol from './DirhamSymbol'

const ProjectPinMarker = memo(({ project, onClick }: { project: MapPinProject; onClick?: (p: MapPinProject) => void }) => {
  const [isHovered, setIsHovered] = useState(false)
  const [showBelow, setShowBelow] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const isSoldOut = project.status === 'sold-out'

  // Check if marker is near top of viewport
  const handleMouseEnter = useCallback(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect()
      // 顶部 ~120px 是指标/POI 控制面板（z-1000，盖在悬浮卡上面），
      // 卡片自身 ~210px：离顶 320px 内就改为向下弹，避免钻到面板底下
      setShowBelow(rect.top < 320)
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
      // hover 时把整个 marker 容器抬到最上层——悬浮卡是 marker 的子元素，
      // 不抬容器的话会被 DOM 顺序靠后的其他 pin 压住（客户反馈）
      style={{ zIndex: isHovered ? 300 : 2 }}
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
        {/* Hover peek — just a compact name pill. Full info lives in the click
            card (ProjectPreviewCard); the old rich hover tooltip duplicated it. */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            ...(showBelow ? { top: '100%', marginTop: '8px' } : { bottom: '100%', marginBottom: '8px' }),
            transform: 'translateX(-50%)',
            background: 'rgba(15,23,42,0.92)',
            color: '#fff',
            borderRadius: '8px',
            padding: '4px 9px',
            fontSize: '12px',
            fontWeight: 600,
            whiteSpace: 'nowrap',
            boxShadow: '0 4px 14px rgba(0,0,0,0.3)',
            pointerEvents: 'none',
            opacity: isHovered ? 1 : 0,
            visibility: isHovered ? 'visible' : 'hidden',
            transition: 'opacity 0.15s ease',
            zIndex: 9999,
          }}
        >
          {project.name}
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
// Cluster Bubble - round count badge for grouped project pins (supercluster).
// Click zooms in to split the group apart so every pin becomes reachable.
// ============================================================================

const ClusterBubble = memo(({ count, minPrice, lng, lat, onClick }: {
  count: number; minPrice: number | null; lng: number; lat: number; onClick: () => void
}) => {
  const { i18n } = useTranslation()
  const lang = i18n.language || 'en'
  const isZh = lang.startsWith('zh')
  // Count circle grows a touch with group size; the pill also shows the cheapest
  // "from" price in the group so a cluster says something useful, not just a number.
  const circle = count >= 100 ? 32 : count >= 25 ? 29 : count >= 10 ? 26 : 23
  const hasPrice = minPrice != null && isFinite(minPrice) && minPrice > 0
  return (
    <Marker longitude={lng} latitude={lat} anchor="center" style={{ zIndex: 3 }}
      onClick={(e) => { e.originalEvent.stopPropagation(); onClick() }}>
      <div
        className="group flex cursor-pointer select-none items-center rounded-full bg-white py-1 shadow-[0_4px_16px_rgba(0,0,0,0.22)] ring-1 ring-black/5 transition-transform hover:scale-105"
        style={{ paddingLeft: 4, paddingRight: hasPrice ? 10 : 4 }}
      >
        <span
          className="flex items-center justify-center rounded-full font-bold leading-none text-white"
          style={{
            width: circle, height: circle,
            background: 'linear-gradient(135deg, #14b8a6 0%, #0ea5e9 100%)',
            boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.35)',
            fontSize: count >= 100 ? 12.5 : 12,
          }}
        >
          {count}
        </span>
        {hasPrice && (
          <span className="ml-1.5 flex items-center gap-0.5 whitespace-nowrap text-[11px] font-bold leading-none text-slate-700">
            <span className="font-medium text-slate-400">{isZh ? '起' : 'from'}</span>
            <DirhamSymbol size="0.85em" className="text-slate-400" />
            {formatMoneyCompact(minPrice, lang)}
          </span>
        )}
      </div>
    </Marker>
  )
})

// ============================================================================
// Landmark Marker - 3D 扣图建筑立在地图上（与项目 teardrop pin 明确区分）
// ============================================================================

// 本地扣图资源：frontend/public/landmarks/<slug>.png（透明背景 3D 微缩建筑）。
// 命中扣图 → 建筑直接"立"在地图上 + 名称标签；没有 → 退回金圈圆形照片。
const landmarkSlug = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

const LandmarkMarker = memo(({ landmark, onClick }: {
  landmark: DubaiLandmark
  onClick?: (lm: DubaiLandmark) => void
}) => {
  const { i18n } = useTranslation()
  // 扣图加载失败(404/无此地标)时退回圆形照片样式
  const [cutoutFailed, setCutoutFailed] = useState(false)
  // 尺寸收紧：之前 84/68/54 在 z10 全城视野下太抢眼（客户反馈"挤着很乱"）
  const cutoutH = landmark.size === 'large' ? 64 : landmark.size === 'small' ? 42 : 52
  const pinSize = landmark.size === 'large' ? 48 : landmark.size === 'small' ? 32 : 40

  const langKey = i18n.language?.split('-')[0]
  const localizedName = (langKey && landmark.translations?.[langKey]?.name) || landmark.name

  return (
    <Marker
      longitude={landmark.location.lng}
      latitude={landmark.location.lat}
      anchor="bottom"
      // 地标是背景层装饰：永远垫在项目 pin（zIndex 2）和悬浮卡（300）下面
      style={{ zIndex: 1 }}
      onClick={(e) => {
        e.originalEvent.stopPropagation()
        onClick?.(landmark)
      }}
    >
      {/* Outer wrapper scales with zoom via the map-level --lm-scale CSS var
          (set imperatively on zoom; no React re-render). Inner div keeps the
          hover affordance so the two transforms compose. */}
      <div style={{ transform: 'scale(var(--lm-scale, 1))', transformOrigin: 'bottom center', transition: 'transform 0.25s ease' }}>
      <div
        className="cursor-pointer transition-transform duration-150 hover:scale-110"
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}
      >
        {/* 名称标签放建筑上方（本地化），轻量小药丸，避免压住地图 */}
        <div
          style={{
            marginBottom: 1,
            padding: '1px 6px',
            borderRadius: 999,
            background: 'rgba(255,255,255,0.88)',
            fontSize: 10,
            fontWeight: 600,
            color: '#334155',
            whiteSpace: 'nowrap',
            boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
            lineHeight: '14px',
          }}
        >
          {localizedName}
        </div>
        {!cutoutFailed ? (
          <img
            src={`/landmarks/${landmarkSlug(landmark.name)}.png`}
            alt={landmark.name}
            onError={() => setCutoutFailed(true)}
            style={{
              height: cutoutH,
              width: 'auto',
              maxWidth: cutoutH * 1.3,
              objectFit: 'contain',
              filter: 'drop-shadow(0 6px 8px rgba(0,0,0,0.35))',
            }}
            loading="lazy"
          />
        ) : (
          <div
            style={{
              width: pinSize,
              height: pinSize,
              borderRadius: '50%',
              overflow: 'hidden',
              border: '2.5px solid #f59e0b',
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
        )}
      </div>
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
  /** 由语音助手/导览触发的测距：传入点序列即进入测距模式并画线。
   *  noFit=true 时不自动缩放（导览用，避免抢电影运镜的镜头）。 */
  voiceMeasure?: { points: [number, number][]; noFit?: boolean } | null
  /** 由语音助手触发的「区域配套放射图」：从区域中心向最近配套画连线+距离 */
  voiceAmenities?: {
    center: [number, number]; centerName: string; score: number; tier: string
    spokes: { category: string; label: string; emoji: string; name: string; lng: number; lat: number; distanceKm: number }[]
  } | null
  /** Luna Tour: hide all map UI controls (basemap/3D/measure buttons, panels)
   *  so the tour plays full-screen immersive. The map canvas + pins stay. */
  chromeless?: boolean
  /** Luna Tour: make the map UNCONTROLLED so the imperative cinematic camera
   *  (flyTo/orbit/setBearing) runs smoothly — the controlled viewState would
   *  otherwise lag a frame behind and fight it (teleport/jitter). */
  tourActive?: boolean
}

function MapViewMapLibre({
  projects = [],
  onBoundsChange,
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
  voiceAmenities = null,
  chromeless = false,
  tourActive = false
}: MapViewMapLibreProps, ref: React.Ref<MapTourHandle>) {
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

  // 放射模式:第 0 个点=中心,其余每点到中心各一段
  const measureSpokeKms = useMemo(() => {
    if (measurePoints.length < 2) return [] as number[]
    const hub = measurePoints[0]
    return measurePoints.slice(1).map(p => haversineKm(hub, p))
  }, [measurePoints])

  const measureGeoJson = useMemo(() => {
    const fmt = (km: number) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(2)} km`)
    if (measurePoints.length === 0) {
      const empty = { type: 'FeatureCollection' as const, features: [] }
      return { segments: empty, points: empty }
    }
    const hub = measurePoints[0]
    // 中心 → 每个目标点,各一条带距离标签的 LineString(放射状)
    const segments = {
      type: 'FeatureCollection' as const,
      features: measurePoints.slice(1).map(p => ({
        type: 'Feature' as const,
        properties: { label: fmt(haversineKm(hub, p)) },
        geometry: { type: 'LineString' as const, coordinates: [[hub.lng, hub.lat], [p.lng, p.lat]] }
      }))
    }
    return {
      segments,
      points: {
        type: 'FeatureCollection' as const,
        features: measurePoints.map((p, i) => ({
          type: 'Feature' as const,
          properties: { kind: i === 0 ? 'hub' : 'spoke' },
          geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] }
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

  // 语音助手/导览触发测距：进入测距模式、落点、(可选)自动缩放到这些点
  useEffect(() => {
    if (!voiceMeasure || !voiceMeasure.points?.length) {
      // 清空：退出测距模式并移除连线（导览结束/语音清除时调用）
      setMeasureMode(false)
      setMeasurePoints([])
      return
    }
    const pts = voiceMeasure.points.map(([lng, lat]) => ({ lng, lat }))
    setMeasureMode(true)
    setMeasurePoints(pts)
    const map = mapRef.current?.getMap()
    if (map && mapLoaded && pts.length >= 2 && !voiceMeasure.noFit) {
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
            // name = the REAL nearby POI (e.g. "Canadian University Dubai"), so the
            // line clearly lands on a real place, not seemingly-empty land.
            properties: { kind: 'amenity', label: `${s.label} ${s.distanceKm}km`, name: s.name },
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
    zoom: 10.115216007819594,
    pitch: 0,
    bearing: 0
  })

  // 3D 倾斜视角：独立于底图(地图/卫星/夜景都可用)。开启后相机俯角看,
  // 配合电影 flyTo 俯冲。pitchedRef 供 flyTo effect 读取(避免把 pitched 放进
  // effect deps 而触发重复飞行)。
  const CINEMATIC_PITCH = 60
  const [pitched, setPitched] = useState(false)
  const pitchedRef = useRef(false)
  const toggle3D = () => {
    const map = mapRef.current?.getMap()
    if (!map) return
    const next = !pitched
    setPitched(next)
    pitchedRef.current = next
    map.easeTo({ pitch: next ? CINEMATIC_PITCH : 0, duration: 700, essential: true })
  }

  // Expose a cinematic handle so the Luna Tour engine can drive THIS map
  // (camera + lt- overlays). Stable across renders; closes over mapRef.
  useImperativeHandle(
    ref,
    () =>
      createMapTourHandle({
        getMap: () => mapRef.current?.getMap(),
        accent: '#00E0B8',
        darkStyle: MAP_STYLE_DARK,
        defaultStyle: MAP_STYLE_LABELED,
      }),
    []
  )

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
      // 3D 开启时来一段带俯角的电影俯冲;平视时维持原行为
      const dive = pitchedRef.current
      map.flyTo({
        center: [flyToLocation.lng, flyToLocation.lat],
        zoom: flyToLocation.zoom ?? 11,
        pitch: dive ? CINEMATIC_PITCH : 0,
        duration: dive ? 2400 : 2000,
        curve: dive ? 2.0 : 1.8,
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

    // 迪拉姆符号：固定中性色两套（深底图用 light、浅底图用 dark）+ 空占位
    safeAddImage('dirham-light', generateDirhamIcon('#ffffff', 'rgba(0,0,0,0.85)'))
    safeAddImage('dirham-dark', generateDirhamIcon('#334155', '#ffffff'))
    safeAddImage('dirham-none', transparentIcon())

    await Promise.all([...poiIconPromises, ...transportIconPromises, ...routeTypeIconPromises])
  }, [])

  const handleMapLoad = useCallback(async () => {
    const map = mapRef.current?.getMap()
    if (!map) return

    await addCustomIcons(map)

    // 底图切换后 style 重建，重新注入自定义图标
    map.on('style.load', () => { addCustomIcons(map) })

    // Landmark cutouts scale with zoom so they feel painted on the map (not a
    // fixed-size overlay floating above it). Update the CSS var only on ZOOMEND,
    // not every zoom frame: the var is inherited, so writing it to the map
    // container restyles every marker subtree — doing that per frame janked zoom
    // hard (50ms+ frames). A CSS transition on the landmarks smooths the resize
    // once the zoom settles. Gentle + clamped (shrink on zoom-out without
    // vanishing, don't dominate on zoom-in).
    const updateLandmarkScale = () => {
      const s = Math.min(2.2, Math.max(0.5, Math.pow(1.4, map.getZoom() - 12)))
      map.getContainer().style.setProperty('--lm-scale', s.toFixed(3))
    }
    updateLandmarkScale()
    map.on('zoomend', updateLandmarkScale)

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

  // ─── Project pin clustering (supercluster) ────────────────────────────────
  // Group overlapping project pins into a count bubble so the back pins stay
  // reachable; clicking a bubble zooms in to split them apart. Recomputed only
  // when the camera settles (moveEnd) — markers are geo-anchored so they pan
  // correctly without per-frame work.
  const superclusterIndex = useMemo(() => {
    // Aggregate the cheapest "from" price across each cluster so the bubble can
    // show it (Infinity = no priced project in the group).
    const idx = new Supercluster<{ project: MapPinProject }, { minPrice: number }>({
      radius: 56, maxZoom: 16,
      map: (props) => ({ minPrice: props.project?.minPrice ?? Infinity }),
      reduce: (acc, props) => { if (props.minPrice < acc.minPrice) acc.minPrice = props.minPrice },
    })
    idx.load(projects.map(p => ({
      type: 'Feature' as const,
      properties: { project: p },
      geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
    })))
    return idx
  }, [projects])

  const [clusterFeatures, setClusterFeatures] = useState<any[]>([])
  const recomputeClusters = useCallback(() => {
    const map = mapRef.current?.getMap()
    if (!map) return
    const b = map.getBounds()
    const zoom = Math.round(map.getZoom())
    setClusterFeatures(
      superclusterIndex.getClusters([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], zoom)
    )
  }, [superclusterIndex])

  useEffect(() => {
    if (mapLoaded) recomputeClusters()
  }, [mapLoaded, recomputeClusters])

  const zoomToCluster = useCallback((clusterId: number, lng: number, lat: number) => {
    const expansionZoom = Math.min(superclusterIndex.getClusterExpansionZoom(clusterId), 18)
    mapRef.current?.getMap()?.flyTo({ center: [lng, lat], zoom: expansionZoom, duration: 600 })
  }, [superclusterIndex])

  // Warm the browser HTTP cache with the satellite tiles for the NEXT 1-2 zoom
  // levels over the current viewport, so a subsequent zoom-in shows sharp tiles
  // instantly instead of the blocky upscaled-parent → pop-in-one-by-one look.
  // MapLibre 5 has no prefetch API; warming via Image() is basemap-agnostic.
  // IMPORTANT: this is scheduled (debounced) for AFTER the user goes idle, and
  // the image requests are dripped out a few at a time — firing a 64-image burst
  // on every moveEnd janked continuous zoom hard (it competed with rendering).
  const prefetchedRef = useRef<Set<string>>(new Set())
  const prefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prefetchSatelliteAhead = useCallback(() => {
    if (baseMap !== 'satellite' || !MAPTILER_KEY || tourActive) return
    const map = mapRef.current?.getMap()
    if (!map) return
    const b = map.getBounds()
    const z0 = Math.round(map.getZoom())
    const seen = prefetchedRef.current
    if (seen.size > 1500) seen.clear()
    const urls: string[] = []
    for (const z of [z0 + 1, z0 + 2]) {
      if (z < 1 || z > 20) continue
      const n = 2 ** z
      const xMin = Math.floor(((b.getWest() + 180) / 360) * n)
      const xMax = Math.floor(((b.getEast() + 180) / 360) * n)
      const yMin = lat2tileY(b.getNorth(), z)
      const yMax = lat2tileY(b.getSouth(), z)
      if ((xMax - xMin + 1) * (yMax - yMin + 1) > 40) continue
      for (let x = xMin; x <= xMax && urls.length < 40; x++) {
        for (let y = yMin; y <= yMax && urls.length < 40; y++) {
          if (y < 0 || y >= n) continue
          const xx = ((x % n) + n) % n
          const url = `https://api.maptiler.com/tiles/satellite-v2/${z}/${xx}/${y}.jpg?key=${MAPTILER_KEY}`
          if (seen.has(url)) continue
          seen.add(url)
          urls.push(url)
        }
      }
    }
    // Drip a few requests per tick so warming never blocks a frame.
    let i = 0
    const step = () => {
      for (let k = 0; k < 4 && i < urls.length; k++) {
        const img = new Image()
        img.decoding = 'async'
        img.src = urls[i++]
      }
      if (i < urls.length) setTimeout(step, 60)
    }
    step()
  }, [baseMap, tourActive])

  // Schedule a prefetch only once the user has been idle ~600ms — never during a
  // continuous zoom/pan gesture.
  const schedulePrefetch = useCallback(() => {
    if (prefetchTimerRef.current) clearTimeout(prefetchTimerRef.current)
    prefetchTimerRef.current = setTimeout(prefetchSatelliteAhead, 600)
  }, [prefetchSatelliteAhead])

  // Warm tiles once after load + whenever the basemap changes to satellite.
  useEffect(() => {
    if (mapLoaded) schedulePrefetch()
  }, [mapLoaded, schedulePrefetch])

  const handleMoveEnd = useCallback(() => {
    recomputeClusters()
    schedulePrefetch()
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
  }, [onBoundsChange, recomputeClusters, schedulePrefetch])

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

  // Area labels GeoJSON - 区域名称 + 指标值（同一图层）
  // 指标值和名称必须在同一个 symbol，否则两个 layer 的碰撞检测会互相
  // 淘汰：看指标时区域名就消失了（客户反馈）。合并后名字+数值永远一起显示。
  const areaLabelsGeoJson = useMemo(() => {
    if (!showDubaiLayer || !dubaiAreas.length || !mapLoaded) return null

    const langKey = i18n.language?.split('-')[0]
    const lang = i18n.language || 'en'

    // 计算分位数用于指标值着色
    let percentiles = { p25: 0, p50: 0, p75: 0 }
    if (areaMetric !== 'none') {
      const values = dubaiAreas
        .map(area => getMetricRawValue(area, areaMetric))
        .filter((v): v is number => v !== null)
      percentiles = calculatePercentiles(values)
    }

    // Importance ranking for progressive disclosure: sort by transaction count
    // (busiest first). Each area's rank drives WHEN its label is revealed, so the
    // low-zoom view is a clean, curated set of the most relevant markets instead
    // of a random subset the collision engine happened to keep.
    const rankById: Record<string, number> = {}
    ;[...dubaiAreas]
      .sort((a, b) => (b.transactionCount ?? -1) - (a.transactionCount ?? -1))
      .forEach((area, i) => {
        rankById[area.id] = area.transactionCount != null ? i : Infinity
      })

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
        // Reveal threshold driven purely by importance (transaction rank), so the
        // overview shows only the busiest markets and the rest unfold on zoom.
        const rank = rankById[area.id] ?? Infinity
        const minZoom = getMinZoomForRank(rank)
        const translatedName = langKey ? area.translations?.[langKey]?.name : undefined

        // 单行本地化名称：中文界面只显示中文（原来英中两行 ×100+ 区域是地图
        // 拥挤的最大来源；客户反馈"挤着很乱"后改为单行）
        const displayName = translatedName || area.name

        let metricValue = ''
        let metricColor = '#94a3b8'
        if (areaMetric !== 'none') {
          metricValue = formatMetricValue(area, areaMetric, lang)
          const rawValue = getMetricRawValue(area, areaMetric)
          metricColor = getHeatmapColor(rawValue, areaMetric, percentiles)
        }

        return {
          type: 'Feature' as const,
          properties: {
            name: area.name,
            translatedName: translatedName || '',
            span,
            minZoom,
            displayName,
            metricValue,
            metricColor
          },
          geometry: { type: 'Point' as const, coordinates: centroid }
        }
      })

    return { type: 'FeatureCollection' as const, features }
  }, [dubaiAreas, showDubaiLayer, mapLoaded, i18n.language, areaMetric])

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
        {...(tourActive ? { initialViewState: viewState } : viewState)}
        onMove={evt => { if (!tourActive) setViewState(evt.viewState) }}
        onMoveEnd={handleMoveEnd}
        onLoad={handleMapLoad}
        attributionControl={false}
        // Keep more raster tiles cached so zooming in/out and back doesn't refetch
        // (and re-pixelate) tiles already seen this session.
        maxTileCacheSize={600}
        // CJK (Chinese area/POI names) render locally with a system font instead
        // of being fetched from the glyph server — fast, and the openmaptiles
        // glyph server doesn't carry CJK anyway. Latin/symbols still come from
        // the style's glyphs URL (now a fontstack the server actually serves).
        localIdeographFontFamily="'PingFang SC', 'Microsoft YaHei', sans-serif"
        style={{ width: '100%', height: '100%' }}
        mapStyle={
          baseMap === 'satellite'
            ? SATELLITE_STYLE
            : baseMap === 'dark'
            ? MAP_STYLE_DARK
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
        {/* Area Polygons — always shown (soft default colours give customers
            orientation via area names; the tour toggles a metric to reveal value) */}
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
                  ['*', ['get', 'opacity'], 0.4]   // normal: soft (matches production)
                ]
              }}
            />
          </Source>
        )}

        {/* Area Labels - 区域名称 (始终显示；选指标时数值以 format 段追加在名称下方,
            同一 symbol 保证名字和数值要么一起显示要么一起隐藏) */}
        {mapLoaded && areaLabelsGeoJson && (
          <Source id="area-labels" type="geojson" data={areaLabelsGeoJson}>
            <Layer
              id="area-label-text"
              type="symbol"
              filter={['<=', ['get', 'minZoom'], ['zoom']]}
              layout={{
                'text-field': areaMetric === 'none'
                  ? ['get', 'displayName']
                  : (areaMetric === 'medianUnitPrice' || areaMetric === 'medianPriceSqft')
                  // 金额指标：数值前嵌迪拉姆官方符号——固定中性色（像 ¥/$），
                  // 与数字隔一个空格；没有数值的区域用透明占位图（不显示符号）
                  ? ['format',
                      ['get', 'displayName'], {},
                      '\n', {},
                      ['image', ['concat', 'dirham-',
                        ['case', ['==', ['get', 'metricValue'], ''], 'none',
                          (baseMap === 'satellite' || baseMap === 'dark') ? 'light' : 'dark']
                      ]], {},
                      ['case', ['==', ['get', 'metricValue'], ''], '', ' '], {},
                      ['get', 'metricValue'], {
                        'text-color': ['get', 'metricColor'],
                        'font-scale': 1.25
                      }
                    ]
                  : ['format',
                      ['get', 'displayName'], {},
                      '\n', {},
                      ['get', 'metricValue'], {
                        'text-color': ['get', 'metricColor'],
                        'font-scale': 1.25
                      }
                    ],
                'text-font': ['Open Sans Bold'],
                // Keep labels flat-on-screen + upright no matter the bearing/pitch,
                // so the cinematic orbit doesn't tilt or rotate the area names.
                'text-rotation-alignment': 'viewport',
                'text-pitch-alignment': 'viewport',
                'text-size': [
                  'interpolate', ['linear'], ['zoom'],
                  8, 8,    // 更小的字体
                  10, 9,
                  12, 10,
                  14, 11,
                  16, 12
                ],
                'text-anchor': 'center',
                // Elegant declutter: NEVER force overlap. Let MapLibre's collision
                // engine drop labels that would collide and show them again once the
                // user zooms in far enough for them to breathe. The old `zoom>=12 →
                // allow-overlap:true` is exactly what crammed every badge on top of
                // each other. symbol-sort-key (lower minZoom = more prominent area)
                // decides who wins a collision, so the important areas always show.
                'text-allow-overlap': false,
                'text-padding': [
                  'interpolate', ['linear'], ['zoom'],
                  8, 8,    // city overview: generous spacing
                  11, 6,
                  14, 4,
                  16, 2    // zoomed in: labels are far apart anyway
                ],
                'symbol-sort-key': ['get', 'minZoom']
              }}
              paint={{
                // Dark basemaps (satellite/dark) → light text + dark halo so the
                // area name stays readable; light vector → original dark-on-white.
                'text-color': (baseMap === 'satellite' || baseMap === 'dark') ? '#ffffff' : '#334155',
                'text-halo-color': (baseMap === 'satellite' || baseMap === 'dark') ? 'rgba(0,0,0,0.85)' : '#ffffff',
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

            {/* Station labels - show at higher zoom. Hidden during cinematic tour
                playback (chromeless): the seeded names are placeholders ("New Stop
                N") and read as debug noise over the immersive view. Station dots +
                route lines stay; names return on pause. */}
            {!chromeless && (
            <Layer
              id="transport-stations-labels"
              type="symbol"
              filter={['all',
                ['in', ['get', 'category'], ['literal', ['metro_stations', 'tram_stations', 'monorail_stations']]],
                ['>=', ['zoom'], 13]
              ]}
              layout={{
                'text-field': ['get', 'name'],
                'text-font': ['Open Sans Bold'],
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
            )}

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
            {/* POI names — only at high zoom so they don't crowd the map. Lets the
                AI demo point at a real named place ("GEMS School") instead of a bare
                icon. text-optional drops labels that would collide. */}
            <Layer
              id="poi-labels"
              type="symbol"
              minzoom={14.5}
              layout={{
                'text-field': ['get', 'name'],
                'text-font': ['Open Sans Bold'],
                'text-size': ['interpolate', ['linear'], ['zoom'], 14.5, 10, 17, 13],
                'text-offset': [0, 1.2],
                'text-anchor': 'top',
                'text-max-width': 8,
                'text-allow-overlap': false,
                'text-optional': true
              }}
              paint={{
                'text-color': ['get', 'color'],
                'text-halo-color': '#ffffff',
                'text-halo-width': 1.8
              }}
            />
          </Source>
        )}

        {/* Landmarks 永远显示——tour 和首页必须是同一张地图（客户要求）。
            只有 ~15 个，运镜逐帧重定位它们开销可忽略，不触发 Perf rule R2。
            Clusters（可能几百个）才是会抖动 flyTo 的 marker 海，tour 时仍隐藏；
            项目 pin 在 tour 模式下本来就只有 2-3 个 tour 房源。 */}
        {dubaiLandmarks.map(lm => (
          <LandmarkMarker key={lm.id} landmark={lm} onClick={onLandmarkClick} />
        ))}
        {/* Tour mode: render the 2-3 tour pins directly (no clustering). Normal
            mode: render supercluster output — count bubbles + single pins. */}
        {tourActive
          ? projects.map(project => (
              <ProjectPinMarker key={project.id} project={project} onClick={onProjectClick} />
            ))
          : clusterFeatures.map(f => {
              const [lng, lat] = f.geometry.coordinates
              if (f.properties.cluster) {
                return (
                  <ClusterBubble
                    key={`cluster-${f.properties.cluster_id}`}
                    count={f.properties.point_count}
                    minPrice={isFinite(f.properties.minPrice) ? f.properties.minPrice : null}
                    lng={lng}
                    lat={lat}
                    onClick={() => zoomToCluster(f.properties.cluster_id, lng, lat)}
                  />
                )
              }
              const project = f.properties.project as MapPinProject
              return (
                <ProjectPinMarker key={project.id} project={project} onClick={onProjectClick} />
              )
            })}

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
                  'text-font': ['Open Sans Bold'],
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
                  'circle-radius': ['case', ['==', ['get', 'kind'], 'hub'], 8, 5],
                  'circle-color': ['case', ['==', ['get', 'kind'], 'hub'], '#dc2626', '#2563eb'],
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
                  'text-font': ['Open Sans Bold'],
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
                  'text-font': ['Open Sans Bold'],
                  'text-size': 13,
                  'text-offset': [0, 1.4],
                  'text-anchor': 'top'
                }}
                paint={{ 'text-color': '#065f46', 'text-halo-color': '#ffffff', 'text-halo-width': 2 }}
              />
              {/* real POI name at each amenity endpoint — so "学校 0.42km" visibly
                  lands on "Canadian University Dubai", not seemingly-empty land */}
              <Layer
                id="amenity-poi-label"
                type="symbol"
                filter={['==', ['get', 'kind'], 'amenity']}
                layout={{
                  'text-field': ['get', 'name'],
                  'text-font': ['Open Sans Bold'],
                  'text-size': 11,
                  'text-offset': [0, 1.1],
                  'text-anchor': 'top',
                  'text-max-width': 9,
                  'text-allow-overlap': false,
                  'text-optional': true
                }}
                paint={{ 'text-color': '#b45309', 'text-halo-color': '#ffffff', 'text-halo-width': 2 }}
              />
            </Source>
          </>
        )}
      </Map>

      {!chromeless && (<>
      {/* 底图切换：地图 → 卫星 → 夜景 循环，放右上角（在指标条与 POI 按钮下方，避免重叠） */}
      <button
        type="button"
        onClick={() =>
          setBaseMap(prev =>
            prev === 'vector' ? 'satellite' : prev === 'satellite' ? 'dark' : 'vector'
          )
        }
        className={`absolute top-28 right-4 z-[1000] flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium shadow-lg ring-1 backdrop-blur transition ${
          baseMap === 'dark'
            ? 'bg-slate-900/90 text-slate-100 ring-slate-700 hover:bg-slate-900'
            : 'bg-white/95 text-slate-700 ring-slate-200 hover:bg-white'
        }`}
        title="切换底图：地图 / 卫星 / 夜景"
        aria-label="切换底图"
      >
        <Globe
          size={15}
          className={
            baseMap === 'satellite'
              ? 'text-emerald-600'
              : baseMap === 'dark'
              ? 'text-emerald-400'
              : 'text-slate-500'
          }
        />
        {baseMap === 'vector' ? '地图' : baseMap === 'satellite' ? '卫星' : '夜景'}
      </button>

      {/* 3D 倾斜：独立于底图，地图/卫星/夜景都可用 */}
      <button
        type="button"
        onClick={toggle3D}
        className={`absolute top-28 right-24 z-[1000] flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold shadow-lg ring-1 backdrop-blur transition ${
          pitched
            ? 'bg-emerald-500 text-white ring-emerald-400 hover:bg-emerald-500'
            : 'bg-white/95 text-slate-700 ring-slate-200 hover:bg-white'
        }`}
        title={pitched ? '切回平视 (2D)' : '3D 倾斜视角'}
        aria-label="切换 3D 倾斜视角"
      >
        3D
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

      {/* 测距状态条(极简,距离已画在地图线上) */}
      {measureMode && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-[1000] flex items-center gap-2 whitespace-nowrap rounded-full bg-white/95 px-3.5 py-1.5 text-xs shadow-lg ring-1 ring-slate-200 backdrop-blur">
          <span className="font-medium text-slate-700">
            {measurePoints.length === 0
              ? '点地图设中心点'
              : measurePoints.length === 1
                ? '已设中心 · 点击添加地点'
                : `中心 + ${measureSpokeKms.length} 个地点`}
          </span>
          {measurePoints.length > 0 && (
            <button
              type="button"
              onClick={() => setMeasurePoints([])}
              className="font-semibold text-blue-600"
            >
              清除
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
      </>)}
    </div>
  )
}

export default memo(forwardRef<MapTourHandle, MapViewMapLibreProps>(MapViewMapLibre))
