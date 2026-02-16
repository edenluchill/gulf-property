/**
 * MapLibre GL JS 地图组件 - 简洁高效版
 */

import { useState, useRef, useMemo, useCallback, memo } from 'react'
import Map, {
  Marker,
  Source,
  Layer,
  MapRef
} from 'react-map-gl/maplibre'
import type { MapLayerMouseEvent } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useTranslation } from 'react-i18next'
import type { LucideIcon } from 'lucide-react'
import {
  Cross, GraduationCap, TrainFront, ShoppingBag, Landmark,
  Utensils, Hotel, TreePine, Building2, ShieldAlert, Fuel
} from 'lucide-react'
import { DubaiArea, DubaiLandmark } from '../types'
import { Poi } from '../hooks/useDubaiPois'

// 使用 CARTO 无标签风格 (area 自己有名字，不需要地图标签)
const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/voyager-nolabels-gl-style/style.json'

// Group colors (unified per category group)
const GROUP_COLORS: Record<string, string> = {
  healthcare: '#0d9488',  // teal - hospital friendly
  education: '#2563eb',   // blue
  transport: '#ea580c',   // orange
  shopping: '#db2777',    // pink
  dining: '#d97706',      // amber
  finance: '#059669',     // emerald
  leisure: '#7c3aed',     // violet
  services: '#475569',    // slate
}

// Map POI categories to icons and groups
const POI_CONFIG: Record<string, { icon: LucideIcon; group: string }> = {
  // Healthcare
  hospital: { icon: Cross, group: 'healthcare' },
  clinic: { icon: Cross, group: 'healthcare' },
  pharmacy: { icon: Cross, group: 'healthcare' },
  // Education
  school: { icon: GraduationCap, group: 'education' },
  university: { icon: GraduationCap, group: 'education' },
  // Transport
  metro_station: { icon: TrainFront, group: 'transport' },
  bus_station: { icon: TrainFront, group: 'transport' },
  // Shopping
  mall: { icon: ShoppingBag, group: 'shopping' },
  supermarket: { icon: ShoppingBag, group: 'shopping' },
  // Dining
  restaurant: { icon: Utensils, group: 'dining' },
  cafe: { icon: Utensils, group: 'dining' },
  // Finance
  bank: { icon: Landmark, group: 'finance' },
  atm: { icon: Landmark, group: 'finance' },
  // Leisure
  hotel: { icon: Hotel, group: 'leisure' },
  park: { icon: TreePine, group: 'leisure' },
  gym: { icon: TreePine, group: 'leisure' },
  beach: { icon: TreePine, group: 'leisure' },
  cinema: { icon: TreePine, group: 'leisure' },
  // Services
  gas_station: { icon: Fuel, group: 'services' },
  mosque: { icon: Building2, group: 'services' },
  church: { icon: Building2, group: 'services' },
  police: { icon: ShieldAlert, group: 'services' },
  fire_station: { icon: ShieldAlert, group: 'services' },
  post_office: { icon: Building2, group: 'services' },
  embassy: { icon: Building2, group: 'services' },
}

// Get icon and color for a POI category
function getPoiIconConfig(category: string) {
  const config = POI_CONFIG[category] || { icon: Building2, group: 'services' }
  return {
    Icon: config.icon,
    color: GROUP_COLORS[config.group] || '#6b7280'
  }
}

