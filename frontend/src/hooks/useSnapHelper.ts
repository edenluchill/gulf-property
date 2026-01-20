import { useEffect, useRef } from 'react'
import L from 'leaflet'

interface SnapHelperOptions {
  map: L.Map
  snapDistance?: number // in pixels
  enabled: boolean
}

/**
 * 高级 Snap 辅助 Hook
 * 提供视觉反馈和更精确的吸附功能
 */
export function useSnapHelper({ map, snapDistance = 20, enabled }: SnapHelperOptions) {
  const snapIndicatorRef = useRef<L.CircleMarker | null>(null)
  const snapLineRef = useRef<L.Polyline | null>(null)

  useEffect(() => {
    if (!enabled) {
      // 清理指示器
      if (snapIndicatorRef.current) {
        map.removeLayer(snapIndicatorRef.current)
        snapIndicatorRef.current = null
      }
      if (snapLineRef.current) {
        map.removeLayer(snapLineRef.current)
        snapLineRef.current = null
      }
      return
    }

    // 创建吸附指示器（小圆圈）
    // const createSnapIndicator = () => {
    //   if (snapIndicatorRef.current) return snapIndicatorRef.current

    //   const indicator = L.circleMarker([0, 0], {
    //     radius: 8,
    //     color: '#3B82F6',
    //     fillColor: '#60A5FA',
    //     fillOpacity: 0.8,
    //     weight: 3,
    //     interactive: false,
    //   })

    //   snapIndicatorRef.current = indicator
    //   return indicator
    // }

    // 创建吸附线（辅助线）
    // const createSnapLine = () => {
    //   if (snapLineRef.current) return snapLineRef.current

    //   const line = L.polyline([], {
    //     color: '#3B82F6',
    //     weight: 2,
    //     dashArray: '5, 5',
    //     opacity: 0.6,
    //     interactive: false,
    //   })

    //   snapLineRef.current = line
    //   return line
    // }

    // 显示吸附提示
    // const showSnapIndicator = (latlng: L.LatLng) => {
    //   const indicator = createSnapIndicator()
    //   indicator.setLatLng(latlng)
    //   if (!map.hasLayer(indicator)) {
    //     indicator.addTo(map)
    //   }
    // }

    // 隐藏吸附提示
    const hideSnapIndicator = () => {
      if (snapIndicatorRef.current && map.hasLayer(snapIndicatorRef.current)) {
        map.removeLayer(snapIndicatorRef.current)
      }
    }

    // 显示吸附线
    // const showSnapLine = (from: L.LatLng, to: L.LatLng) => {
    //   const line = createSnapLine()
    //   line.setLatLngs([from, to])
    //   if (!map.hasLayer(line)) {
    //     line.addTo(map)
    //   }
    // }

    // 隐藏吸附线
    const hideSnapLine = () => {
      if (snapLineRef.current && map.hasLayer(snapLineRef.current)) {
        map.removeLayer(snapLineRef.current)
      }
    }

    // 监听绘制事件
    const onVertexAdded = (e: any) => {
      // 当添加顶点时显示吸附效果
      console.log('Vertex added:', e.latlng)
    }

    const onDrawStart = () => {
      console.log('Drawing started')
    }

    const onDrawEnd = () => {
      hideSnapIndicator()
      hideSnapLine()
    }

    map.on('pm:drawstart', onDrawStart)
    map.on('pm:drawend', onDrawEnd)
    map.on('pm:vertexadded', onVertexAdded)

    return () => {
      map.off('pm:drawstart', onDrawStart)
      map.off('pm:drawend', onDrawEnd)
      map.off('pm:vertexadded', onVertexAdded)
      hideSnapIndicator()
      hideSnapLine()
    }
  }, [map, enabled, snapDistance])

  return {
    // 可以暴露一些方法供外部使用
    isEnabled: enabled,
  }
}

/**
 * 查找最近的顶点
 */
export function findNearestVertex(
  point: L.LatLng,
  polygons: L.Polygon[],
  map: L.Map,
  maxDistance: number = 20 // pixels
): L.LatLng | null {
  let nearestVertex: L.LatLng | null = null
  let minDistance = Infinity

  polygons.forEach(polygon => {
    const latlngs = polygon.getLatLngs()[0] as L.LatLng[]
    
    latlngs.forEach(vertex => {
      const pixelPoint = map.latLngToContainerPoint(point)
      const vertexPixel = map.latLngToContainerPoint(vertex)
      
      const distance = pixelPoint.distanceTo(vertexPixel)
      
      if (distance < maxDistance && distance < minDistance) {
        minDistance = distance
        nearestVertex = vertex
      }
    })
  })

  return nearestVertex
}

/**
 * 查找最近的线段点
 */
export function findNearestPointOnSegment(
  point: L.LatLng,
  polygons: L.Polygon[],
  map: L.Map,
  maxDistance: number = 20
): L.LatLng | null {
  let nearestPoint: L.LatLng | null = null
  let minDistance = Infinity

  polygons.forEach(polygon => {
    const latlngs = polygon.getLatLngs()[0] as L.LatLng[]
    
    for (let i = 0; i < latlngs.length - 1; i++) {
      const segmentStart = latlngs[i]
      const segmentEnd = latlngs[i + 1]
      
      const closestPoint = closestPointOnSegment(point, segmentStart, segmentEnd, map)
      const pixelPoint = map.latLngToContainerPoint(point)
      const closestPixel = map.latLngToContainerPoint(closestPoint)
      
      const distance = pixelPoint.distanceTo(closestPixel)
      
      if (distance < maxDistance && distance < minDistance) {
        minDistance = distance
        nearestPoint = closestPoint
      }
    }
  })

  return nearestPoint
}

/**
 * 计算点到线段的最近点
 */
function closestPointOnSegment(
  point: L.LatLng,
  segmentStart: L.LatLng,
  segmentEnd: L.LatLng,
  map: L.Map
): L.LatLng {
  const p = map.latLngToContainerPoint(point)
  const a = map.latLngToContainerPoint(segmentStart)
  const b = map.latLngToContainerPoint(segmentEnd)

  const dx = b.x - a.x
  const dy = b.y - a.y

  if (dx === 0 && dy === 0) {
    return segmentStart
  }

  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)))

  const closest = L.point(a.x + t * dx, a.y + t * dy)

  return map.containerPointToLatLng(closest)
}

/**
 * 对齐到网格
 */
export function snapToGrid(
  lat: number,
  lng: number,
  gridSize: number = 0.0001 // ~11 meters at equator
): { lat: number; lng: number } {
  return {
    lat: Math.round(lat / gridSize) * gridSize,
    lng: Math.round(lng / gridSize) * gridSize,
  }
}
