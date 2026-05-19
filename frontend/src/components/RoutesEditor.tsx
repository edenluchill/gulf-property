/**
 * Routes Editor - Draw routes and place stops on the map
 *
 * Split into two parts:
 * - RoutesMapController: Renders inside MapContainer, handles map interactions
 * - RoutesSidebar: Renders in sidebar, handles UI
 */

import { useState, useEffect, useRef, useCallback, createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { useMap } from 'react-leaflet'
import { Button } from './ui/button'
import { Route, Circle, TrainFront, TramFront, Bus, Cable, Ship } from 'lucide-react'
import {
  CustomRoute,
  CustomStop,
  fetchCustomRoutes,
  createCustomRoute,
  updateCustomRoute,
  deleteCustomRoute,
  createCustomStop,
  updateCustomStop,
  deleteCustomStop,
  batchUpdateStops,
} from '../lib/api'
import L from 'leaflet'

export type RoutesEditMode = 'idle' | 'drawing-route'

// Route type → icon config (matches MapPage)
const ROUTE_TYPE_ICONS: Record<string, { Icon: any }> = {
  metro: { Icon: TrainFront },
  tram: { Icon: TramFront },
  bus: { Icon: Bus },
  monorail: { Icon: Cable },
  ferry: { Icon: Ship },
  custom: { Icon: Circle },
}

// SVG path cache to avoid re-rendering on every icon creation
const svgPathCache = new Map<string, string>()
function getIconSvgPaths(routeType: string): string {
  if (svgPathCache.has(routeType)) return svgPathCache.get(routeType)!
  const { Icon } = ROUTE_TYPE_ICONS[routeType] || ROUTE_TYPE_ICONS.custom
  const fullSvg = renderToStaticMarkup(
    createElement(Icon, { size: 24, stroke: '#ffffff', strokeWidth: 2.5, fill: 'none' })
  )
  const paths = fullSvg
    .replace(/<svg[^>]*>/, '').replace(/<\/svg>/, '')
    .replace(/stroke="[^"]*"/g, 'stroke="#ffffff"')
    .replace(/fill="[^"]*"/g, 'fill="none"')
  svgPathCache.set(routeType, paths)
  return paths
}

// Create stop icon matching MapPage style (colored circle + transport icon)
// Scales with zoom: base sizes at zoom 11, grows up to 1.6x at zoom 18
function createStopIcon(
  routeType: string, color: string, isSelected: boolean, isDragging: boolean, zoom = 11,
): L.DivIcon {
  const scale = Math.min(1.6, Math.max(0.8, 0.6 + zoom * 0.06))
  const baseSize = isDragging ? 44 : isSelected ? 38 : 30
  const size = Math.round(baseSize * scale)
  const paths = getIconSvgPaths(routeType)
  const iconSize = size * 0.55
  const offset = (size - iconSize) / 2
  const border = isDragging
    ? 'stroke="#2563eb" stroke-width="3.5"'
    : isSelected
      ? 'stroke="#1e40af" stroke-width="3"'
      : 'stroke="#ffffff" stroke-width="2.5"'
  const shadow = isDragging
    ? 'filter:drop-shadow(0 0 8px rgba(37,99,235,0.7))'
    : isSelected
      ? 'filter:drop-shadow(0 0 4px rgba(30,64,175,0.5))'
      : ''

  const html = `<div style="width:${size}px;height:${size}px;${shadow}">
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${size/2}" cy="${size/2}" r="${size/2-2}" fill="${color}" ${border}/>
      <g transform="translate(${offset},${offset})">
        <svg width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>
      </g>
    </svg>
  </div>`

  return L.divIcon({
    html,
    className: 'stop-marker-icon',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}
export type RoutesSelectedItem =
  | { type: 'route'; item: CustomRoute }
  | { type: 'stop'; item: CustomStop; route: CustomRoute }
  | null


// Helper: Calculate point on line given a position (0-1)
function pointAtPosition(
  lineCoords: [number, number][],
  position: number
): { lat: number; lng: number } {
  if (lineCoords.length < 2) {
    const [lng, lat] = lineCoords[0] || [0, 0]
    return { lat, lng }
  }

  // Calculate total line length
  let totalLength = 0
  const segmentLengths: number[] = []
  for (let i = 1; i < lineCoords.length; i++) {
    const [lng1, lat1] = lineCoords[i - 1]
    const [lng2, lat2] = lineCoords[i]
    const len = Math.sqrt((lat2 - lat1) ** 2 + (lng2 - lng1) ** 2)
    segmentLengths.push(len)
    totalLength += len
  }

  // Find the target distance along the line
  const targetDist = position * totalLength
  let accumulatedDist = 0

  for (let i = 0; i < segmentLengths.length; i++) {
    const segLen = segmentLengths[i]
    if (accumulatedDist + segLen >= targetDist) {
      // Target is on this segment
      const t = segLen > 0 ? (targetDist - accumulatedDist) / segLen : 0
      const [lng1, lat1] = lineCoords[i]
      const [lng2, lat2] = lineCoords[i + 1]
      return {
        lat: lat1 + t * (lat2 - lat1),
        lng: lng1 + t * (lng2 - lng1),
      }
    }
    accumulatedDist += segLen
  }

  // Return end point if position >= 1
  const [lng, lat] = lineCoords[lineCoords.length - 1]
  return { lat, lng }
}

// Helper: Find closest point on a polyline to a given point
function closestPointOnLine(
  point: L.LatLng,
  lineCoords: [number, number][]
): { lat: number; lng: number; position: number; distance: number } {
  let minDist = Infinity
  let closestPoint = { lat: point.lat, lng: point.lng }
  let totalLength = 0
  let closestPosition = 0

  // Calculate total line length
  for (let i = 1; i < lineCoords.length; i++) {
    const [lng1, lat1] = lineCoords[i - 1]
    const [lng2, lat2] = lineCoords[i]
    totalLength += Math.sqrt((lat2 - lat1) ** 2 + (lng2 - lng1) ** 2)
  }

  let accumulatedLength = 0
  for (let i = 1; i < lineCoords.length; i++) {
    const [lng1, lat1] = lineCoords[i - 1]
    const [lng2, lat2] = lineCoords[i]

    const dx = lng2 - lng1
    const dy = lat2 - lat1
    const segmentLengthSq = dx * dx + dy * dy

    let t = 0
    if (segmentLengthSq > 0) {
      t = Math.max(0, Math.min(1, ((point.lng - lng1) * dx + (point.lat - lat1) * dy) / segmentLengthSq))
    }

    const projLng = lng1 + t * dx
    const projLat = lat1 + t * dy
    const dist = Math.sqrt((point.lat - projLat) ** 2 + (point.lng - projLng) ** 2)

    if (dist < minDist) {
      minDist = dist
      closestPoint = { lat: projLat, lng: projLng }
      const segmentLength = Math.sqrt(segmentLengthSq)
      closestPosition = totalLength > 0 ? (accumulatedLength + t * segmentLength) / totalLength : 0
    }

    accumulatedLength += Math.sqrt(segmentLengthSq)
  }

  return { ...closestPoint, position: closestPosition, distance: minDist }
}

// ============================================================================
// Map Controller - Must be rendered inside MapContainer
// ============================================================================

interface RoutesMapControllerProps {
  routes: CustomRoute[]
  selectedItem: RoutesSelectedItem
  editMode: RoutesEditMode
  onRouteCreate: (geometry: any) => void
  onRouteUpdate: (id: string, geometry: any) => void
  onStopUpdate: (stopId: string, location: { lat: number; lng: number }, position: number) => void
  onItemSelect: (item: RoutesSelectedItem) => void
}

export function RoutesMapController({
  routes,
  selectedItem,
  editMode,
  onRouteCreate,
  onRouteUpdate,
  onStopUpdate,
  onItemSelect,
}: RoutesMapControllerProps) {
  const map = useMap()
  const routeLayersRef = useRef<Map<string, L.Polyline>>(new Map())
  const stopMarkersRef = useRef<Map<string, L.Marker>>(new Map())
  // Metadata per stop marker so update effect can refresh icons without recreating
  const markerMetaRef = useRef<Map<string, { routeType: string; color: string; routeId: string }>>(new Map())
  const [zoom, setZoom] = useState(map.getZoom())

  // Track zoom for icon scaling
  useEffect(() => {
    const onZoom = () => setZoom(map.getZoom())
    map.on('zoomend', onZoom)
    return () => { map.off('zoomend', onZoom) }
  }, [map])

  // Initialize Geoman
  useEffect(() => {
    map.pm.setGlobalOptions({
      snapDistance: 15,
      snapMiddle: true,
    })

    const handleCreate = (e: any) => {
      if (e.shape === 'Line') {
        const layer = e.layer as L.Polyline
        const geoJSON = layer.toGeoJSON()
        onRouteCreate(geoJSON.geometry)
        map.removeLayer(layer)
      }
    }

    map.on('pm:create', handleCreate)
    return () => {
      map.off('pm:create', handleCreate)
    }
  }, [map, onRouteCreate])

  // Enable/disable draw mode
  useEffect(() => {
    if (editMode === 'drawing-route') {
      map.pm.enableDraw('Line', { snappable: true, snapDistance: 15 })
    } else {
      map.pm.disableDraw()
    }
  }, [map, editMode])

  // ── Structural effect: create/destroy layers when route DATA changes ──
  // Does NOT depend on selectedItem or zoom — those are handled by the update effect below.
  useEffect(() => {
    // Clear old layers
    routeLayersRef.current.forEach((layer) => map.removeLayer(layer))
    routeLayersRef.current.clear()
    stopMarkersRef.current.forEach((marker) => map.removeLayer(marker))
    stopMarkersRef.current.clear()
    markerMetaRef.current.clear()

    const currentZoom = map.getZoom()

    routes.forEach((route) => {
      if (!route.geometry || route.geometry.type !== 'LineString') return

      const coords = route.geometry.coordinates.map(
        ([lng, lat]: [number, number]) => [lat, lng] as [number, number]
      )

      // Draw route line with white casing (neutral weight — update effect adjusts)
      const casing = L.polyline(coords, { color: '#ffffff', weight: 6, opacity: 0.9 })
      casing.addTo(map)

      const polyline = L.polyline(coords, {
        color: route.color || '#3b82f6',
        weight: 3,
        opacity: 1,
      })

      polyline.on('click', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stop(e)
        onItemSelect({ type: 'route', item: route })
      })

      // pm:edit handler — always registered, only fires when pm is enabled
      polyline.on('pm:edit', () => {
        const latlngs = polyline.getLatLngs() as L.LatLng[]
        const newCoords = latlngs.map((ll) => [ll.lng, ll.lat])
        onRouteUpdate(route.id, { type: 'LineString', coordinates: newCoords })
      })

      polyline.addTo(map)
      routeLayersRef.current.set(route.id, polyline)
      routeLayersRef.current.set(route.id + '-casing', casing as any)

      // Create stop markers (neutral state — update effect applies selection/zoom styling)
      const routeType = route.route_type || 'custom'

      route.stops?.forEach((stop) => {
        const stopColor = stop.color || route.color || '#3b82f6'

        const marker = L.marker([stop.location.lat, stop.location.lng], {
          icon: createStopIcon(routeType, stopColor, false, false, currentZoom),
          draggable: false, // update effect enables when route is selected
        })

        marker.on('click', (e: L.LeafletMouseEvent) => {
          L.DomEvent.stop(e)
          onItemSelect({ type: 'stop', item: stop, route })
        })

        // Drag handlers — always registered; only fire when dragging is enabled.
        // IMPORTANT: NEVER call setIcon() during drag — it replaces the DOM element
        // that L.Draggable is bound to, instantly killing the drag.
        marker.on('dragend', (e: any) => {
          const latlng = e.target.getLatLng()
          const closest = closestPointOnLine(latlng, route.geometry.coordinates)
          marker.setLatLng([closest.lat, closest.lng])
          onStopUpdate(stop.id, { lat: closest.lat, lng: closest.lng }, closest.position)
        })

        marker.addTo(map)
        stopMarkersRef.current.set(stop.id, marker)
        markerMetaRef.current.set(stop.id, { routeType, color: stopColor, routeId: route.id })
      })
    })

    return () => {
      routeLayersRef.current.forEach((layer) => {
        layer.off('click')
        layer.off('pm:edit')
        if ((layer as any).pm) (layer as any).pm.disable()
        map.removeLayer(layer)
      })
      routeLayersRef.current.clear()

      stopMarkersRef.current.forEach((marker) => {
        marker.off('click')
        marker.off('dragend')
        map.removeLayer(marker)
      })
      stopMarkersRef.current.clear()
      markerMetaRef.current.clear()
    }
  }, [map, routes, editMode, onItemSelect, onRouteUpdate, onStopUpdate])

  // ── Lightweight update effect: selection + zoom changes ──
  // Updates icons, line weights, drag state, and pm editing WITHOUT recreating DOM elements.
  useEffect(() => {
    routes.forEach((route) => {
      const isRouteSelected = selectedItem?.type === 'route' && selectedItem.item.id === route.id
      const isParent = selectedItem?.type === 'stop' && selectedItem.route.id === route.id
      const active = isRouteSelected || isParent

      // Update route line weight
      const polyline = routeLayersRef.current.get(route.id)
      const casing = routeLayersRef.current.get(route.id + '-casing')
      if (polyline) polyline.setStyle({ weight: active ? 5 : 3 })
      if (casing) (casing as any).setStyle({ weight: active ? 8 : 6 })

      // Enable/disable polyline editing
      if (polyline) {
        if (isRouteSelected) {
          (polyline as any).pm.enable({ allowSelfIntersection: true })
        } else {
          (polyline as any).pm.disable()
        }
      }

      // Update stop marker icons + drag state
      route.stops?.forEach((stop) => {
        const marker = stopMarkersRef.current.get(stop.id)
        const meta = markerMetaRef.current.get(stop.id)
        if (!marker || !meta) return

        const isStopSelected = selectedItem?.type === 'stop' && selectedItem.item.id === stop.id
        marker.setIcon(createStopIcon(meta.routeType, meta.color, isStopSelected, false, zoom))

        // setIcon() replaces the DOM element, which breaks L.Draggable's binding.
        // Must disable+enable to re-bind to the new DOM element.
        if (active) {
          marker.dragging?.disable()
          marker.dragging?.enable()
        } else {
          marker.dragging?.disable()
        }
      })
    })
  }, [selectedItem, zoom, routes])

  return null
}

// ============================================================================
// Sidebar - Renders in sidebar area
// ============================================================================

interface RoutesSidebarProps {
  routes: CustomRoute[]
  selectedItem: RoutesSelectedItem
  editMode: RoutesEditMode
  onAddRoute: () => void
  onAddStop: () => void
  onItemSelect: (item: RoutesSelectedItem) => void
}

export function RoutesSidebar({
  routes,
  selectedItem,
  editMode,
  onAddRoute,
  onAddStop,
  onItemSelect,
}: RoutesSidebarProps) {
  const selectedRoute = selectedItem?.type === 'route'
    ? selectedItem.item
    : selectedItem?.type === 'stop'
      ? selectedItem.route
      : null

  return (
    <div className="flex flex-col h-full">
      {/* Tools */}
      <div className="p-4 bg-slate-50 border-b space-y-2">
        <Button
          onClick={onAddRoute}
          variant={editMode === 'drawing-route' ? 'default' : 'outline'}
          className="w-full"
          size="lg"
        >
          <Route className="w-5 h-5 mr-2" />
          {editMode === 'drawing-route' ? '✏️ Draw on Map...' : 'Add New Route'}
        </Button>

        {selectedRoute && (
          <Button
            onClick={onAddStop}
            variant="outline"
            className="w-full"
            size="sm"
          >
            <Circle className="w-4 h-4 mr-2" />
            Add Stop
          </Button>
        )}

        {editMode === 'drawing-route' && (
          <div className="p-2 bg-blue-50 rounded text-xs">
            <p>✏️ Click to draw, double-click to finish</p>
          </div>
        )}
      </div>

      {/* Routes List */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-2">
          {routes.map((route) => (
            <div key={route.id}>
              <div
                onClick={() => onItemSelect({ type: 'route', item: route })}
                className={`p-3 rounded cursor-pointer flex items-center gap-3 ${
                  selectedRoute?.id === route.id
                    ? 'bg-blue-50 border-blue-300 border-2'
                    : 'hover:bg-slate-50 border-2 border-transparent'
                }`}
              >
                <div className="w-6 h-1 rounded" style={{ background: route.color }} />
                <span className="text-sm flex-1 font-medium">{route.name}</span>
                <span className="text-xs text-slate-400">{route.stops?.length || 0}</span>
              </div>

              {/* Stops */}
              {selectedRoute?.id === route.id && (route.stops?.length ?? 0) > 0 && (
                <div className="ml-4 mt-1 space-y-1 border-l-2 border-slate-200 pl-3">
                  {route.stops?.map((stop) => (
                    <div
                      key={stop.id}
                      onClick={(e) => {
                        e.stopPropagation()
                        onItemSelect({ type: 'stop', item: stop, route })
                      }}
                      className={`p-2 rounded cursor-pointer flex items-center gap-2 text-sm ${
                        selectedItem?.type === 'stop' && selectedItem.item.id === stop.id
                          ? 'bg-blue-100'
                          : 'hover:bg-slate-100'
                      }`}
                    >
                      <div
                        className="w-3 h-3 rounded-full border-2 border-white shadow"
                        style={{ background: stop.color || route.color }}
                      />
                      <span className="flex-1">{stop.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          {routes.length === 0 && (
            <div className="text-center py-8 text-slate-400 text-sm">
              No routes yet. Click "Add New Route".
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Hook for managing routes state
// ============================================================================

export function useRoutesEditor() {
  const [routes, setRoutes] = useState<CustomRoute[]>([])
  const [selectedItem, setSelectedItem] = useState<RoutesSelectedItem>(null)
  const [editMode, setEditMode] = useState<RoutesEditMode>('idle')
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    loadRoutes()
  }, [])

  const loadRoutes = async () => {
    const data = await fetchCustomRoutes()
    setRoutes(data)
  }

  const handleAddRoute = () => {
    setEditMode('drawing-route')
    setSelectedItem(null)
  }

  const handleRouteCreate = async (geometry: any) => {
    const newRoute: Partial<CustomRoute> = {
      name: 'New Route',
      color: '#ef4444',
      route_type: 'metro',
      geometry,
      line_width: 3,
    }
    const created = await createCustomRoute(newRoute)
    if (created) {
      const routeWithStops = { ...created, stops: [] }
      setRoutes([...routes, routeWithStops])
      setSelectedItem({ type: 'route', item: routeWithStops })
    }
    setEditMode('idle')
  }

  const handleRouteUpdate = useCallback(async (id: string, geometry: any) => {
    await updateCustomRoute(id, { geometry })

    // Recalculate all stops positions based on new geometry
    setRoutes((prev) => {
      const route = prev.find((r) => r.id === id)
      if (!route?.stops?.length || !geometry?.coordinates) {
        return prev.map((r) => (r.id === id ? { ...r, geometry } : r))
      }

      // Calculate new positions for all stops
      const updatedStops = route.stops.map((stop) => {
        if (stop.position_on_route !== undefined && stop.position_on_route !== null) {
          const newLocation = pointAtPosition(geometry.coordinates, stop.position_on_route)
          return { ...stop, location: newLocation }
        }
        return stop
      })

      // Batch update stops in backend
      const stopsToUpdate = updatedStops.map((s) => ({
        id: s.id,
        location: s.location,
        position_on_route: s.position_on_route,
      }))
      batchUpdateStops(id, stopsToUpdate)

      return prev.map((r) => (r.id === id ? { ...r, geometry, stops: updatedStops } : r))
    })
  }, [])

  const handleAddStop = async () => {
    const route = selectedItem?.type === 'route'
      ? selectedItem.item
      : selectedItem?.type === 'stop'
        ? selectedItem.route
        : null
    if (!route?.geometry?.coordinates) return

    // Create stop at route midpoint — user can drag to reposition
    const midpoint = pointAtPosition(route.geometry.coordinates, 0.5)
    const newStop: Partial<CustomStop> = {
      name: 'New Stop',
      location: midpoint,
      position_on_route: 0.5,
    }
    const created = await createCustomStop(route.id, newStop)
    if (created) {
      const updatedRoute = { ...route, stops: [...(route.stops || []), created] }
      setRoutes((prev) => prev.map((r) => r.id === route.id ? updatedRoute : r))
      setSelectedItem({ type: 'stop', item: created, route: updatedRoute })
    }
  }

  const handleStopUpdate = useCallback(async (stopId: string, location: { lat: number; lng: number }, position: number) => {
    await updateCustomStop(stopId, { location, position_on_route: position })
    setRoutes((prev) =>
      prev.map((r) => ({
        ...r,
        stops: r.stops?.map((s) => (s.id === stopId ? { ...s, location, position_on_route: position } : s)),
      }))
    )
  }, [])

  const handleSave = async (data: any) => {
    if (!selectedItem) return
    setIsSaving(true)
    try {
      if (selectedItem.type === 'route') {
        // Only save form fields, not geometry/stops (those are saved in real-time)
        const formFields = {
          name: data.name,
          name_ar: data.name_ar,
          description: data.description,
          color: data.color,
          route_type: data.route_type,
          line_width: data.line_width,
        }
        const updated = await updateCustomRoute(selectedItem.item.id, formFields)
        if (updated) {
          // Merge with existing data to preserve geometry and stops
          setRoutes((prev) => prev.map((r) => (r.id === updated.id ? { ...r, ...formFields } : r)))
        }
      } else {
        // Only save form fields for stops
        const formFields = {
          name: data.name,
          name_ar: data.name_ar,
          description: data.description,
          color: data.color,
        }
        const updated = await updateCustomStop(selectedItem.item.id, formFields)
        if (updated) {
          // Merge with existing data to preserve location and position_on_route
          setRoutes((prev) =>
            prev.map((r) => ({
              ...r,
              stops: r.stops?.map((s) => (s.id === updated.id ? { ...s, ...formFields } : s)),
            }))
          )
        }
      }
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selectedItem) return
    const msg = selectedItem.type === 'route'
      ? `Delete "${selectedItem.item.name}" and all stops?`
      : `Delete stop "${selectedItem.item.name}"?`
    if (!confirm(msg)) return

    if (selectedItem.type === 'route') {
      await deleteCustomRoute(selectedItem.item.id)
      setRoutes((prev) => prev.filter((r) => r.id !== selectedItem.item.id))
      setSelectedItem(null)
    } else {
      await deleteCustomStop(selectedItem.item.id)
      setRoutes((prev) =>
        prev.map((r) => ({
          ...r,
          stops: r.stops?.filter((s) => s.id !== selectedItem.item.id),
        }))
      )
      setSelectedItem({ type: 'route', item: selectedItem.route })
    }
  }

  return {
    routes,
    selectedItem,
    editMode,
    isSaving,
    setSelectedItem,
    setEditMode,
    handleAddRoute,
    handleRouteCreate,
    handleRouteUpdate,
    handleAddStop,
    handleStopUpdate,
    handleSave,
    handleDelete,
  }
}
