/**
 * Routes Editor - Draw routes and place stops on the map
 *
 * Split into two parts:
 * - RoutesMapController: Renders inside MapContainer, handles map interactions
 * - RoutesSidebar: Renders in sidebar, handles UI
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useMap } from 'react-leaflet'
import { Button } from './ui/button'
import { Route, Circle } from 'lucide-react'
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

export type RoutesEditMode = 'idle' | 'drawing-route' | 'adding-stop'
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
  onStopCreate: (routeId: string, location: { lat: number; lng: number }, position: number) => void
  onStopUpdate: (stopId: string, location: { lat: number; lng: number }, position: number) => void
  onItemSelect: (item: RoutesSelectedItem) => void
}

export function RoutesMapController({
  routes,
  selectedItem,
  editMode,
  onRouteCreate,
  onRouteUpdate,
  onStopCreate,
  onStopUpdate,
  onItemSelect,
}: RoutesMapControllerProps) {
  const map = useMap()
  const routeLayersRef = useRef<Map<string, L.Polyline>>(new Map())
  const stopMarkersRef = useRef<Map<string, L.Marker>>(new Map())

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

  // Render routes and stops
  useEffect(() => {
    // Clear old layers
    routeLayersRef.current.forEach((layer) => map.removeLayer(layer))
    routeLayersRef.current.clear()
    stopMarkersRef.current.forEach((marker) => map.removeLayer(marker))
    stopMarkersRef.current.clear()

    routes.forEach((route) => {
      if (!route.geometry || route.geometry.type !== 'LineString') return

      const coords = route.geometry.coordinates.map(
        ([lng, lat]: [number, number]) => [lat, lng] as [number, number]
      )

      const isSelected = selectedItem?.type === 'route' && selectedItem.item.id === route.id
      const isParentOfSelectedStop = selectedItem?.type === 'stop' && selectedItem.route.id === route.id

      // Draw route line with white casing for visibility
      const casing = L.polyline(coords, {
        color: '#ffffff',
        weight: (isSelected || isParentOfSelectedStop ? 8 : 6),
        opacity: 0.9,
      })
      casing.addTo(map)

      const polyline = L.polyline(coords, {
        color: route.color || '#3b82f6',
        weight: isSelected || isParentOfSelectedStop ? 5 : 3,
        opacity: 1,
      })

      polyline.on('click', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stop(e)
        if (editMode === 'adding-stop' && (isSelected || isParentOfSelectedStop)) {
          const closest = closestPointOnLine(e.latlng, route.geometry.coordinates)
          onStopCreate(route.id, { lat: closest.lat, lng: closest.lng }, closest.position)
        } else {
          onItemSelect({ type: 'route', item: route })
        }
      })

      polyline.addTo(map)
      routeLayersRef.current.set(route.id, polyline)
      routeLayersRef.current.set(route.id + '-casing', casing as any)

      // Enable editing if selected
      if (isSelected) {
        polyline.pm.enable({ allowSelfIntersection: true })
        polyline.on('pm:edit', () => {
          const latlngs = polyline.getLatLngs() as L.LatLng[]
          const newCoords = latlngs.map((ll) => [ll.lng, ll.lat])
          onRouteUpdate(route.id, { type: 'LineString', coordinates: newCoords })
        })
      }

      // Draw stops
      route.stops?.forEach((stop) => {
        const isStopSelected = selectedItem?.type === 'stop' && selectedItem.item.id === stop.id

        const icon = L.divIcon({
          html: `
            <div style="
              width: ${isStopSelected ? 26 : 22}px;
              height: ${isStopSelected ? 26 : 22}px;
              border-radius: 50%;
              background: ${stop.color || route.color || '#3b82f6'};
              border: 3px solid white;
              box-shadow: 0 2px 8px rgba(0,0,0,0.4);
              ${isStopSelected ? 'border-color: #1e40af; border-width: 4px;' : ''}
            "></div>
          `,
          className: 'stop-marker',
          iconSize: [isStopSelected ? 26 : 22, isStopSelected ? 26 : 22],
          iconAnchor: [isStopSelected ? 13 : 11, isStopSelected ? 13 : 11],
        })

        const marker = L.marker([stop.location.lat, stop.location.lng], {
          icon,
          draggable: isSelected || isParentOfSelectedStop,
        })

        marker.on('click', (e: L.LeafletMouseEvent) => {
          L.DomEvent.stop(e)
          onItemSelect({ type: 'stop', item: stop, route })
        })

        // Snap to line while dragging
        if (isSelected || isParentOfSelectedStop) {
          marker.on('drag', (e: any) => {
            const closest = closestPointOnLine(e.target.getLatLng(), route.geometry.coordinates)
            e.target.setLatLng([closest.lat, closest.lng])
          })

          marker.on('dragend', (e: any) => {
            const latlng = e.target.getLatLng()
            const closest = closestPointOnLine(latlng, route.geometry.coordinates)
            onStopUpdate(stop.id, { lat: closest.lat, lng: closest.lng }, closest.position)
          })
        }

        marker.addTo(map)
        stopMarkersRef.current.set(stop.id, marker)
      })
    })

    return () => {
      // IMPORTANT: Remove layers from map when cleaning up
      routeLayersRef.current.forEach((layer) => {
        layer.off('click')
        layer.off('pm:edit')
        if ((layer as any).pm) (layer as any).pm.disable()
        map.removeLayer(layer)
      })
      routeLayersRef.current.clear()

      stopMarkersRef.current.forEach((marker) => {
        marker.off('click')
        marker.off('drag')
        marker.off('dragend')
        map.removeLayer(marker)
      })
      stopMarkersRef.current.clear()
    }
  }, [map, routes, selectedItem, editMode, onItemSelect, onStopCreate, onRouteUpdate, onStopUpdate])

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
            variant={editMode === 'adding-stop' ? 'default' : 'outline'}
            className="w-full"
            size="sm"
          >
            <Circle className="w-4 h-4 mr-2" />
            {editMode === 'adding-stop' ? '📍 Click Route...' : 'Add Stop'}
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

  const handleAddStop = () => {
    if (selectedItem?.type === 'route' || selectedItem?.type === 'stop') {
      setEditMode('adding-stop')
    }
  }

  const handleStopCreate = async (routeId: string, location: { lat: number; lng: number }, position: number) => {
    const newStop: Partial<CustomStop> = {
      name: 'New Stop',
      location,
      position_on_route: position,
    }
    const created = await createCustomStop(routeId, newStop)
    if (created) {
      setRoutes((prev) =>
        prev.map((r) =>
          r.id === routeId ? { ...r, stops: [...(r.stops || []), created] } : r
        )
      )
      const route = routes.find((r) => r.id === routeId)
      if (route) {
        setSelectedItem({ type: 'stop', item: created, route: { ...route, stops: [...(route.stops || []), created] } })
      }
    }
    setEditMode('idle')
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
    handleStopCreate,
    handleStopUpdate,
    handleSave,
    handleDelete,
  }
}