export type AreaMetric = 'none' | 'avgPrice' | 'capitalGrowth' | 'salesVolume' | 'rentalYield'

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
    case 'avgPrice': {
      const v = area.averagePrice
      if (v === undefined || v === null) return ''
      if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M`
      if (v >= 1000) return `${Math.round(v / 1000)}K`
      return `${v}`
    }
    case 'capitalGrowth': {
      const v = area.capitalAppreciation
      if (v === undefined || v === null) return ''
      return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`
    }
    case 'salesVolume': {
      const v = area.salesVolume
      if (v === undefined || v === null) return ''
      if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M`
      if (v >= 1000) return `${Math.round(v / 1000)}K`
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
    case 'avgPrice': return area.averagePrice ?? null
    case 'capitalGrowth': return area.capitalAppreciation ?? null
    case 'salesVolume': return area.salesVolume ?? null
    case 'rentalYield': return area.rentalYield ?? null
    default: return null
  }
}

// 热力图颜色计算
// capitalGrowth: 绿色=正增长, 红色=负增长
// 其他指标: 绿色=高值, 黄色=中值, 红色=低值
function getHeatmapColor(value: number | null, metric: AreaMetric, min: number, max: number): string {
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

  // 其他指标: 用渐变色表示相对高低
  const range = max - min
  if (range === 0) return '#3b82f6'

  const normalized = (value - min) / range // 0-1

  if (normalized >= 0.8) return '#059669'  // 深绿 (top 20%)
  if (normalized >= 0.6) return '#10b981'  // 绿色
  if (normalized >= 0.4) return '#fbbf24'  // 黄色
  if (normalized >= 0.2) return '#f97316'  // 橙色
  return '#ef4444'                          // 红色 (bottom 20%)
}

// ============================================================================
// Cluster Marker - 简洁版
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

interface MapViewMapLibreProps {
  clusters: any[]
  onBoundsChange?: (bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number }, zoom: number) => void
  onClusterClick?: (cluster: any) => void
  onAreaClick?: (area: DubaiArea) => void
  onPoiClick?: (poi: Poi) => void
  areaMetric?: AreaMetric
  dubaiAreas?: DubaiArea[]
  dubaiLandmarks?: DubaiLandmark[]
  pois?: Poi[]
  showDubaiLayer?: boolean
  showPois?: boolean
}

function MapViewMapLibre({
  clusters,
  onBoundsChange,
  onClusterClick,
  onAreaClick,
  onPoiClick,
  areaMetric = 'none',
  dubaiAreas = [],
  dubaiLandmarks: _dubaiLandmarks = [],
  pois = [],
  showDubaiLayer = false,
  showPois = false
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
    zoom: 11
  })

  // 地图加载完成后再渲染 layers
  const handleMapLoad = useCallback(() => {
    const map = mapRef.current?.getMap()
    if (!map) return

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

    // 计算指标的 min/max 用于热力图
    let minValue = Infinity, maxValue = -Infinity
    if (areaMetric !== 'none') {
      for (const area of dubaiAreas) {
        const v = getMetricRawValue(area, areaMetric)
        if (v !== null) {
          if (v < minValue) minValue = v
          if (v > maxValue) maxValue = v
        }
      }
    }

    const features = dubaiAreas
      .filter(area => area.boundary?.type === 'Polygon')
      .map(area => {
        // 如果选择了指标，使用热力图颜色
        let fillColor = area.color || '#3b82f6'
        if (areaMetric !== 'none') {
          const rawValue = getMetricRawValue(area, areaMetric)
          fillColor = getHeatmapColor(rawValue, areaMetric, minValue, maxValue)
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

    // 计算 min/max
    let minValue = Infinity, maxValue = -Infinity
    for (const area of dubaiAreas) {
      const v = getMetricRawValue(area, areaMetric)
      if (v !== null) {
        if (v < minValue) minValue = v
        if (v > maxValue) maxValue = v
      }
    }

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
        const metricColor = getHeatmapColor(rawValue, areaMetric, minValue, maxValue)

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

  // Visible POIs (limited for performance)
  const visiblePois = useMemo(() => {
    if (!showPois || !pois.length || !mapLoaded) return []
    // Limit to 200 POIs for performance with React Markers
    return pois.slice(0, 200)
  }, [pois, showPois, mapLoaded])

  // Area hover handlers
  const handleMouseMove = useCallback((e: MapLayerMouseEvent) => {
    if (e.features?.length) {
      setHoveredAreaId(e.features[0].properties?.id || null)
    }
  }, [])

  const handleMouseLeave = useCallback(() => {
    setHoveredAreaId(null)
  }, [])

  const handleMapClick = useCallback((e: MapLayerMouseEvent) => {
    if (!e.features?.length) return

    const feature = e.features[0]
    const layerId = feature.layer?.id

    // Handle area click
    if (layerId === 'area-fills' && onAreaClick) {
      const areaId = feature.properties?.id
      const area = dubaiAreas.find(a => a.id === areaId)
      if (area) onAreaClick(area)
    }
  }, [dubaiAreas, pois, onAreaClick, onPoiClick])

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
          ...(areasGeoJson ? ['area-fills'] : [])
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

        {/* Area Labels - 区域名称 */}
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
                  8, 10,
                  12, 12,
                  14, 14
                ],
                'text-anchor': 'center',
                'text-offset': areaMetric !== 'none' ? [0, -0.8] : [0, 0],  // 有指标时向上偏移
                'text-allow-overlap': false,
                'text-padding': 10,
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
                'text-offset': [0, 0.8],  // 向下偏移，显示在名称下方
                'text-allow-overlap': false,
                'text-padding': 5,
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

        {/* POI Markers - React Markers with Lucide Icons */}
        {visiblePois.map(poi => {
          const { Icon, color } = getPoiIconConfig(poi.category)

          return (
            <Marker
              key={poi.id}
              longitude={poi.lng}
              latitude={poi.lat}
              anchor="center"
              onClick={(e) => {
                e.originalEvent.stopPropagation()
                onPoiClick?.(poi)
              }}
            >
              <div
                className="flex items-center justify-center w-7 h-7 rounded-full shadow-md border-2 border-white cursor-pointer hover:scale-110 transition-transform"
                style={{ backgroundColor: color }}
              >
                <Icon size={14} color="white" strokeWidth={2.5} />
              </div>
            </Marker>
          )
        })}

        {/* Cluster Markers */}
        {clusters.map(cluster => (
          <ClusterMarker
            key={cluster.cluster_id}
            cluster={cluster}
            onClick={onClusterClick}
          />
        ))}
      </Map>
    </div>
  )
}

export default memo(MapViewMapLibre)
